import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPartials } from './recover-partials.mjs';

test('recovery reloads checkpoints, excludes removed/nonpartial sources and shares remaining budget', async () => {
  const calls = [];
  let time = 100;
  await recoverPartials({
    pendingIds: new Set(['1', '2', 'removed']),
    getSources: async () => [{ id: 1, last_seen_id: 25 }, { id: 2, last_seen_id: 60 }, { id: 3 }],
    process: async (source, deadline) => { calls.push([source.id, source.last_seen_id, deadline]); time += 50; },
    deadline: 500, minBudgetMs: 50, now: () => time,
  });
  assert.deepEqual(calls, [[1, 25, 300], [2, 60, 500]]);
});

test('recovery does not read or ingest without pending sources or a full safe window', async () => {
  for (const pendingIds of [new Set(), new Set(['1'])]) {
    await recoverPartials({ pendingIds, deadline: 150, minBudgetMs: 50, now: () => 100,
      getSources: async () => { assert.fail('must not read'); }, process: async () => { assert.fail('must not ingest'); } });
  }
});

test('recovery rechecks budget after loading checkpoints and never starts a tight window', async () => {
  let time = 0;
  await recoverPartials({ pendingIds: new Set(['1']), deadline: 100, minBudgetMs: 50, now: () => time,
    getSources: async () => { time = 60; return [{ id: 1 }]; },
    process: async () => { assert.fail('must not ingest'); } });
});

test('recovery does not hide errors or loop indefinitely on partial sources', async () => {
  const args = { pendingIds: new Set(['1']), getSources: async () => [{ id: 1 }], deadline: 500, minBudgetMs: 50, now: () => 0 };
  await assert.rejects(recoverPartials({ ...args, process: async () => { throw new Error('checkpoint'); } }), /checkpoint/);
  let count = 0;
  await recoverPartials({ ...args, process: async () => { count++; return { partial: true }; } });
  assert.equal(count, 1);
});
