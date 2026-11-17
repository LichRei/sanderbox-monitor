# sanderbox-monitor

Monitor de ofertas do Telegram, executado pelo GitHub Actions a cada 30 minutos.

## Verificação

`npm ci` e `npm test` (Node 24). Pull requests executam testes sem acessar Telegram nem ingerir ofertas.

## Recuperação de falhas HTTP

- Leitura de fontes e checkpoint monotônico têm até três tentativas para 5xx, erros de rede e respostas inválidas, com pausas de 1 e 2 segundos.
- Ingestão só é repetida com a identidade estável de canal/mensagem/item. O backend deve manter a chave única, trava de processamento e deduplicação de ofertas existentes. Não remova esse contrato sem desabilitar retries.
- HTTP 409 (em andamento), 4xx e respostas sem confirmação não são sucesso e não avançam o checkpoint. O próximo ciclo retoma a mensagem.
- Antes de começar uma oferta, o monitor reserva uma janela inteira de 50 segundos. Se o orçamento da fonte não comportar a janela, registra `partial: true`, preserva a mensagem não confirmada e retoma no próximo ciclo. Isso evita abortar uma nova escrita apenas por começar perto do fim do orçamento; não resolve lentidão do backend. Acompanhe fontes repetidamente parciais para detectar acúmulo.
- O prazo da fonte limita a ingestão e suas tentativas. Falha persistente continua causando saída 1; não é ocultada.
- Após a primeira passagem por todas as fontes, uma segunda passagem usa o tempo restante da rodada de 9 minutos nas fontes parciais. Recarrega checkpoints confirmados, ignora fontes removidas e preserva a janela segura de 50 segundos. Há no máximo uma recuperação por fonte; falhas continuam visíveis e o modo somente leitura não ingere ofertas.
- Métricas não são repetidas, pois podem incrementar contadores sem chave idempotente.
- Os logs identificam a operação (`ingest`, `sources/read`, `sources/checkpoint`, `metrics`) e a tentativa, sem imprimir payloads, respostas brutas, URLs ou credenciais.

Isso reduz falhas transitórias, mas não garante disponibilidade do backend nem informa a causa interna de um HTTP 500. Para isso, correlacione horário e operação com os logs do app.

