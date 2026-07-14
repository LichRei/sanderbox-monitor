// monitor.mjs — roda a cada ~10 min no GitHub Actions.
// A cada execução: busca os grupos ativos no Supabase (tabela sources), lê as
// mensagens NOVAS de cada um (id > last_seen_id), extrai link/preço/cupom/condições
// e manda pro endpoint /ingest do app. Depois atualiza o last_seen_id de cada grupo.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const {
  API_ID,
  API_HASH,
  TG_SESSION,
  INGEST_URL,
  INGEST_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} = process.env;

for (const [k, v] of Object.entries({ API_ID, API_HASH, TG_SESSION, INGEST_URL, INGEST_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) { console.error("Faltando variável de ambiente:", k); process.exit(1); }
}

const sbHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const URL_RE = /https?:\/\/\S+/;
const PRICE_RE = /R\$\s?([\d.]+,\d{2})/i;
const COUPON_RE = /cupom[:\s]+([A-Z0-9]{4,})/i;
const COND_RE = /(à vista|no pix|em at[eé] \d+x(?: sem juros)?|sem juros)/i;

function parsePrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "").replace(",", "."));
}

async function getSources() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sources?active=eq.true&select=id,telegram_ref,last_seen_id`, { headers: sbHeaders });
  if (!res.ok) throw new Error("Erro ao buscar sources: " + res.status);
  return res.json();
}

async function updateLastSeen(id, lastSeenId) {
  await fetch(`${SUPABASE_URL}/rest/v1/sources?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_id: lastSeenId }),
  });
}

async function ingest(payload) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("Falha no /ingest:", res.status, await res.text());
}

const sources = await getSources();
if (!sources.length) { console.log("Nenhum grupo ativo cadastrado. Encerrando."); process.exit(0); }

const client = new TelegramClient(new StringSession(TG_SESSION), Number(API_ID), API_HASH, { connectionRetries: 3 });
await client.connect();

for (const src of sources) {
  try {
    const lastId = src.last_seen_id || 0;
    const messages = await client.getMessages(src.telegram_ref, { limit: 40 });
    const novas = messages.filter((m) => m.id > lastId).reverse(); // cronológico
    let maxId = lastId;

    for (const m of novas) {
      maxId = Math.max(maxId, m.id);
      const text = m.message || "";
      const url = text.match(URL_RE)?.[0];
      if (!url) continue;
      await ingest({
        source_ref: String(src.id),
        raw_text: text,
        url,
        price: parsePrice(text),
        coupon_code: text.match(COUPON_RE)?.[1] || null,
        coupon_conditions: text.match(COND_RE)?.[0] || null,
      });
    }

    if (maxId > lastId) await updateLastSeen(src.id, maxId);
    console.log(`Grupo ${src.telegram_ref}: ${novas.length} mensagens novas processadas.`);
  } catch (e) {
    console.error(`Erro no grupo ${src.telegram_ref}:`, e.message);
  }
}

await client.disconnect();
process.exit(0);
