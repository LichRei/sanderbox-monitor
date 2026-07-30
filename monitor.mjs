// monitor.mjs — roda a cada ~5 min no GitHub Actions.
// A cada execução:
//  1. busca os grupos ativos no Supabase (tabela sources)
//  2. lê as mensagens novas de cada um (id > last_seen_id)
//  3. extrai link/preço/cupom/condições e envia pro endpoint /api/public/ingest
//  4. atualiza last_seen_id e reporta métricas em /api/public/metrics
//
// Se last_seen_id == 0, faz apenas baseline: grava o id mais recente sem processar.
//
// Todas as chamadas de rede usam fetchWithRetry (timeout 15s + backoff exponencial).

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
  METRICS_URL, // opcional — se ausente, derivamos do INGEST_URL
} = process.env;

for (const [k, v] of Object.entries({ API_ID, API_HASH, TG_SESSION, INGEST_URL, INGEST_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) { console.error("Faltando variável de ambiente:", k); process.exit(1); }
}

const METRICS_ENDPOINT = METRICS_URL || INGEST_URL.replace(/\/ingest\/?$/, "/metrics");

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

async function fetchWithRetry(url, init = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(t);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function getSources() {
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/sources?active=eq.true&select=id,telegram_ref,last_seen_id`, { headers: sbHeaders });
  if (!res.ok) throw new Error("Erro ao buscar sources: " + res.status);
  return res.json();
}

async function updateLastSeen(id, lastSeenId) {
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/sources?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_id: lastSeenId }),
  });
}

async function ingest(payload) {
  try {
    const res = await fetchWithRetry(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Falha no /ingest:", res.status, await res.text());
  } catch (e) {
    console.error("Falha no /ingest (rede):", e.message);
  }
}

async function reportMetrics(source_id, total_mensagens, total_ofertas_extraidas) {
  try {
    await fetchWithRetry(METRICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
      body: JSON.stringify({ source_id, total_mensagens, total_ofertas_extraidas }),
    });
  } catch (e) {
    console.error("Falha em /metrics:", e.message);
  }
}

const sources = await getSources();
if (!sources.length) { console.log("Nenhum grupo ativo cadastrado. Encerrando."); process.exit(0); }

const client = new TelegramClient(new StringSession(TG_SESSION), Number(API_ID), API_HASH, { connectionRetries: 3 });
await client.connect();

for (const src of sources) {
  try {
    const lastId = src.last_seen_id || 0;
    const messages = await client.getMessages(src.telegram_ref, { limit: 40 });

    // Baseline: se last_seen_id == 0, só grava o id mais recente sem processar nada.
    if (lastId === 0) {
      const maxId = messages.reduce((acc, m) => Math.max(acc, m.id), 0);
      if (maxId > 0) await updateLastSeen(src.id, maxId);
      await reportMetrics(src.id, 0, 0);
      console.log(`Grupo ${src.telegram_ref}: baseline definido em id ${maxId} (sem processar).`);
      continue;
    }

    const novas = messages.filter((m) => m.id > lastId).reverse(); // cronológico
    let maxId = lastId;
    let ofertas = 0;

    for (const m of novas) {
      const text = m.message || "";
      const url = text.match(URL_RE)?.[0];
      if (!url) { maxId = Math.max(maxId, m.id); await updateLastSeen(src.id, maxId); continue; }
      // Mercado Livre agora é manual — mandamos o link limpo; o admin cola
      // o link de afiliado depois no painel "Links Pendentes ML".
      await ingest({
        source_id: String(src.id),
        raw_text: text,
        url,
        price: parsePrice(text),
        coupon_code: text.match(COUPON_RE)?.[1] || null,
        coupon_conditions: text.match(COND_RE)?.[0] || null,
        telegram_message_id: m.id,
        telegram_chat_id: String(src.telegram_chat_id ?? src.telegram_ref),
      });
      ofertas++;
      maxId = Math.max(maxId, m.id);
      await updateLastSeen(src.id, maxId);
    }

    await reportMetrics(src.id, novas.length, ofertas);
    console.log(`Grupo ${src.telegram_ref}: ${novas.length} msg / ${ofertas} ofertas.`);
  } catch (e) {
    console.error(`Erro no grupo ${src.telegram_ref}:`, e.message);
  }
}

await client.disconnect();
process.exit(0);

