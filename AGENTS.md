# Vyra — guia para agentes (Codex e outros)

App de placar ao vivo: futebol (Brasileirão, Série B, Copa do Brasil, Libertadores, Sul-Americana, Champions e ligas
europeias), NBA e Fórmula 1. Interface e textos em **português do Brasil**.

## Estrutura
- `server.py` — ponto de entrada (`python server.py [porta]`, padrão 8080). Chama `placar.server.main`.
- `placar/` — backend em Python **só com a biblioteca padrão** (sem frameworks):
  - `server.py` — HTTP, rotas `/api/...`, cache, SSE (`/api/stream`), CSP, agendador em segundo plano.
    `/api/agenda` junta numa resposta os jogos de todos os campeonatos (de 21 dias atrás a 30 à frente) para a página inicial:
    não volte a montar isso no navegador (eram ~200 chamadas e estourava o limite por visitante).
    A última agenda e a lista de campeonatos ficam em disco (`agenda.json`, `pronto/`): depois de reiniciar, a página inicial abre na hora
    com a cópia enquanto a nova é montada em segundo plano (`swr()` em `placar/server.py`).
  - `sources/` — fontes de dados: `espn.py` (ESPN, grátis e sem chave: Brasil, Conmebol e ~30 campeonatos extras com IDs 201+ —
    estaduais, ligas sul-americanas, Europa League, Conference, segundas divisões, copas nacionais, MLS, Liga MX, Arábia, Japão,
    Liga das Nações; temporada pelo `season.year` de cada jogo, etapas (Apertura/Clausura, fases) pelo `season.type`; rodadas reconstruídas), `footballdata.py`, `news_rss.py`, `transfermarkt.py`, `stadium.py` (estádio via Wikipédia/Wikidata, cache de 30 dias).
  - `sports/` — `nba.py` (ESPN), `f1.py` (Jolpica/Ergast + ESPN ao vivo), `openf1.py` (análise oficial de corrida, sessões encerradas), `f1_season.py` (temporada inteira da Jolpica: duelo com o companheiro, aba Temporada com evolução, líderes, duelos internos e simulador, comparar pilotos, vencedores do circuito). `f1_circuit.py` (página da etapa: traçado da MultiViewer — ou da OpenF1 em circuito novo —, ficha, recorde, previsão do tempo pela Open-Meteo e última edição). A Jolpica limita 4 pedidos/s e 500/hora: **toda** chamada a ela passa por `_jget` (espaça e pausa 2 min depois de um 429); as respostas da Jolpica, OpenF1, MultiViewer e Open-Meteo ficam também em disco (`DATA_DIR/f1`, ver `sports/common.py`), então reiniciar não pede tudo de novo; sem Jolpica e sem cópia, a classificação vem da OpenF1 e as páginas de piloto/equipe mostram o que tiverem.
  - `search.py` — busca do site (`/api/busca?q=`): índice de campeonatos e times (futebol, NBA, F1) montado no servidor + jogadores pela busca da ESPN; apelidos ("timão", "jr").
  - `core/` — `prob.py` (probabilidades), `auth.py` (contas, sessões, captcha PoW), `identity.py`, `news_filter.py`, `webpush.py` (avisos com o site fechado: Web Push com criptografia em Python puro — P-256, ECDSA/VAPID, AES-128-GCM —, inscrições em `DATA_DIR/push.db`, envio a cada evento do ao vivo; rotas `/api/push/*`), `sala.py` (Sala do jogo: bate-papo com moderação — palavrão disfarçado, ofensa recusada, sem links, 3 denúncias escondem —, reações, enquetes automáticas puxadas pelos lances e nota da torcida; tempo real por sala em `/api/sala/{id}/eventos`), `venues.py` (nome atual dos estádios — naming rights como Nubank Parque —, aplicado pelo servidor em toda resposta com estádio; nome novo no começo do grupo).
  - `ai/` — IA: `client.py` (Gemini padrão; Anthropic se `ANTHROPIC_API_KEY`; Ollama opcional), `insights.py`, `assistant.py`, `news.py`, `foryou.py`.
    A qualidade vem dos FATOS (montados em `ai_routes.py`: forma com placares, situação na tabela, artilheiro, tabela refeita pelos resultados no momento do jogo) e do guia de estilo em `insights.py` (lista de clichês proibidos: se aparecerem, pede de novo). O `effort` vira o nível de raciocínio do Gemini.
- `web/` — frontend novo: **React 19 + Vite + Framer Motion + TanStack Query**, rotas por hash (`#/...`).
  - `src/pages/` telas, `src/components/` (Shell, ui, match, Intro, Assistant), `src/lib/` (api, store, live, mode, themes, format, data, registry).
  - `src/styles/` — `base.css` (tokens e componentes), `screens.css`, `pages.css`. Visual "transmissão esportiva": Barlow Condensed + Inter.
  - `public/brands/` — logos oficiais (emissoras, NBA, F1).
  - Compilado em `web/dist`, que o servidor Python serve em `/`.
- `public/` — frontend antigo (vanilla JS). Não é mais exposto; o servidor só usa como reserva se `web/dist` não existir.
- `data/transmissoes.json` — onde assistir (editável, relido quando muda).
- `tests/` — `smoke_test.py` (sobe o servidor e confere ~55 itens), `test_ai.py` (unitários de IA) `test_webpush.py` (criptografia do push conferida com a RFC 8291) e `test_avisos.py` (cartão vermelho, pênalti, gol anulado, 15 min antes e escalação, simulados) `test_ai_contexto.py` (fatos da IA: tabela no momento do jogo, zonas, nomes) e `test_sala.py` (Sala do jogo).

## Rodar
```bash
pip install -r requirements.txt --target .deps   # opcional (SDK da Anthropic)
cd web && npm install && npm run build && cd ..
python server.py            # http://localhost:8080
cd web && npm run dev       # desenvolvimento em http://localhost:5173 (proxy /api -> 8090; ver vite.config.js)
```

## Testes
```bash
python tests/smoke_test.py
python -m unittest tests.test_ai tests.test_webpush tests.test_avisos tests.test_ai_contexto tests.test_sala
```
Os testes de IA zeram as chaves antes de importar: **nunca** chamar IA real nos testes.

## Regras importantes
- Segredos só no `.env` (nunca versionar; há `.env.example`). Nunca expor chaves ao frontend; `/api/me` fica bloqueado.
  Única exceção: `GOOGLE_MAPS_EMBED_KEY` (Street View do estádio) vai no endereço do iframe, como o Google exige; deve ser restrita ao domínio e à Maps Embed API.
- Backend sem dependências externas obrigatórias; manter a biblioteca padrão.
- Textos visíveis em português; comentários no código também.
- CSP restrita (ver `CSP` em `placar/server.py`): scripts só do próprio site; imagens https; áudio do rádio da F1 liberado em `media-src`.
- Rotas de esportes passam por uma lista permitida em `placar/server.py` (regex com `/esportes/...`): rota nova precisa entrar lá também.

## Pendências / próximos passos combinados
1. **IAs "infinitas"**: rodízio entre vários provedores (Gemini, Anthropic, outros grátis) para os créditos não acabarem — `placar/ai/client.py` já tem a base (teto diário `AI_DAILY_REQUESTS`, fallback de modelos do Gemini).
2. **Hospedagem** (Render ou similar): há `Dockerfile` com build do React em duas etapas.
3. Possíveis fontes extras avaliadas: API-Sports (precisa de chave, 100 req/dia), Sportradar (pago, enterprise).
