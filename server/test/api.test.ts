import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { Repo, normalizeText } from '../src/repo.ts';
import { createApp } from '../src/app.ts';
import { normalize, parseJson, type Enricher } from '../src/magpie.ts';

const fakeEnrich: Enricher = async (text, sentence) =>
  normalize({ lemma: text.replace(/ing$/, ''), meaning: `义:${sentence.length}`, translation: '译文' }, text);

async function start(enrich: Enricher = fakeEnrich) {
  const repo = new Repo(openDb(':memory:'));
  const server = createApp(repo, enrich).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
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
