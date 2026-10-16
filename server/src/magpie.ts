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

export type Enricher = (text: string, sentence: string) => Promise<Enrichment>;

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

export const magpieEnricher: Enricher = async (text, sentence) => {
  const { baseUrl, model, apiKey, timeoutMs } = config.magpie;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Selected: ${text}\nSentence: ${sentence || '(no context)'}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`magpie ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? '';
  return normalize(parseJson(content), text);
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
