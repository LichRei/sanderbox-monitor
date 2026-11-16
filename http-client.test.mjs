import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestJson } from './http-client.mjs';

function setup(responses, extra = {}) {
  const calls = [], waits = [], logs = [];
  const request = createRequestJson({ headers: { secret: 'hidden' },
    fetchImpl: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next; return next; },
    sleep: async ms => waits.push(ms), warn: message => logs.push(message), ...extra });
  return { request, calls, waits, logs };
}
const ok = () => Response.json({ ok: true });
test('retenta 500 e rede preservando exatamente o payload e os identificadores', async () => {
  const x = setup([new Response('private body', { status: 500 }), new TypeError('secret URL'), ok()]);
  const init = { method: 'POST', body: JSON.stringify({ telegram_chat_id: '@test', telegram_message_id: 2, telegram_item_index: 0 }) };
  assert.deepEqual(await x.request('https://example.invalid?secret', init, { operation: 'ingest', retrySafe: true }), { status: 200, body: { ok: true } });
  assert.equal(x.calls.length, 3);
  assert.deepEqual(x.calls.map(c => c[1].body), [init.body, init.body, init.body]);
  assert.deepEqual(x.waits, [1000, 2000]);
  assert.ok(x.logs.every(l => !/secret|private/.test(l)));
});
test('falha persistente não é escondida e identifica operação', async () => {
  const x = setup(Array.from({ length: 3 }, () => new Response('', { status: 503 })));
  await assert.rejects(x.request('x', undefined, { operation: 'sources/checkpoint', retrySafe: true }), /sources\/checkpoint: HTTP 503.*3\/3/);
  assert.equal(x.calls.length, 3);
});
for (const status of [400, 401, 403, 409, 429]) test(`não repete HTTP ${status}`, async () => {
  const x = setup([new Response('', { status })]);
  assert.deepEqual(await x.request('x', {}, { retrySafe: true }), { status, body: null });
  assert.equal(x.calls.length, 1);
});
test('escritas sem contrato idempotente não são repetidas', async () => {
  const x = setup([new Response('', { status: 500 }), ok()]);
  await assert.rejects(x.request('x', {}, { operation: 'metrics' }), /metrics: HTTP 500/);
  assert.equal(x.calls.length, 1);
});
test('prazo esgotado impede nova requisição', async () => {
  const x = setup([ok()], { now: () => 100 });
  await assert.rejects(x.request('x', {}, { deadline: 100, retrySafe: true }), /prazo esgotado/);
  assert.equal(x.calls.length, 0);
});
test('não espera nem repete se backoff ultrapassaria prazo', async () => {
  const x = setup([new Response('', { status: 500 })], { now: () => 100 });
  await assert.rejects(x.request('x', {}, { deadline: 500, retrySafe: true }), /HTTP 500/);
  assert.equal(x.calls.length, 1); assert.deepEqual(x.waits, []);
});
test('timeout e JSON inválido podem recuperar em operação idempotente', async () => {
  const x = setup([new DOMException('sensitive', 'TimeoutError'), new Response('invalid'), ok()]);
  assert.equal((await x.request('x', {}, { retrySafe: true })).body.ok, true);
  assert.equal(x.calls.length, 3);
});
