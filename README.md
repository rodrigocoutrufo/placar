# Placar

App de futebol em tempo real: jogos do dia, placares ao vivo, classificação, chaveamento,
escalações em campo, estatísticas, elencos, artilharia e assistências.

## Rodar

```bash
python server.py
```

Abra http://localhost:8080 (ou `python server.py 8090` para outra porta). Requer só Python 3.10+, sem dependências.

Antes de publicar uma versão, rode o teste de fumaça (sobe o servidor e confere 25 pontos, com dados reais):

```bash
python tests/smoke_test.py
```

## Hospedagem

O projeto já vem pronto para produção: `Dockerfile`, `Procfile`, `.env.example`, rota de saúde `/healthz`,
desligamento limpo (SIGTERM) e o app instalável no celular (PWA).

**Passo a passo (Render, Railway ou Fly.io — todos aceitam o Dockerfile):**
1. Suba o código para um repositório no GitHub (o `.gitignore` já impede o `.env` de ir junto).
2. Crie o serviço apontando para o repositório; ele detecta o `Dockerfile`.
3. Cadastre as variáveis de ambiente do `.env.example` no painel (no mínimo `FUTEBOL_API_KEY` e `FOOTBALL_DATA_TOKEN`).
4. Monte um **disco persistente** em `/data` (já é o `DATA_DIR` da imagem). Sem ele, cada deploy apaga o cache
   e o contador do orçamento diário da API Futebol.
5. Configure o health check em `/healthz` e, se quiser, um domínio próprio (o HTTPS é automático nessas plataformas).
6. Rode **uma instância só**: o cache e o controle de limites ficam na memória e no disco dela.

**Ao publicar mudanças no visual (CSS/JS):** aumente o número em `?v=` nas tags do `public/index.html` e a
`VERSION` do `public/sw.js`. Os arquivos versionados ficam em cache por um ano no navegador dos visitantes;
sem trocar o número, eles continuam vendo a versão antiga.

**O que o servidor faz em produção**
- gzip, `ETag`/304 e cache longo para arquivos versionados (`?v=`); `index.html` e `sw.js` sempre revalidam;
- cabeçalhos de segurança (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS atrás de HTTPS);
- limite por visitante (`RATE_API_MIN`, `RATE_HEAVY_MIN`) para ninguém esgotar as cotas das APIs;
- `/api/me` (que devolve suas chaves) nunca é exposto; `/api/_status` só com `?token=STATUS_TOKEN`;
- log enxuto por requisição (`LOG_LEVEL`).

**Antes de abrir ao público, atenção às fontes**
- A ESPN é uma API pública **não oficial** e o Transfermarkt **proíbe coleta automática** nos termos de uso.
  Para um lançamento comercial, o caminho seguro é ampliar o plano da API Futebol e desligar a ESPN
  (`ESPN_FALLBACK=0`); a parte de Transfermarkt pode ser removida ou trocada por uma fonte licenciada.
- O plano atual da API Futebol tem 100 requisições/dia **para todo o site** (não por visitante). O cache segura
  bem, mas com muitos acessos vale um plano maior.

## De onde vêm os dados

O servidor expõe `/api/*` sempre no formato da API Futebol e combina duas fontes:

| Fonte | Quando é usada |
|---|---|
| **API Futebol** (oficial, `FUTEBOL_API_KEY`) | todo campeonato que faz parte do seu plano |
| **ESPN** (pública, não oficial, `espn.py`) | temporada atual dos campeonatos que o plano ainda não cobre |

Hoje a chave live não tem campeonatos contratados, então tudo vem da ESPN, com dados reais da temporada 2026:
Brasileirão, Série B, Copa do Brasil, Libertadores e Sul-Americana. Quando você ativar campeonatos em
https://dash.api-futebol.com.br, o servidor passa a usar a API Futebol para eles em até 10 minutos, sem mudar código.

Limitações da ESPN:
- não é uma API oficial: não tem garantia, pode mudar sem aviso e não tem licença para uso comercial;
- não informa o número da rodada, então os pontos corridos são navegados por **semana**, com as datas reais;
- não informa o técnico nas escalações.

### Como a documentação da API Futebol foi aplicada

| Documentação | No app |
|---|---|
| Boas práticas: chave só no backend | o navegador fala apenas com `/api/*`; `/me` (que devolve as chaves) nunca é exposto |
| Boas práticas: tarefa agendada + cache | o agendador do `server.py` atualiza ao vivo a cada 30 s, tabelas e rodadas a cada 5 min, notícias a cada 10 min e metadados a cada hora |
| Retry com backoff, timeout | 5xx: novas tentativas em 1 s, 2 s e 4 s; timeout de 20 s |
| Erros 401/403/429 | 401/403 = fora do plano (usa a reserva); 429 e falhas servem o último dado em cache |
| `GET /me` | descobre em tempo de execução quais campeonatos o plano libera |
| Ao vivo a cada 15–30 s | o frontend consulta `/ao-vivo` a cada 30 s |
| `/campeonatos/{id}/fases`, `/partidas` | fases e chaveamento das copas |
| `/times/{id}/partidas/proximas`, `/anteriores`, `/ao-vivo` | página do time (próximo jogo, resultados, jogos) |
| `/noticias` (add-on) | notícias na home, no campeonato e no time, sempre citando a fonte e abrindo a matéria original |
| Status e períodos (`pre-jogo`, `suspensa`, `disputa-penalti`, `intervalo-prorrogacao`) | rótulos no placar |

Sem o add-on Notícias, as notícias vêm da ESPN Brasil (em português).

Desligue a ESPN com `ESPN_FALLBACK=0` no `.env`. `GET /api/_status` mostra o que está sendo usado.
Cada resposta traz o cabeçalho `X-Data-Source` (`live` ou `espn`).

## football-data.org (ligas europeias)

`footballdata.py` adiciona Champions League, Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
Liga Portugal e Eredivisie (`FOOTBALL_DATA_TOKEN` no `.env`), seguindo a referência v4
(https://www.football-data.org/documentation/quickstart):
- temporada inteira em 1 chamada (`/competitions/{c}/matches`), tabela (`/standings`), artilharia (`/scorers`),
  times com técnico e elenco (`/teams/{id}`), jogos do time (`/teams/{id}/matches`), atletas (`/persons/{id}`),
  ao vivo do dia (`/matches`) e confronto direto (`/matches/{id}/head2head`);
- limite do plano gratuito: 10 requisições/min. O módulo nunca passa de 9/min; pedidos de visitantes nunca
  esperam (respondem do cache ou pulam a liga) e o agendador aquece uma liga a cada 25 s;
- o plano gratuito não traz minuto, escalações nem lances: a página da partida mostra placar, árbitros,
  placar do intervalo e confronto direto.

Ordem dos campeonatos: Brasileirão, Copa do Brasil, Libertadores, Sul-Americana, Série B e depois a Europa.

## Orçamento do plano

O plano atual tem **100 requisições por dia** (Série B). O servidor:
- lê o limite em `GET /me` e conta cada chamada em `.cache/orcamento.json` (zera à meia-noite de Brasília);
- guarda as respostas em `.cache/api/`, então reiniciar não gasta o plano de novo;
- usa TTLs longos em plano pequeno (tabela 2 h, rodada 2 h, notícias 2 h, metadados 24 h): cerca de 40 chamadas/dia;
- guarda 10% do limite para abrir partidas; ao esgotar, serve cache e ESPN;
- aplica o placar minuto a minuto da ESPN sobre os jogos oficiais da Série B (consultar `/ao-vivo` a cada 30 s custaria ~2.900/dia).

`GET /api/_status` mostra quantas requisições foram usadas hoje.

## Notícias, minijogos e perfil de jogador

- **Notícias** (`#/noticias`): API Futebol (ge, Lance!, UOL, Placar…) + ESPN Brasil, com filtros por campeonato, time favorito e portal.
- **Minijogos** (`#/minijogos`), com dados reais; progresso salvo no navegador:
  - **Bolão**: palpites dos jogos da semana, filtráveis por campeonato (exato = 3 pts, resultado = 1);
  - **Craque do dia**: um artilheiro por dia (igual para todos no mesmo dia); cada chute compara liga, time,
    posição, idade, nacionalidade e gols (`/api/minijogos/craques`, montado de ESPN + football-data);
  - **Disputa de pênaltis**: escolha os times, cobre e defenda; 5 para cada lado e alternadas;
  - **Quiz de escudos**: 10 escudos por liga, 10 s cada, o escudo vai ficando nítido.
- **Time**: abas Elenco (foto, idade, nacionalidade, altura, pé, contrato e valor de mercado), Títulos (sala de
  troféus por categoria, com temporadas) e Clube (valor do elenco, idade média, estrangeiros, estádio e capacidade)
  — `/api/time-tm`, Transfermarkt.
- **Jogador**: valor de mercado com gráfico, dados pessoais, transferências e títulos do Transfermarkt (`transfermarkt.py`, mesma abordagem do projeto felipeall/transfermarkt-api, com cache de 24 h e 1 requisição/s). Se você hospedar o transfermarkt-api, defina `TRANSFERMARKT_API` no `.env`.

## Outros esportes, onde assistir e "Para você"

- **NBA** (`#/nba`, `sports.py`): jogos do dia com placar ao vivo, box score com titulares e reservas, chance de
  vitória ao longo do jogo, lances e classificação por conferência (ESPN).
- **Fórmula 1** (`#/f1`): próximo GP com contagem regressiva e horários de Brasília, sessão ao vivo (ordem pela
  ESPN), matemática do título, pilotos, construtores, calendário e resultados de cada etapa (Jolpica/Ergast).
- **Tempo real**: a transmissão `/api/stream` também manda o evento `outros` (NBA rolando e sessão de F1).
- **Jogos europeus** (football-data): o servidor acha o mesmo jogo na ESPN e completa minuto, escalações com
  reservas, lances e estatísticas (`espn.bridge`).
- **Onde assistir**: `transmissoes.json` (editável, relido sozinho) com os canais de cada campeonato no Brasil
  + a matéria "onde assistir" do jogo publicada pelos portais (RSS), quando existe.
- **Para você** (`public/foryou.js`): aprende com os times, jogos, campeonatos e notícias que a pessoa abre (os
  pontos valem metade a cada 3 semanas; times seguidos pesam mais), monta o card "Para você" no início, ordena os
  campeonatos e as notícias. Fica no aparelho e sincroniza com a conta.

## Contas (login)

`#/entrar`, `#/cadastro`, `#/conta` — `auth.py`, só biblioteca padrão, banco SQLite em `DATA_DIR/contas.db`.

- **Cadastro** com nome de usuário, e-mail e senha, ou **com o Google** (OAuth 2.0 + PKCE). O botão do Google só
  aparece com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` (passo a passo no `.env.example`).
- **Senhas** com scrypt e sal por usuário; regras mínimas (8+ caracteres, letras e número/símbolo, sem senhas
  óbvias, sem conter usuário/e-mail) e medidor de força no formulário.
- **Captcha** em cadastro, login e "esqueci a senha": próprio, por prova de trabalho (desafio SHA-256 assinado com
  HMAC, válido por 15 min e uma única vez) ou Cloudflare Turnstile com `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET`.
  Campo-armadilha invisível contra robôs.
- **Sessão** em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS; no banco fica só o hash do token. Até 10
  aparelhos por conta, com lista e "sair dos outros".
- **CSRF**: toda escrita exige o cabeçalho `X-Requested-With: placar` e origem do próprio site.
- **Força bruta**: limite por IP e bloqueio da conta por 15 min após 5 senhas erradas; mensagens que não revelam
  se o e-mail existe no "esqueci a senha".
- **E-mail**: confirmação de conta e redefinição de senha por link (1 h, uso único; derruba as outras sessões).
  Sem `SMTP_*`, o link sai no log do servidor (bom para testar).
- **Sincronização**: favoritos, palpites do bolão, simulações, recordes dos minijogos, alertas e tema vão para a
  conta e voltam em qualquer aparelho. Dados da conta nunca ficam no cache do service worker.
- Em produção, defina `PUBLIC_URL` (ex.: `https://placar.onrender.com`) e use um disco persistente em `DATA_DIR`.

## Estrutura

O código fica no pacote `placar/` (fontes, esportes, regras, IA e servidor). O mapa completo, os fluxos de dados e
da IA e os limites de cada fonte estão em **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## IA (grátis, com o Gemini)

O Placar usa o **Gemini** (`gemini-4-hydrogen`), do Google, no plano grátis. Basta uma chave em
https://aistudio.google.com/apikey colocada no `.env` como `GEMINI_API_KEY`. Recursos:

- **Análise IA na partida:** prévia com palpite, leitura ao vivo e resumo do jogo;
- **"Seu dia no futebol":** um resumo no início, a partir dos times e campeonatos que você acompanha;
- **"Pergunte ao Placar":** um assistente que consulta tabela, jogos, chances, notícias, NBA e F1. Exige conta;
- **notícias:** a IA classifica cada manchete por campeonato, categoria e times.

Proteções:
- teto diário de chamadas (`AI_DAILY_REQUESTS`, padrão 400), para não estourar a cota grátis;
- cache em disco, para não perguntar duas vezes a mesma coisa;
- limite por pessoa;
- tempo máximo por resposta.

No plano grátis, o Google pode usar o que é enviado para melhorar os produtos dele. O Placar só envia dados
públicos de futebol e a pergunta da pessoa.

Outras opções no `.env`:
- **Claude**, da Anthropic (`ANTHROPIC_API_KEY`), pago por uso;
- **Ollama**, local (`AI_PROVIDER=ollama`), que só vale a pena com placa de vídeo.

Sem nenhuma, o site funciona igual, só sem os recursos de IA.
## Frontend (React)

O site novo fica em `web/` (React + Vite + Framer Motion) e é servido pelo próprio servidor Python a partir de `web/dist`.
Todas as telas já estão no app novo; a versão anterior continua disponível em `/classic`.

```bash
cd web
npm install        # primeira vez
npm run build      # gera web/dist (o servidor passa a servir o app novo)
npm run dev        # desenvolvimento com recarga instantânea em http://localhost:5173 (usa a API do servidor na porta 8090)
```

Os logos oficiais das emissoras, da NBA e da F1 ficam em `web/public/brands/`.
