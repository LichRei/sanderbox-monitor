import assert from "node:assert/strict";
import test from "node:test";
import { processSource } from "./process-source.mjs";

const source = { id: "fonte", telegram_ref: "@fonte", last_seen_id: 1 };
const message = (id, text) => ({ id, message: text });
const link = "https://amzn.to/abc";

test("confirma somente o prefixo completo quando a segunda oferta de um post falha", async () => {
  const checkpoints = [];
  const received = [];
  await assert.rejects(processSource({
    client: { async *iterMessages() {
      yield message(2, link);
      yield message(3, `Oferta 1\n${link}\nOferta 2\nhttps://meli.la/def`);
      yield message(4, link);
    } },
    source,
    ingest: async (item) => {
      received.push([item.telegram_message_id, item.telegram_item_index]);
      if (item.telegram_item_index === 1) throw new Error("HTTP 500");
    },
    checkpoint: async (id, lastId) => checkpoints.push([id, lastId]),
    progress: async () => {},
    deadline: Infinity,
  }), /HTTP 500/);
  assert.deepEqual(received, [[2, 0], [3, 0], [3, 1]]);
  assert.deepEqual(checkpoints, [["fonte", 2]]);
});

test("processa mais de 40 mensagens a partir do checkpoint mais antigo", async () => {
  const seen = [];
  const result = await processSource({
    client: { async *iterMessages(_ref, options) {
      assert.deepEqual(options, { minId: 1, reverse: true, limit: 120 });
      for (let id = 2; id <= 60; id++) yield message(id, link);
    } },
    source,
    ingest: async (item) => seen.push(item.telegram_message_id),
    checkpoint: async (id, lastId) => assert.deepEqual([id, lastId], ["fonte", 60]),
    progress: async () => {},
    deadline: Infinity,
  });
  assert.equal(result.messages, 59);
  assert.equal(seen[0], 2);
  assert.equal(seen.at(-1), 60);
});

test("uma fonte nova apenas registra o primeiro checkpoint", async () => {
  const result = await processSource({
    client: { async getMessages() { return [message(24, link)]; } },
    source: { ...source, last_seen_id: null },
    ingest: async () => assert.fail("baseline não deve ingerir"),
    checkpoint: async (_id, lastId) => assert.equal(lastId, 24),
    progress: async () => {},
    deadline: Infinity,
  });
  assert.equal(result.baseline, 24);
});
