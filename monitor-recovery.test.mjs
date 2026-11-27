import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(state, fail) {
  const child = spawnSync(process.execPath, ['--import', './fixtures/offline-monitor.mjs', 'monitor.mjs'], {
    cwd: new URL('./', import.meta.url), encoding: 'utf8', timeout: 15000,
    env: {
      API_ID: '1', API_HASH: 'fixture', TG_SESSION: 'fixture', INGEST_SECRET: 'fixture',
      SANDERBOX_URL: 'https://monitor.invalid', FIXTURE_STATE: JSON.stringify(state), FIXTURE_FAIL: fail ? '1' : '0',
    },
  });
  assert.ifError(child.error);
  const line = child.stdout.split('\n').find(line => line.startsWith('fixture='));
  assert.ok(line, child.stderr);
  return { ...JSON.parse(line.slice(8)), status: child.status, errors: child.stderr };
}

test('retoma mensagem com dois itens após 522 e reserva ativa, pelo ponto de entrada do monitor', () => {
  const first = run({ checkpoint: 10, offers: [] }, true);
  const keys = ['@fixture/12/0', '@fixture/12/1'];
  assert.equal(first.status, 1);
  assert.equal(first.state.checkpoint, 11);
  assert.deepEqual(first.attempts, [...keys, keys[1]]);
  assert.match(first.errors, /ingest mensagem 12 item 1: HTTP 522/);
  assert.match(first.errors, /ingest mensagem 12 item 1: HTTP 409/);
  assert.doesNotMatch(first.errors, /Fixture privada|amzn\.to/);

  const next = run(first.state, false);
  assert.equal(next.status, 0);
  assert.equal(next.state.checkpoint, 12);
  assert.deepEqual(next.attempts, keys);
  assert.deepEqual(next.state.offers, keys);
  for (const result of [first, next]) {
    assert.deepEqual(result.metrics, [{ source_id: 'source', total_mensagens: 1 }]);
  }
});
