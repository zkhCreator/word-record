import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { Repo } from './repo.ts';
import type { Enricher, ModelLister } from './magpie.ts';
import { config } from './config.ts';
import { GRADES, MASTERED_STAGE, INTERVALS, preview, type Grade } from './srs.ts';

export interface Deps {
  enrich: Enricher;
  listModels: ModelLister;
  defaultModel?: string;
}

export function createApp(repo: Repo, deps: Deps, opts: { webDist?: string } = {}) {
  const { enrich, listModels } = deps;
  const defaultModel = deps.defaultModel ?? config.magpie.model;
  const currentModel = () => repo.getSetting('model') || defaultModel;
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  const idParam = (req: Request) => Number(req.params.id);

  async function runEnrichment(entryId: number, contextId: number | null, text: string, sentence: string) {
    const entry = repo.getEntry(entryId)!;
    const model = currentModel();
    try {
      const result = await enrich(text, sentence, model);
      repo.applyEnrichment(entryId, contextId, result, entry.enrich_status !== 'done', model);
    } catch (err) {
      repo.markEnrichError(entryId, (err as Error).message);
    }
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'word-record' });
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ model: currentModel(), defaultModel, magpieUrl: config.magpie.baseUrl });
  });

  app.put('/api/settings', (req, res) => {
    const { model } = req.body ?? {};
    if (typeof model !== 'string' || !model.trim()) return res.status(400).json({ error: 'model is required' });
    repo.setSetting('model', model.trim());
    res.json({ model: currentModel(), defaultModel, magpieUrl: config.magpie.baseUrl });
  });

  app.get('/api/models', async (_req, res) => {
    try {
      res.json({ items: await listModels(), current: currentModel() });
    } catch (err) {
      res.status(502).json({ error: `无法从 magpie 获取模型列表：${(err as Error).message}` });
    }
  });

  app.post('/api/models/test', async (req, res) => {
    const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : currentModel();
    const started = Date.now();
    try {
      const r = await enrich('ephemeral', 'Fame in the age of social media is often ephemeral.', model);
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
    if (captured.created || !captured.context.meaning) {
      await runEnrichment(captured.entry.id, captured.context.id, captured.entry.text, captured.context.sentence);
    }
    res.status(captured.created ? 201 : 200).json({
      created: captured.created,
      entry: repo.getEntry(captured.entry.id),
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
