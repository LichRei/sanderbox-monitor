// monitor.mjs — roda a cada 30 min no GitHub Actions.
// A cada execução:
//  1. busca os grupos ativos no Supabase (tabela sources)
//  2. lê as mensagens novas de cada um (id > last_seen_id)
//  3. extrai link/preço/cupom/condições e envia pro endpoint /api/public/ingest
//  4. atualiza last_seen_id e reporta métricas em /api/public/metrics
//
// Se last_seen_id == 0, faz apenas baseline: grava o id mais recente sem processar.
//
// As chamadas ao site têm timeout e retentativas limitadas.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { processSource } from "./process-source.mjs";
import { createRequestJson } from "./http-client.mjs";
import { recoverPartials } from "./recover-partials.mjs";

const {
  API_ID,
  API_HASH,
  TG_SESSION,
  TELEGRAM_READ_ONLY,
  INGEST_URL,
  INGEST_SECRET,
  METRICS_URL, // opcional — se ausente, derivamos do INGEST_URL
  SOURCES_URL, // opcional — se ausente, derivamos do INGEST_URL
  SANDERBOX_URL, // endereço canônico do app; evita depender de URL antiga nos secrets
} = process.env;

const BASE_URL = SANDERBOX_URL?.replace(/\/+$/, "");
const INGEST_ENDPOINT = BASE_URL ? `${BASE_URL}/api/public/ingest` : INGEST_URL;
const METRICS_ENDPOINT = METRICS_URL || (BASE_URL
  ? `${BASE_URL}/api/public/metrics`
  : INGEST_ENDPOINT?.replace(/\/ingest\/?$/, "/metrics"));
const SOURCES_ENDPOINT = SOURCES_URL || (BASE_URL
  ? `${BASE_URL}/api/public/sources`
  : INGEST_ENDPOINT?.replace(/\/ingest\/?$/, "/sources"));

for (const [k, v] of Object.entries({ API_ID, API_HASH, TG_SESSION, INGEST_ENDPOINT, INGEST_SECRET })) {
  if (!v) { console.error("Faltando variável de ambiente:", k); process.exit(1); }
}

// Todas as leituras e escritas passam pelo app, autenticadas pelo mesmo
// segredo do /ingest. O robô não fala mais direto com o banco, então a
// service_role key deixou de ser necessária (e saiu dos secrets).
const appHeaders = {
  "Content-Type": "application/json",
  "x-ingest-secret": INGEST_SECRET,
};

const requestJson = createRequestJson({ headers: appHeaders });
const INGEST_TIMEOUT_MS = 50_000;

function requireOk(response, endpoint) {
  if (response.body?.ok !== true) throw new Error(`${endpoint}: HTTP ${response.status} sem confirmação`);
}

async function getSources() {
  const { body, status } = await requestJson(SOURCES_ENDPOINT, undefined, { operation: "sources/read", retrySafe: true });
  const sources = Array.isArray(body) ? body : body?.sources;
  if (!Array.isArray(sources)) throw new Error(`Falha ao buscar fontes: HTTP ${status}`);
  return sources;
}

async function updateLastSeen(id, lastSeenId) {
  const response = await requestJson(SOURCES_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ source_id: id, last_seen_id: lastSeenId }),
  }, { operation: "sources/checkpoint", retrySafe: true });
  requireOk(response, "checkpoint");
}

async function ingest(payload, deadline) {
  // A ingestão inclui enriquecimento e pode ultrapassar o timeout das outras rotas.
  const response = await requestJson(INGEST_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
  }, {
    operation: "ingest", timeoutMs: INGEST_TIMEOUT_MS, deadline,
    // The backend deduplicates by chat/message/item and returns 409 for an active claim.
    retrySafe: !!payload.telegram_chat_id && Number.isInteger(payload.telegram_message_id)
      && Number.isInteger(payload.telegram_item_index),
  });
  requireOk(response, "ingest");
}

async function reportMetrics(source_id, total_mensagens, total_ofertas_extraidas) {
  try {
    const response = await requestJson(METRICS_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ source_id, total_mensagens, total_ofertas_extraidas }),
    }, { operation: "metrics", retrySafe: false });
    requireOk(response, "métricas");
  } catch (err) {
    console.error("Falha em /metrics:", err.message);
  }
}

const sources = await getSources();
if (!sources.length) {
  console.log("Nenhum grupo ativo cadastrado. Encerrando.");
  process.exit(0);
}

const client = new TelegramClient(new StringSession(TG_SESSION), Number(API_ID), API_HASH, {
  connectionRetries: 3,
  floodSleepThreshold: 15,
});
let failed = 0;
try {
  await client.connect();
  const firstPassDeadline = Date.now() + 9 * 60_000;
  const recoveryDeadline = firstPassDeadline + 7 * 60_000;
  const pendingIds = new Set();
  for (const [index, source] of sources.entries()) {
    // Divide o tempo restante entre as fontes para um pico em uma delas não monopolizar a rodada.
    const remaining = firstPassDeadline - Date.now();
    if (remaining <= 0) {
      failed++;
      console.error("Tempo da rodada esgotado antes de verificar todas as fontes.");
      break;
    }
    try {
      if (TELEGRAM_READ_ONLY === "1") {
        await client.getMessages(source.telegram_ref, { limit: 1 });
        console.log(`Grupo ${source.telegram_ref}: leitura validada.`);
        continue;
      }
      const result = await processSource({
        client,
        source,
        ingest,
        // Não comece uma escrita que o prazo da fonte abortaria prematuramente.
        minIngestBudgetMs: INGEST_TIMEOUT_MS,
        checkpoint: updateLastSeen,
        progress: reportMetrics,
        deadline: Date.now() + Math.ceil(remaining / (sources.length - index)),
      });
      console.log(`Grupo ${source.telegram_ref}: ${JSON.stringify(result)}`);
      if (result.partial) pendingIds.add(String(source.id));
    } catch (err) {
      failed++;
      console.error(`Erro no grupo ${source.telegram_ref}:`, err.message);
    }
  }
  if (TELEGRAM_READ_ONLY !== "1") {
    try {
      await recoverPartials({
        pendingIds, getSources, deadline: recoveryDeadline, minBudgetMs: INGEST_TIMEOUT_MS,
        process: async (source, sourceDeadline) => {
          try {
            const result = await processSource({
              client, source, ingest, checkpoint: updateLastSeen, progress: reportMetrics,
              minIngestBudgetMs: INGEST_TIMEOUT_MS, deadline: sourceDeadline,
            });
            console.log(`Recuperação ${source.telegram_ref}: ${JSON.stringify(result)}`);
            if (result.partial) {
              console.warn("::warning::Uma fonte terminou a recuperação com mensagens restantes. Veja o resultado da recuperação no log.");
            }
          } catch (err) {
            failed++;
            console.error(`Erro na recuperação ${source.telegram_ref}:`, err.message);
          }
        },
      });
    } catch (err) {
      failed++;
      console.error("Erro ao preparar recuperação:", err.message);
    }
  }
} finally {
  await client.disconnect();
}
process.exit(failed ? 1 : 0);

