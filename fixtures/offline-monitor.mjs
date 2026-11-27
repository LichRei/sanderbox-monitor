// Loaded only by the monitor integration test. All external I/O is simulated.
import { registerHooks } from 'node:module';

const telegram = `
export class TelegramClient {
  async connect() {}
  async disconnect() {}
  async *iterMessages(ref, { minId }) {
    if (minId < 11) yield { id: 11, message: 'sem oferta' };
    if (minId < 12) yield { id: 12, message: 'Fixture privada A R$ 19,00 https://amzn.to/a\\n\\nFixture privada B R$ 25,00 https://amzn.to/b' };
  }
}`;
registerHooks({
  resolve(specifier, context, next) {
    const source = specifier === 'telegram' ? telegram
      : specifier === 'telegram/sessions/index.js' ? 'export class StringSession {}' : null;
    return source === null ? next(specifier, context)
      : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) };
  },
});
const state = JSON.parse(process.env.FIXTURE_STATE);
const attempts = [];
const metrics = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.origin !== 'https://monitor.invalid') throw Error('Unexpected origin');
  const body = init?.body ? JSON.parse(init.body) : null;
  if (url.pathname === '/api/public/sources') {
    if (!body) return Response.json([{ id: 'source', telegram_ref: '@fixture', last_seen_id: state.checkpoint }]);
    state.checkpoint = body.last_seen_id;
  } else if (url.pathname === '/api/public/metrics') {
    metrics.push(body);
  } else if (url.pathname === '/api/public/ingest') {
    const key = [body.telegram_chat_id, body.telegram_message_id, body.telegram_item_index].join('/');
    attempts.push(key);
    if (!state.offers.includes(key)) state.offers.push(key);
    // The write took effect, but the reply was lost. The next try sees the active claim.
    if (body.telegram_item_index === 1 && process.env.FIXTURE_FAIL === '1') {
      const status = attempts.filter(k => k === key).length === 1 ? 522 : 409;
      return new Response('Fixture privada', { status });
    }
  } else {
    throw Error('Unexpected path');
  }
  return Response.json({ ok: true });
};
process.on('exit', () => console.log('fixture=' + JSON.stringify({ state, attempts, metrics })));
