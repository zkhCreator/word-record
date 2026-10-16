import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Repo } from './repo.ts';
import { API_FORMATS, type ApiFormat, type Connection, type Enricher, type ModelLister } from './llm.ts';
import { config } from './config.ts';
import { GRADES, MASTERED_STAGE, INTERVALS, preview, type Grade } from './srs.ts';

export interface Deps {
  enrich: Enricher;
  listModels: ModelLister;
  defaultModel?: string;
  defaultConnection?: Connection;
}

const maskKey = (key: string) => (key ? `••••${key.slice(-4)}` : '');

function validBaseUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * Only the web app (same local origin, including the Vite dev server) and the
 * browser extension may call the API. Any other website could otherwise read
 * the library, or repoint the model URL and leak the API key.
 */
export function isAllowedOrigin(origin: string, extra: string[] = []) {
  if (extra.includes(origin)) return true;
  if (/^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && LOCAL_HOST.test(u.host);
  } catch {
    return false;
  }
}

export function createApp(repo: Repo, deps: Deps, opts: { webDist?: string; allowedOrigins?: string[] } = {}) {
  const { enrich, listModels } = deps;
  const defaultModel = deps.defaultModel ?? config.magpie.model;
  const currentModel = () => repo.getSetting('model') || defaultModel;
  const asFormat = (v: unknown): ApiFormat | undefined => (API_FORMATS.includes(v as ApiFormat) ? (v as ApiFormat) : undefined);
  const defaultConnection: Connection = deps.defaultConnection ?? {
    baseUrl: config.magpie.baseUrl,
    apiKey: config.magpie.apiKey,
    format: asFormat(config.magpie.format) ?? 'openai',
  };
  const currentConnection = (): Connection => ({
    baseUrl: repo.getSetting('baseUrl') || defaultConnection.baseUrl,
    apiKey: repo.getSetting('apiKey') ?? defaultConnection.apiKey,
    format: asFormat(repo.getSetting('apiFormat')) ?? defaultConnection.format,
  });
  const callOptions = (model = currentModel()) => ({ ...currentConnection(), model });

  // The key itself never leaves the server; the UI only gets a masked hint.
  const settingsView = () => {
    const conn = currentConnection();
    return {
      model: currentModel(),
      defaultModel,
      baseUrl: conn.baseUrl,
      defaultBaseUrl: defaultConnection.baseUrl,
      format: conn.format,
      defaultFormat: defaultConnection.format,
      apiKeySet: !!conn.apiKey,
      apiKeyHint: maskKey(conn.apiKey),
    };
  };
  const app = express();
  const extraOrigins = opts.allowedOrigins ?? config.allowedOrigins;

  app.use('/api', (req, res, next) => {
    // DNS rebinding: a hostile domain resolving to 127.0.0.1 still sends its own Host header.
    if (!LOCAL_HOST.test(req.headers.host ?? '')) return res.status(403).json({ error: 'forbidden host' });
    const origin = req.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin, extraOrigins)) return res.status(403).json({ error: 'forbidden origin' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  const idParam = (req: Request) => Number(req.params.id);

  /** Enriches and returns the id the entry ends up under (a new entry may fold into one sharing its lemma). */
  async function runEnrichment(entryId: number, contextId: number | null, text: string, sentence: string, aggregate = false) {
    const entry = repo.getEntry(entryId)!;
    const model = currentModel();
    try {
      const result = await enrich(text, sentence, callOptions(model));
      repo.applyEnrichment(entryId, contextId, result, entry.enrich_status !== 'done', model);
      const existing = aggregate ? repo.findByLemma(result.lemma, entryId) : undefined;
      if (existing) {
        repo.merge(entryId, existing.id);
        return existing.id;
      }
    } catch (err) {
      repo.markEnrichError(entryId, (err as Error).message);
    }
    return entryId;
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'word-record' });
  });

  app.get('/api/settings', (_req, res) => {
    res.json(settingsView());
  });

  /** Fields left out stay unchanged; an empty baseUrl restores the default, an empty apiKey clears it. */
  app.put('/api/settings', (req, res) => {
    const { model, baseUrl, apiKey, format } = req.body ?? {};
    if (format !== undefined && !asFormat(format)) return res.status(400).json({ error: `format must be one of ${API_FORMATS.join(', ')}` });
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      return res.status(400).json({ error: 'model must be a non-empty string' });
    }
    if (baseUrl !== undefined && (typeof baseUrl !== 'string' || (baseUrl.trim() && !validBaseUrl(baseUrl.trim())))) {
      return res.status(400).json({ error: '服务地址必须是 http:// 或 https:// 开头的 URL' });
    }
    if (apiKey !== undefined && typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey must be a string' });

    if (typeof model === 'string') repo.setSetting('model', model.trim());
    if (typeof baseUrl === 'string') {
      if (baseUrl.trim()) repo.setSetting('baseUrl', baseUrl.trim().replace(/\/+$/, ''));
      else repo.deleteSetting('baseUrl');
    }
    if (typeof apiKey === 'string') repo.setSetting('apiKey', apiKey.trim());
    if (format) repo.setSetting('apiFormat', format);
    res.json(settingsView());
  });

  /** Connection from the request body (unsaved form values), falling back to the saved one field by field. */
  const draftConnection = (body: any): Connection | { error: string } => {
    const saved = currentConnection();
    const baseUrl = typeof body?.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : saved.baseUrl;
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : saved.apiKey;
    const format = asFormat(body?.format) ?? saved.format;
    if (!validBaseUrl(baseUrl)) return { error: '服务地址必须是 http:// 或 https:// 开头的 URL' };
    return { baseUrl, apiKey, format };
  };

  /** Lists models for a (possibly unsaved) connection, so the model picker follows the form. A missing apiKey means "use the saved key". */
  app.post('/api/connection/test', async (req, res) => {
    const conn = draftConnection(req.body);
    if ('error' in conn) return res.json({ ok: false, error: conn.error });
    const started = Date.now();
    try {
      const items = await listModels(conn);
      res.json({ ok: true, ms: Date.now() - started, count: items.length, items });
    } catch (err) {
      res.json({ ok: false, ms: Date.now() - started, error: (err as Error).message });
    }
  });

  app.get('/api/models', async (_req, res) => {
    try {
      res.json({ items: await listModels(currentConnection()), current: currentModel() });
    } catch (err) {
      res.status(502).json({ error: `无法获取模型列表：${(err as Error).message}` });
    }
  });

  app.post('/api/models/test', async (req, res) => {
    const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : currentModel();
    const conn = draftConnection(req.body);
    if ('error' in conn) return res.json({ ok: false, model, ms: 0, error: conn.error });
    const started = Date.now();
    try {
      const r = await enrich('ephemeral', 'Fame in the age of social media is often ephemeral.', { ...conn, model });
      res.json({ ok: true, model, ms: Date.now() - started, lemma: r.lemma, meaning: r.meaning });
    } catch (err) {
      res.json({ ok: false, model, ms: Date.now() - started, error: (err as Error).message });
    }
  });

  app.post('/api/entries', async (req, res) => {
    const { text, sentence, url, title } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
    if (text.length > 200) return res.status(400).json({ error: 'selection too long (max 200 chars)' });
    const captured = repo.capture({
      text,
      sentence: typeof sentence === 'string' ? sentence.slice(0, 2000) : '',
      url: typeof url === 'string' ? url : undefined,
      title: typeof title === 'string' ? title : undefined,
    });
    // Each new sentence gets its own contextual meaning, even for a word we already know.
    let entryId = captured.entry.id;
    if (captured.created || !captured.context.meaning) {
      const form = captured.context.form ?? captured.entry.text;
      entryId = await runEnrichment(entryId, captured.context.id, form, captured.context.sentence, captured.created);
    }
    const merged = entryId !== captured.entry.id;
    const created = captured.created && !merged;
    res.status(created ? 201 : 200).json({
      created,
      merged,
      entry: repo.getEntry(entryId),
      context: repo.getContext(captured.context.id),
    });
  });

  app.get('/api/entries', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    res.json(repo.list({ q, kind, limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0 }));
  });

  app.get('/api/entries/:id', (req, res) => {
    const entry = repo.getEntry(idParam(req));
    if (!entry) return res.status(404).json({ error: 'not found' });
    res.json({ entry, contexts: repo.contexts(entry.id), review: repo.reviewState(entry.id) });
  });

  app.patch('/api/entries/:id', (req, res) => {
    const entry = repo.update(idParam(req), req.body ?? {});
    if (!entry) return res.status(404).json({ error: 'not found' });
    res.json({ entry });
  });

  app.delete('/api/entries/:id', (req, res) => {
    if (!repo.remove(idParam(req))) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  });

  app.post('/api/entries/:id/merge', (req, res) => {
    const into = Number(req.body?.into);
    const id = idParam(req);
    if (!Number.isInteger(into) || into === id) return res.status(400).json({ error: 'into must be another entry id' });
    const entry = repo.merge(id, into);
    if (!entry) return res.status(404).json({ error: 'not found' });
    res.json({ entry, contexts: repo.contexts(entry.id), review: repo.reviewState(entry.id) });
  });

  app.post('/api/entries/:id/enrich', async (req, res) => {
    const entry = repo.getEntry(idParam(req));
    if (!entry) return res.status(404).json({ error: 'not found' });
    const [latest] = repo.contexts(entry.id);
    // Force a fresh entry-level enrichment by resetting status first.
    repo.db.prepare(`UPDATE entries SET enrich_status = 'pending' WHERE id = ?`).run(entry.id);
    await runEnrichment(entry.id, latest?.id ?? null, entry.text, latest?.sentence ?? '');
    res.json({ entry: repo.getEntry(entry.id), contexts: repo.contexts(entry.id) });
  });

  app.get('/api/review/queue', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const items = repo.dueEntries(Date.now(), limit).map((item) => ({ ...item, preview: preview(item.review.stage) }));
    res.json({ items, intervals: INTERVALS, masteredStage: MASTERED_STAGE });
  });

  app.get('/api/review/stats', (_req, res) => {
    res.json(repo.reviewStats(Date.now()));
  });

  app.post('/api/review/:id', (req, res) => {
    const grade = req.body?.grade as Grade;
    if (!GRADES.includes(grade)) return res.status(400).json({ error: `grade must be one of ${GRADES.join(', ')}` });
    const review = repo.grade(idParam(req), grade, Date.now());
    if (!review) return res.status(404).json({ error: 'not found' });
    res.json({ review, preview: preview(review.stage) });
  });

  app.delete('/api/contexts/:id', (req, res) => {
    if (!repo.removeContext(idParam(req))) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  });

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.webDist!, 'index.html')));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app;
}
