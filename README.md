# sanderbox-monitor

Monitor de ofertas do Telegram, executado pelo GitHub Actions a cada 30 minutos.

## Verificação

`npm ci` e `npm test` (Node 24). Pull requests executam testes sem acessar Telegram nem ingerir ofertas.

## Recuperação de falhas HTTP

- Leitura de fontes e checkpoint monotônico têm até três tentativas para 5xx, erros de rede e respostas inválidas, com pausas de 1 e 2 segundos.
- Ingestão só é repetida com a identidade estável de canal/mensagem/item. O backend deve manter a chave única, trava de processamento e deduplicação de ofertas existentes. Não remova esse contrato sem desabilitar retries.
- HTTP 409 (em andamento), 4xx e respostas sem confirmação não são sucesso e não avançam o checkpoint. O próximo ciclo retoma a mensagem.
- O prazo da fonte limita a ingestão e suas tentativas. Falha persistente continua causando saída 1; não é ocultada.
- Métricas não são repetidas, pois podem incrementar contadores sem chave idempotente.
- Os logs identificam a operação (`ingest`, `sources/read`, `sources/checkpoint`, `metrics`) e a tentativa, sem imprimir payloads, respostas brutas, URLs ou credenciais.

Isso reduz falhas transitórias, mas não garante disponibilidade do backend nem informa a causa interna de um HTTP 500. Para isso, correlacione horário e operação com os logs do app.
