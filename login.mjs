// login.mjs — RODE UMA VEZ, no seu computador, pra gerar a "string session".
// Passos:
//   1. npm install
//   2. API_ID=xxxx API_HASH=xxxx node login.mjs
//   3. Digite seu telefone (+55...), o código que o Telegram enviar e (se tiver) a senha 2FA.
//   4. Copie a string que aparecer no final e guarde como o secret TG_SESSION no GitHub.
// A string session equivale ao login da conta — trate como senha. Use uma conta secundária.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;

if (!apiId || !apiHash) {
  console.error("Faltam API_ID e API_HASH. Pegue em https://my.telegram.org > API development tools.");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () => await input.text("Seu telefone (+55...): "),
  password: async () => await input.text("Senha 2FA (deixe vazio se não tiver): "),
  phoneCode: async () => await input.text("Código que o Telegram enviou: "),
  onError: (err) => console.log(err),
});

console.log("\n==================== COPIE ISTO ====================");
console.log("TG_SESSION =");
console.log(client.session.save());
console.log("====================================================");
console.log("Guarde como secret TG_SESSION no GitHub. Não compartilhe.\n");

await client.disconnect();
process.exit(0);
