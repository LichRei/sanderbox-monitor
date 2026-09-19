import test from "node:test";
import assert from "node:assert/strict";
import { extractOfferBlocks } from "./offer-blocks.mjs";

test("mantém uma oferta simples", () => {
  const blocks = extractOfferBlocks("Batman Ano Um\nR$ 39,90\nhttps://amzn.to/batman");
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].text, /Batman Ano Um/);
  assert.match(blocks[0].text, /39,90/);
});

test("separa várias ofertas e seus respectivos preços", () => {
  const blocks = extractOfferBlocks([
    "X-Men Volume 1", "R$ 29,90", "https://amzn.to/xmen", "",
    "Batman Lua Cheia", "R$ 49,90", "https://mercadolivre.com.br/batman",
  ].join("\n"));
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].text, /X-Men Volume 1[\s\S]*29,90/);
  assert.doesNotMatch(blocks[0].text, /49,90/);
  assert.match(blocks[1].text, /Batman Lua Cheia[\s\S]*49,90/);
});

test("remove pontuação colada ao final do link", () => {
  const [block] = extractOfferBlocks("Watchmen R$ 59,90\nhttps://amzn.to/watchmen.");
  assert.equal(block.url, "https://amzn.to/watchmen");
});

test("prioriza links de marketplaces quando a mensagem também divulga redes sociais", () => {
  const blocks = extractOfferBlocks("Siga https://instagram.com/loja\nHQ R$ 20,00\nhttps://amzn.to/hq");
  assert.deepEqual(blocks.map((b) => b.url), ["https://amzn.to/hq"]);
});
