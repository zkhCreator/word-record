import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS, MAX_STAGE, initialState, preview, schedule } from '../src/srs.ts';

test('new card waits the first interval', () => {
  assert.equal(initialState(1000).due_at, 1000 + INTERVALS[0]);
});

test('good climbs the ladder, hard repeats, again resets', () => {
  let s = initialState(0);
  s = schedule(s, 'good', 10);
  assert.deepEqual([s.stage, s.due_at, s.reps], [1, 10 + INTERVALS[1], 1]);
  s = schedule(s, 'good', 20);
  assert.equal(s.stage, 2);
  s = schedule(s, 'hard', 30);
  assert.deepEqual([s.stage, s.due_at], [2, 30 + INTERVALS[2]]);
  s = schedule(s, 'again', 40);
  assert.deepEqual([s.stage, s.lapses, s.reps], [0, 1, 4]);
});

test('stage caps at the last interval', () => {
  let s = { ...initialState(0), stage: MAX_STAGE };
  s = schedule(s, 'good', 0);
  assert.equal(s.stage, MAX_STAGE);
});

test('preview reports interval per grade', () => {
  assert.deepEqual(preview(3), { again: INTERVALS[0], hard: INTERVALS[3], good: INTERVALS[4] });
});
