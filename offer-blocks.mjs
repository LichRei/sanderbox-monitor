const URL_RE = /https?:\/\/[^\s\)\]<>{}"']+/gi;
const MARKETPLACE_HOST_RE = /(?:amazon\.com\.br|amzn\.to|mercadolivre\.com\.br|meli\.la|shopee\.com\.br|s\.shopee|magazineluiza\.com\.br|magalu\.com|kabum\.com\.br|aliexpress\.com)/i;

function cleanUrl(value) {
  return value.replace(/[.,;:!?]+$/g, "");
}

/**
 * Divide um post do Telegram em blocos independentes, um por link de oferta.
 * Os grupos normalmente escrevem título/preço antes do link; por isso cada
 * URL fecha o bloco acumulado. O texto depois do último link permanece no
 * último item para preservar cupom e condições escritos ao final.
 */
export function extractOfferBlocks(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const allUrls = lines.flatMap((line) => (line.match(URL_RE) ?? []).map(cleanUrl));
  const marketplaceUrls = allUrls.filter((url) => MARKETPLACE_HOST_RE.test(url));
  const accepted = new Set(marketplaceUrls.length > 0 ? marketplaceUrls : allUrls);
  if (accepted.size === 0) return [];

  const blocks = [];
  let pending = [];

  for (const line of lines) {
    const urls = (line.match(URL_RE) ?? []).map(cleanUrl).filter((url) => accepted.has(url));
    if (urls.length === 0) {
      pending.push(line);
      continue;
    }

    const description = line.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
    if (description) pending.push(description);

    for (const url of urls) {
      const scoped = [...pending, url].join("\n").trim();
      blocks.push({ url, text: scoped || url });
      pending = [];
    }
  }

  const trailing = pending.join("\n").trim();
  if (trailing && blocks.length > 0) {
    blocks[blocks.length - 1].text = `${blocks[blocks.length - 1].text}\n${trailing}`.trim();
  }

  return blocks;
}
