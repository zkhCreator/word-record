import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { Repo, normalizeText } from '../src/repo.ts';
import { createApp, isAllowedOrigin } from '../src/app.ts';
import { normalize, parseJson, type Enricher } from '../src/magpie.ts';

const fakeEnrich: Enricher = async (text, sentence) =>
  normalize({ lemma: text.replace(/ing$/, ''), meaning: `义:${sentence.length}`, translation: '译文' }, text);

const fakeModels = async () => [
  { id: 'claude/a', name: 'A', provider: 'claude', contextWindow: 1000, reasoning: true },
  { id: 'codex/b', name: 'B', provider: 'codex', contextWindow: null, reasoning: false },
];

async function start(enrich: Enricher = fakeEnrich) {
  const repo = new Repo(openDb(':memory:'));
  const server = createApp(repo, { enrich, listModels: fakeModels, defaultModel: 'claude/a' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { repo, call, close: () => server.close() };
}

test('normalizeText strips punctuation and case', () => {
  assert.equal(normalizeText('  "Running," '), 'running');
  assert.equal(normalizeText('Take   into account.'), 'take into account');
});

test('parseJson tolerates fenced output', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('capture, dedupe and enrich per context', async () => {
  const { call, close } = await start();
  try {
    const first = await call('POST', '/api/entries', { text: 'Running', sentence: 'He is running fast.', url: 'https://a' });
    assert.equal(first.status, 201);
    assert.equal(first.body.entry.lemma, 'Runn');
    assert.equal(first.body.entry.enrich_status, 'done');
    assert.equal(first.body.context.translation, '译文');

    const again = await call('POST', '/api/entries', { text: 'running.', sentence: 'Running a company is hard.' });
    assert.equal(again.status, 200);
    assert.equal(again.body.entry.id, first.body.entry.id);

    const dup = await call('POST', '/api/entries', { text: 'running', sentence: 'He is running fast.' });
    assert.equal(dup.body.context.id, first.body.context.id);

    const detail = await call('GET', `/api/entries/${first.body.entry.id}`);
    assert.equal(detail.body.contexts.length, 2);

    const list = await call('GET', '/api/entries?q=runn');
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].context_count, 2);

    await call('PATCH', `/api/entries/${first.body.entry.id}`, { notes: 'hi' });
    assert.equal((await call('GET', `/api/entries/${first.body.entry.id}`)).body.entry.notes, 'hi');

    assert.equal((await call('DELETE', `/api/entries/${first.body.entry.id}`)).status, 204);
    assert.equal((await call('GET', '/api/entries')).body.total, 0);
  } finally {
    close();
  }
});

test('enrichment failure still saves the entry', async () => {
  const { call, close } = await start(async () => {
    throw new Error('offline');
  });
  try {
    const res = await call('POST', '/api/entries', { text: 'serendipity', sentence: 'Pure serendipity.' });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.enrich_status, 'error');
    assert.match(res.body.entry.enrich_error, /offline/);
  } finally {
    close();
  }
});

test('review queue and grading', async () => {
  const { call, repo, close } = await start();
  try {
    const { body } = await call('POST', '/api/entries', { text: 'ephemeral', sentence: 'Fame is ephemeral.' });
    const id = body.entry.id;
    assert.equal((await call('GET', '/api/review/queue')).body.items.length, 0, 'not due until first interval passes');

    repo.db.prepare('UPDATE reviews SET due_at = 0 WHERE entry_id = ?').run(id);
    const queue = await call('GET', '/api/review/queue');
    assert.equal(queue.body.items.length, 1);
    assert.equal(queue.body.items[0].contexts[0].sentence, 'Fame is ephemeral.');
    assert.ok(queue.body.items[0].preview.good > queue.body.items[0].preview.again);

    assert.equal((await call('POST', `/api/review/${id}`, { grade: 'nope' })).status, 400);
    const graded = await call('POST', `/api/review/${id}`, { grade: 'good' });
    assert.equal(graded.body.review.stage, 1);
    assert.equal((await call('GET', '/api/review/queue')).body.items.length, 0);

    const stats = (await call('GET', '/api/review/stats')).body;
    assert.equal(stats.total, 1);
    assert.equal(stats.reviewedToday, 1);
    assert.equal(stats.forecast.length, 7);
    assert.equal((await call('GET', `/api/entries/${id}`)).body.review.stage, 1);
  } finally {
    close();
  }
});

test('model selection is persisted and used for enrichment', async () => {
  const used: string[] = [];
  const { call, close } = await start(async (text, sentence, model) => {
    used.push(model);
    return fakeEnrich(text, sentence, model);
  });
  try {
    assert.equal((await call('GET', '/api/settings')).body.model, 'claude/a');
    assert.equal((await call('GET', '/api/models')).body.items.length, 2);
    assert.equal((await call('PUT', '/api/settings', { model: '' })).status, 400);
    assert.equal((await call('PUT', '/api/settings', { model: 'codex/b' })).body.model, 'codex/b');

    const { body } = await call('POST', '/api/entries', { text: 'lucid', sentence: 'A lucid explanation.' });
    assert.equal(body.entry.enrich_model, 'codex/b');
    const t = await call('POST', '/api/models/test', { model: 'claude/a' });
    assert.equal(t.body.ok, true);
    assert.deepEqual(used, ['codex/b', 'claude/a']);
  } finally {
    close();
  }
});

const lemmaEnrich: Enricher = async (text, sentence) => {
  const lemmas: Record<string, string> = { running: 'run', ran: 'run', runs: 'run', run: 'run', walked: 'walk' };
  return normalize({ lemma: lemmas[text.toLowerCase()] ?? text, meaning: `m:${sentence}` }, text);
};

test('captures sharing a lemma aggregate into one entry', async () => {
  const { call, close } = await start(lemmaEnrich);
  try {
    const a = await call('POST', '/api/entries', { text: 'running', sentence: 'She is running.' });
    assert.equal(a.status, 201);
    const b = await call('POST', '/api/entries', { text: 'ran', sentence: 'He ran home.' });
    assert.equal(b.status, 200);
    assert.equal(b.body.merged, true);
    assert.equal(b.body.entry.id, a.body.entry.id);
    assert.deepEqual(b.body.entry.forms, ['running', 'ran']);
    assert.equal(b.body.context.form, 'ran');

    // A known form now resolves directly, without creating a throwaway entry.
    const c = await call('POST', '/api/entries', { text: 'Ran', sentence: 'They ran out of time.' });
    assert.equal(c.body.entry.id, a.body.entry.id);
    assert.equal(c.body.merged, false);

    const list = await call('GET', '/api/entries');
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].context_count, 3);
    assert.equal((await call('GET', '/api/entries?q=ran')).body.total, 1);
    assert.equal((await call('GET', '/api/review/stats')).body.total, 1);
  } finally {
    close();
  }
});

test('manual merge and startup aggregation', async () => {
  const { call, repo, close } = await start(lemmaEnrich);
  try {
    const walk = await call('POST', '/api/entries', { text: 'walked', sentence: 'We walked.' });
    const stroll = await call('POST', '/api/entries', { text: 'stroll', sentence: 'A stroll.' });
    await call('PATCH', `/api/entries/${stroll.body.entry.id}`, { notes: 'slow walk' });
    const merged = await call('POST', `/api/entries/${stroll.body.entry.id}/merge`, { into: walk.body.entry.id });
    assert.deepEqual(merged.body.entry.forms, ['walked', 'stroll']);
    assert.equal(merged.body.contexts.length, 2);
    assert.equal(merged.body.entry.notes, 'slow walk');
    assert.equal((await call('GET', `/api/entries/${stroll.body.entry.id}`)).status, 404);

    // Legacy duplicates (created before aggregation existed) fold on startup.
    const x = repo.capture({ text: 'runs', sentence: 'It runs.' });
    const y = repo.capture({ text: 'run', sentence: 'Run!' });
    repo.db.prepare("UPDATE entries SET lemma = 'run' WHERE id IN (?, ?)").run(x.entry.id, y.entry.id);
    assert.equal(repo.aggregateByLemma(), 1);
    assert.deepEqual(repo.getEntry(x.entry.id)!.forms, ['runs', 'run']);
  } finally {
    close();
  }
});

test('only the app and the extension may call the API', async () => {
  assert.equal(isAllowedOrigin('chrome-extension://miconkhgngaibdmhchhlggolmdogoeik'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5178'), true);
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1.evil.example'), false);
  assert.equal(isAllowedOrigin('https://my.site', ['https://my.site']), true);

  const { call, close } = await start();
  try {
    const evil = await call('GET', '/api/entries', undefined, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const ext = await call('GET', '/api/entries', undefined, { origin: 'chrome-extension://abc' });
    assert.equal(ext.status, 200);
    const preflight = await call('OPTIONS', '/api/entries', undefined, { origin: 'http://localhost:5173' });
    assert.equal(preflight.status, 204);
  } finally {
    close();
  }
});
