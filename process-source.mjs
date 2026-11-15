import { extractOfferBlocks } from "./offer-blocks.mjs";

const PRICE_RE = /R\$\s?([\d.]+,\d{2})/i;
const COUPON_RE = /cupom[:\s]+([A-Z0-9]{4,})/i;
const COND_RE = /(à vista|no pix|em at[eé] \d+x(?: sem juros)?|sem juros)/i;
const SOURCE_LIMIT = 120;

function parsePrice(text) {
  const match = text.match(PRICE_RE);
  const price = match ? Number(match[1].replace(/\./g, "").replace(",", ".")) : 0;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function processSource({ client, source, ingest, checkpoint, progress, deadline }) {
  let lastId = Number(source.last_seen_id) || 0;
  if (lastId === 0) {
    const [latest] = await client.getMessages(source.telegram_ref, { limit: 1 });
    if (latest) await checkpoint(source.id, latest.id);
    return { messages: 0, accepted: 0, baseline: latest?.id ?? 0 };
  }

  let messages = 0;
  let accepted = 0;
  let partial = false;
  try {
    // Começa no menor ID acima do checkpoint e pagina na direção dos mais novos.
    const history = client.iterMessages(source.telegram_ref, {
      minId: lastId,
      reverse: true,
      limit: SOURCE_LIMIT,
    });
    for await (const message of history) {
      if (message.id <= lastId) continue;
      const blocks = extractOfferBlocks(message.message || "");
      for (const [index, block] of blocks.entries()) {
        if (Date.now() >= deadline) {
          partial = true;
          return { messages, accepted, partial };
        }
        await ingest({
          source_id: String(source.id),
          raw_text: block.text,
          url: block.url,
          price: parsePrice(block.text),
          coupon_code: block.text.match(COUPON_RE)?.[1] || null,
          coupon_conditions: block.text.match(COND_RE)?.[0] || null,
          telegram_message_id: message.id,
          telegram_chat_id: String(source.telegram_chat_id ?? source.telegram_ref),
          telegram_item_index: index,
        });
        accepted++;
      }
      lastId = message.id;
      messages++;
    }
    partial = messages === SOURCE_LIMIT;
    return { messages, accepted, partial };
  } finally {
    // Mesmo com erro, persiste apenas o prefixo inteiramente confirmado.
    if (lastId > Number(source.last_seen_id)) await checkpoint(source.id, lastId);
    await progress(source.id, messages, accepted);
  }
}
