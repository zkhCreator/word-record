import { config } from './config.ts';

export interface Enrichment {
  kind: 'word' | 'phrase';
  lemma: string;
  phonetic: string;
  pos: string;
  form_note: string;
  meaning: string;
  explanation: string;
  translation: string;
  definition_en: string;
  senses: { pos: string; meaning: string }[];
  examples: { en: string; zh: string }[];
}

/** Where and how to reach the OpenAI-compatible model service (magpie by default). */
export interface Connection {
  baseUrl: string;
  apiKey: string;
}

export interface CallOptions extends Connection {
  model: string;
}

export type Enricher = (text: string, sentence: string, opts: CallOptions) => Promise<Enrichment>;

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  reasoning: boolean;
}

export type ModelLister = (conn: Connection) => Promise<ModelInfo[]>;

const headers = (conn: Connection) => ({
  'content-type': 'application/json',
  ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}),
});

/** fetch with network failures reported as "can't reach <url> (ECONNREFUSED)" instead of "fetch failed". */
async function call(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    if (e.name === 'TimeoutError') throw new Error(`请求超时：${url}`);
    throw new Error(`无法连接 ${url}（${e.cause?.code ?? e.cause?.message ?? e.message}）`);
  }
}

const endpoint = (conn: Connection, path: string) => `${conn.baseUrl.replace(/\/+$/, '')}${path}`;

const SYSTEM_PROMPT = `You are an English dictionary assistant for a Chinese-speaking learner.
Given a selected English word or phrase and the sentence it appeared in, return ONLY a JSON object with these keys:
- "kind": "word" or "phrase"
- "lemma": the selection in dictionary base form, keeping ALL of its words and only un-inflecting them (e.g. "running" -> "run", "took into account" -> "take into account", "met with fierce criticism" -> "meet with fierce criticism"); never drop words
- "phonetic": IPA of the lemma wrapped in slashes, e.g. "/rʌn/"; "" for long phrases
- "pos": part of speech in this context, abbreviated (n. / v. / adj. / adv. / prep. / phr. ...)
- "form_note": Chinese note on how the selected form relates to the lemma (e.g. "running 是 run 的现在分词"); "" if identical
- "meaning": concise Chinese meaning IN THIS CONTEXT (a few words)
- "explanation": one Chinese sentence explaining why it means this here
- "translation": natural Chinese translation of the whole sentence
- "definition_en": short English learner's-dictionary definition for this sense
- "senses": up to 4 common senses of the lemma, each {"pos": "...", "meaning": "中文释义"}
- "examples": 2 short new example sentences using this sense, each {"en": "...", "zh": "..."}
No markdown, no commentary.`;

export const magpieEnricher: Enricher = async (text, sentence, { model, ...conn }) => {
  const res = await call(endpoint(conn, '/chat/completions'), {
    method: 'POST',
    signal: AbortSignal.timeout(config.magpie.timeoutMs),
    headers: headers(conn),
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Selected: ${text}\nSentence: ${sentence || '(no context)'}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? '';
  return normalize(parseJson(content), text);
};

async function errorMessage(res: Response) {
  const raw = await res.text();
  try {
    const msg = JSON.parse(raw)?.error?.message;
    if (typeof msg === 'string') return `HTTP ${res.status}: ${msg.slice(0, 300)}`;
  } catch {}
  return `HTTP ${res.status}: ${raw.slice(0, 300)}`;
}

/** Text chat models magpie exposes (image-generation and disabled entries are skipped). */
export const magpieModels: ModelLister = async (conn) => {
  const res = await call(endpoint(conn, '/models'), { headers: headers(conn), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { data?: Record<string, unknown>[] };
  return (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && !/image|disabled/i.test(m.id as string))
    .map((m) => ({
      id: m.id as string,
      name: (m.display_name as string) || (m.id as string),
      provider: (m.owned_by as string) || (m.id as string).split('/')[0],
      contextWindow: typeof m.context_window === 'number' ? m.context_window : null,
      reasoning: m.reasoning === true,
    }));
};

export function parseJson(content: string): Record<string, unknown> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`model returned no JSON: ${content.slice(0, 200)}`);
  return JSON.parse(content.slice(start, end + 1));
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalize(raw: Record<string, unknown>, text: string): Enrichment {
  const list = <T>(v: unknown, map: (o: Record<string, unknown>) => T) =>
    Array.isArray(v) ? v.filter((o) => o && typeof o === 'object').map(map) : [];
  return {
    kind: raw.kind === 'phrase' || /\s/.test(text.trim()) ? 'phrase' : 'word',
    lemma: str(raw.lemma) || text.trim(),
    phonetic: str(raw.phonetic),
    pos: str(raw.pos),
    form_note: str(raw.form_note),
    meaning: str(raw.meaning),
    explanation: str(raw.explanation),
    translation: str(raw.translation),
    definition_en: str(raw.definition_en),
    senses: list(raw.senses, (o) => ({ pos: str(o.pos), meaning: str(o.meaning) })).slice(0, 4),
    examples: list(raw.examples, (o) => ({ en: str(o.en), zh: str(o.zh) })).slice(0, 3),
  };
}
