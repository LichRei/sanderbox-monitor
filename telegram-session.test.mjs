import assert from "node:assert/strict";
import test from "node:test";
import { AuthKey } from "telegram/crypto/AuthKey.js";
import { StringSession } from "telegram/sessions/index.js";

test("carrega uma sessão MTProto no runtime Node sem usar rede", async () => {
  const key = Buffer.alloc(256, 7);
  const authKey = new AuthKey();
  await authKey.setKey(key);
  const session = new StringSession("");
  session.setDC(2, "192.0.2.1", 443);
  session.authKey = authKey;

  const restored = new StringSession(session.save());
  await restored.load();
  assert.deepEqual(restored.authKey.getKey(), key);
  assert.equal(restored.dcId, 2);
});
