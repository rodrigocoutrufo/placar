/* Placar — telas extras: Notícias, Minijogos e perfil Transfermarkt do jogador.
 * Carregado antes do app.js; usa os helpers de lá (api, esc, crest, ...) só em tempo de execução. */
'use strict';

/* ================= Notícias ================= */
const NEWS_COMPS = [[0, 'Tudo'], [10, 'Brasileirão'], [14, 'Série B'], [2, 'Copa do Brasil'], [7, 'Libertadores'], [9, 'Sul-Americana'],
  [106, 'Champions'], [101, 'Premier League'], [102, 'La Liga'], [103, 'Serie A'], [104, 'Bundesliga'], [105, 'Ligue 1'], [107, 'Liga Portugal']];

function newsItem(x, big = false) {
  const teams = (x.times || []).slice(0, 4).map((t) => crest(t, 16)).join('');
  return `<a class="nw ${big ? 'big' : ''}" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" data-tt="${esc((x.times || []).map((t) => t.time_id).join(','))}">
    ${x.imagem ? `<div class="nw-img"><img src="${esc(x.imagem)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>` : ''}
    <div class="nw-body">
      <div class="nw-title">${esc(x.titulo)}</div>
      ${x.resumo ? `<div class="nw-sum">${esc(x.resumo)}</div>` : ''}
      <div class="nw-meta">${x.provedor && x.provedor.logo ? `<img src="${esc(x.provedor.logo)}" alt="" width="14" height="14">` : ''}<b>${esc(x.provedor ? x.provedor.nome : '')}</b><span>${esc(timeAgo(x.publicado_em))}</span>${teams ? `<span class="nw-teams">${teams}</span>` : ''}</div>
    </div></a>`;
}

async function viewNews(ok, params) {
  const comp = +params.get('c') || 0;
  const team = params.get('t') || '';
  const prov = params.get('p') || '';
  const pv = params.get('v') === 'pv'; // "Para você": ordenado pelo que a pessoa acompanha
  let page = 1;
  const favs = Object.values(getFavs());
  const link = (o) => '#/noticias?' + new URLSearchParams(Object.entries({ v: pv ? 'pv' : '', c: comp || '', t: team, p: prov, ...o }).filter(([, v]) => v)).toString();
  $app.innerHTML = `<div class="cols-2"><div class="stack">${skel(60)}${skel(320)}${skel(400)}</div><aside class="side">${skel(240)}</aside></div>`;

  const load = (pg) => {
    const q = { por_pagina: pv ? '100' : '20', pagina: String(pg) };
    if (comp) q.campeonato_id = String(comp);
    if (team) q.time_id = team;
    if (prov) q.provedor = prov;
    return api(`/noticias?${new URLSearchParams(q)}`, 600000);
  };
  let data, loadErr = null;
  try { data = await load(1); } catch (e) { loadErr = e; }
  if (!ok()) return;
  if (loadErr) { $app.innerHTML = errorBox(loadErr); return; }
  let list = (data && data.noticias) || [];
  if (pv) { list = rankNews(list).slice(0, 40); if (data.paginacao) data.paginacao.total_paginas = 1; }
  // versões antigas do servidor mandavam só nomes; as novas mandam {slug, nome, logo, total}
  const provs = ((data && data.provedores) || []).map((p) => (typeof p === 'string' ? { slug: provSlug(p), nome: p } : p));
  const teamName = team && (registry.teams.get(+team) || favs.find((f) => String(f.time_id) === team) || {}).nome_popular;

  const filters = `<div class="card">
    <div class="pills"><a class="pill pv ${pv ? 'active' : ''}" href="${link({ v: 'pv', c: '', t: '' })}">✦ Para você</a>${NEWS_COMPS.map(([id, label]) => `<a class="pill ${comp === id && !team && !pv ? 'active' : ''}" href="${link({ v: '', c: id || '', t: '' })}">${label}</a>`).join('')}
      ${favs.map((f) => `<a class="pill ${team === String(f.time_id) ? 'active' : ''}" href="${link({ t: f.time_id, c: '' })}">${crest(f, 14)}${esc(f.nome_popular)}</a>`).join('')}</div>
    ${provs.length ? `<div class="pills" style="border-bottom:0"><span class="small muted" style="align-self:center">Veículo:</span><a class="pill ${!prov ? 'active' : ''}" href="${link({ p: '' })}">Todos</a>${provs.map((p) => `<a class="pill ${prov === p.slug ? 'active' : ''}" href="${link({ p: p.slug })}">${p.logo ? `<img src="${esc(p.logo)}" alt="" width="14" height="14">` : ''}${esc(p.nome)}${p.total ? `<small>${p.total}</small>` : ''}</a>`).join('')}</div>` : ''}
  </div>`;
  const activeFilters = !!(comp || team || prov);
  const first = list.find((x) => x.imagem) || list[0];
  const rest = list.filter((x) => x !== first);
  $app.innerHTML = `<div class="cols-2"><div class="stack">
      <div><h1 class="h1">Notícias${pv ? ' · Para você' : ''}${teamName ? ` · ${esc(teamName)}` : comp ? ` · ${esc((NEWS_COMPS.find(([id]) => id === comp) || [])[1] || '')}` : ''}</h1>
        <div class="muted small">Dos principais portais, ligadas aos times e campeonatos. Toque para ler a matéria original.</div></div>
      ${filters}
      ${list.length ? `<div class="card">${newsItem(first, true)}</div><div class="card" id="news-list">${rest.map((x) => newsItem(x)).join('')}</div>
        ${data.paginacao && data.paginacao.total_paginas > 1 ? '<button class="btn more-btn" id="more">Carregar mais</button>' : ''}`
      : `<div class="card">${empty(`Nenhuma notícia com esses filtros agora.${activeFilters ? `<div style="margin-top:12px"><a class="btn" href="#/noticias">Limpar filtros</a>${prov ? ` <a class="btn" href="${link({ p: '' })}">Ver todos os veículos</a>` : ''}</div>` : ''}`)}</div>`}
    </div>
    <aside class="side">${favNav()}<div class="card"><div class="card-title">Sobre as notícias</div><div class="card-body small muted">Cada notícia mostra o veículo de origem e abre a matéria completa no site dele. Veículos: ${provs.length ? esc(provs.map((p) => p.nome).join(', ')) : 'ge, Gazeta Esportiva, Trivela, Folha, Estadão, Placar, Terra, Metrópoles e ESPN Brasil'}. Atualizado a cada poucos minutos.</div></div></aside>
  </div>`;
  const $more = document.getElementById('more');
  if ($more) $more.addEventListener('click', async () => {
    $more.disabled = true; $more.textContent = 'Carregando…';
    const d = await soft(load(++page));
    if (!ok() || !d) return;
    document.getElementById('news-list').insertAdjacentHTML('beforeend', d.noticias.map((x) => newsItem(x)).join(''));
    if (page >= d.paginacao.total_paginas) $more.remove(); else { $more.disabled = false; $more.textContent = 'Carregar mais'; }
  });
}
const PROVIDERS = { ge: 'ge', lance: 'Lance!', uol: 'UOL Esporte', espn: 'ESPN Brasil', fi: 'Futebol Interior', placar: 'Placar', odia: 'O Dia', gazeta: 'Gazeta Esportiva', ig: 'iG Esporte', cbf: 'CBF' };
const provName = (slug) => PROVIDERS[slug] || slug;
const provSlug = (name) => Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === name) || norm(name).replace(/[^a-z]/g, '');

/* ================= Minijogos ================= */
const GAMES = [
  ['palpites', 'Bolão', 'Palpite o placar dos jogos da semana. Placar exato vale 3 pontos; acertar o vencedor ou o empate, 1.'],
  ['craque', 'Craque do dia', 'Um artilheiro novo por dia. A cada chute você descobre se acertou a liga, o time, a posição, a idade, a nacionalidade e os gols.'],
  ['penaltis', 'Disputa de pênaltis', 'Escolha seu time e o adversário. Você cobra e defende: cinco para cada lado e, se empatar, alternadas.'],
  ['escudos', 'Quiz de escudos', 'Dez escudos, dez segundos cada. Quanto mais rápido acertar, mais pontos.'],
];
// ilustrações dos cards de minijogos (SVG próprio, nas cores da marca)
const GAME_ART = {
  palpites: '<svg viewBox="0 0 120 80"><rect x="14" y="14" width="92" height="52" rx="10" fill="rgba(255,255,255,.12)"/><text x="60" y="49" text-anchor="middle" font-size="26" font-weight="800" fill="#fff">2 × 1</text><circle cx="24" cy="24" r="5" fill="#ffd400"/></svg>',
  craque: '<svg viewBox="0 0 120 80"><circle cx="60" cy="34" r="16" fill="rgba(255,255,255,.9)"/><path d="M32 74c4-16 16-22 28-22s24 6 28 22" fill="rgba(255,255,255,.9)"/><text x="60" y="41" text-anchor="middle" font-size="20" font-weight="800" fill="#0b8a43">?</text></svg>',
  penaltis: '<svg viewBox="0 0 120 80"><path d="M18 62V16h84v46" fill="none" stroke="#fff" stroke-width="4"/><path d="M22 20h76v42H22z" fill="rgba(255,255,255,.12)"/><circle cx="84" cy="30" r="8" fill="#fff"/><path d="M84 26l3 2-1 3h-4l-1-3z" fill="#222"/><rect x="50" y="38" width="12" height="20" rx="4" fill="#ffd400"/><circle cx="56" cy="33" r="5" fill="#f1c6a0"/></svg>',
  escudos: '<svg viewBox="0 0 120 80"><path d="M60 10l26 8v20c0 16-11 27-26 32-15-5-26-16-26-32V18z" fill="rgba(255,255,255,.9)"/><path d="M60 22l14 4v12c0 9-6 15-14 18-8-3-14-9-14-18V26z" fill="#0b8a43"/></svg>',
};
const best = (k) => store.get(`placar.game.${k}`, 0);
const setBest = (k, v) => { if (v > best(k)) store.set(`placar.game.${k}`, v); };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const todayKey = () => dayKey(new Date());

async function viewGames(ok, game) {
  if (game === 'palpites') return gamePalpites(ok);
  if (game === 'craque') return gameCraque(ok);
  if (game === 'penaltis') return gamePenalties(ok);
  if (game === 'escudos') return gameCrests(ok);
  const pal = palpiteStats();
  const cd = store.get('placar.craque.dia', {});
  const pen = store.get('placar.pen', { v: 0, d: 0 });
  const status = {
    palpites: pal.total ? `${pal.pontos} pontos · ${pal.total} palpites` : 'Nenhum palpite ainda',
    craque: cd.date === todayKey() ? (cd.won ? `Resolvido hoje em ${cd.guesses.length} ${cd.guesses.length === 1 ? 'tentativa' : 'tentativas'}` : cd.done ? 'Não foi hoje — volte amanhã' : `Em andamento · ${cd.guesses.length}/8`) : 'Desafio de hoje disponível',
    penaltis: pen.v + pen.d ? `${pen.v} vitórias · ${pen.d} derrotas` : 'Nenhuma disputa ainda',
    escudos: best('escudos') ? `Recorde: ${best('escudos')} pontos` : 'Sem recorde ainda',
  };
  const total = pal.pontos + (store.get('placar.craque.stats', {}).vitorias || 0) * 5 + (pen.v || 0) * 3 + Math.round(best('escudos') / 10);
  $app.innerHTML = `<div class="stack">
    <div class="card games-hero"><div><div class="eyebrow">Minijogos</div><h1>Jogue com o futebol de verdade</h1>
      <div class="sub">Times, artilheiros e jogos reais da temporada. ${Auth && Auth.user ? 'Seu progresso fica salvo na sua conta.' : '<a href="#/entrar">Entre</a> para salvar seu progresso em qualquer aparelho.'}</div></div>
      <div class="gh-score"><b>${total}</b><span>pontos de torcedor</span></div></div>
    <div class="games-grid">${GAMES.map(([id, title, desc]) => `
      <a class="game-card g-${id}" href="#/minijogos/${id}">
        <div class="gc-art">${GAME_ART[id] || ''}</div>
        <div class="gc-body"><b>${title}</b><p>${desc}</p><span class="gc-status">${esc(status[id])}</span></div>
        <span class="btn btn-primary">Jogar</span></a>`).join('')}</div>
  </div>`;
}
const gameShell = (title, body, side = '') => `<div class="cols-2"><div class="stack">
  <div class="game-head"><a class="arrow" href="#/minijogos" aria-label="Voltar">${I.left}</a><h1 class="h1" style="margin:0">${title}</h1></div>${body}</div>
  <aside class="side">${side}</aside></div>`;

/* ---- Bolão ---- */
const getPal = () => store.get('placar.palpites', {});
function palpiteScore(p, m) {
  if (!m || m.status !== 'finalizado' || m.placar_mandante == null) return null;
  if (p.h === m.placar_mandante && p.a === m.placar_visitante) return 3;
  const r = (x, y) => Math.sign(x - y);
  return r(p.h, p.a) === r(m.placar_mandante, m.placar_visitante) ? 1 : 0;
}
function palpiteStats() {
  const all = Object.values(getPal());
  const done = all.filter((p) => p.pts != null);
  return { total: all.length, pontos: done.reduce((a, p) => a + p.pts, 0), exatos: done.filter((p) => p.pts === 3).length, acertos: done.filter((p) => p.pts > 0).length, avaliados: done.length };
}
const slimMatch = (m) => ({ h: m.time_mandante.nome_popular, a: m.time_visitante.nome_popular, he: m.time_mandante.escudo, ae: m.time_visitante.escudo, sh: m.placar_mandante, sa: m.placar_visitante, st: m.status, iso: m.data_realizacao_iso, c: m.campeonato && m.campeonato.nome_popular });
async function gamePalpites(ok, compFilter = 0) {
  $app.innerHTML = gameShell('Bolão', skel(400));
  const comps = await api('/campeonatos', 600000);
  const agenda = await loadAgenda(comps);
  const live = (await pollLive()) || [];
  if (!ok()) return;
  const byId = new Map([...agenda, ...live].map((m) => [m.partida_id, m]));
  const pal = getPal();
  Object.entries(pal).forEach(([id, p]) => { const m = byId.get(+id); if (m) { p.m = slimMatch(m); const s = palpiteScore(p, m); if (s != null) p.pts = s; } });
  store.set('placar.palpites', pal);
  const now = Date.now();
  const upcomingAll = agenda.filter((m) => m.status === 'agendado' && parseDate(m) && parseDate(m) > now && parseDate(m) - now < 8 * 864e5)
    .sort((a, b) => parseDate(a) - parseDate(b));
  const compIds = [...new Set(upcomingAll.map((m) => m.campeonato && m.campeonato.campeonato_id))];
  const upcoming = upcomingAll.filter((m) => !compFilter || (m.campeonato && m.campeonato.campeonato_id === compFilter)).slice(0, 40);
  const st = palpiteStats();
  const row = (m) => {
    const p = pal[m.partida_id] || {};
    return `<div class="pal-row ${p.h != null ? 'has' : ''}" data-id="${m.partida_id}">
      <div class="pal-when">${esc(fmtShort(parseDate(m)))}<br>${esc(fmtTime(m))}</div>
      <div class="pal-t h">${esc(m.time_mandante.nome_popular)} ${crest(m.time_mandante, 22)}</div>
      <div class="pal-in"><input type="number" min="0" max="20" inputmode="numeric" value="${p.h ?? ''}" aria-label="Gols ${esc(m.time_mandante.nome_popular)}"><span>x</span><input type="number" min="0" max="20" inputmode="numeric" value="${p.a ?? ''}" aria-label="Gols ${esc(m.time_visitante.nome_popular)}"></div>
      <div class="pal-t">${crest(m.time_visitante, 22)} ${esc(m.time_visitante.nome_popular)}</div>
    </div>`;
  };
  const history = Object.entries(pal).filter(([, p]) => p.m).sort((a, b) => (b[1].m.iso || '').localeCompare(a[1].m.iso || '')).slice(0, 25);
  const groups = new Map();
  upcoming.forEach((m) => { const k = fmtDay(parseDate(m)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
  $app.innerHTML = gameShell('Bolão', `
    <div class="card"><div class="kv"><div><b>${st.pontos}</b><span>Pontos</span></div><div><b>${st.total}</b><span>Palpites</span></div><div><b>${st.exatos}</b><span>Placares exatos</span></div><div><b>${st.avaliados ? Math.round((st.acertos / st.avaliados) * 100) : 0}%</b><span>Aproveitamento</span></div></div></div>
    <div class="card">
      <div class="pills"><a class="pill ${!compFilter ? 'active' : ''}" data-c="0">Todos</a>${compIds.map((cid) => { const c = comps.find((x) => x.campeonato_id === cid); return c ? `<a class="pill ${compFilter === cid ? 'active' : ''}" data-c="${cid}">${compLogo(c, 14)}${esc(c.nome_popular)}</a>` : ''; }).join('')}</div>
      ${upcoming.length ? [...groups].map(([day, ms]) => `<div class="date-sep">${esc(day)}</div>${ms.map(row).join('')}`).join('') : empty('Nenhum jogo nos próximos dias para palpitar.')}
    </div>`,
    `<div class="card"><div class="card-title">Seus palpites</div>${history.length ? history.map(([id, p]) => `
      <a class="list-row" href="#/partida/${id}"><div style="min-width:0;flex:1"><div class="small muted">${esc(p.m.c || '')}</div><div class="small" style="font-weight:500">${esc(p.m.h)} <b>${p.h} x ${p.a}</b> ${esc(p.m.a)}</div>
      <div class="small muted">${p.m.st === 'finalizado' ? `Resultado: ${p.m.sh} x ${p.m.sa}` : 'Aguardando o jogo'}</div></div>
      <span class="ppts ${p.pts === 3 ? 'p3' : p.pts === 1 ? 'p1' : p.pts === 0 ? 'p0' : ''}">${p.pts == null ? '–' : `+${p.pts}`}</span></a>`).join('') : empty('Seus palpites aparecem aqui.')}</div>`);
  $app.querySelectorAll('[data-c]').forEach((a) => a.addEventListener('click', () => gamePalpites(ok, +a.dataset.c)));
  $app.querySelectorAll('.pal-row input').forEach((inp) => inp.addEventListener('change', () => {
    const rowEl = inp.closest('.pal-row'); const id = rowEl.dataset.id;
    const [h, a] = [...rowEl.querySelectorAll('input')].map((i) => (i.value === '' ? null : Math.max(0, Math.min(20, +i.value))));
    const all = getPal();
    if (h == null || a == null) delete all[id]; else all[id] = { h, a, m: slimMatch(byId.get(+id)) };
    store.set('placar.palpites', all);
    rowEl.classList.toggle('has', h != null && a != null);
    rowEl.classList.add('saved'); setTimeout(() => rowEl.classList.remove('saved'), 900);
  }));
}

/* ---- Craque do dia ---- */
function seededIndex(seed, n) {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return Math.abs(h) % n;
}
async function gameCraque(ok, mode = 'dia') {
  $app.innerHTML = gameShell('Craque do dia', skel(360));
  const pool = await soft(api('/minijogos/craques', 600000)) || [];
  if (!ok()) return;
  if (pool.length < 10) { $app.innerHTML = gameShell('Craque do dia', `<div class="card">${empty('Carregando os artilheiros da temporada. Tente de novo em instantes.')}</div>`); return; }
  const sorted = [...pool].sort((a, b) => a.nome.localeCompare(b.nome));
  let state;
  if (mode === 'dia') {
    const saved = store.get('placar.craque.dia', {});
    if (saved.date === todayKey() && sorted.some((p) => p.id === saved.id)) state = saved;
    else state = { date: todayKey(), id: sorted[seededIndex(todayKey(), sorted.length)].id, guesses: [], done: false, won: false };
  } else state = { id: pick(sorted).id, guesses: [], done: false, won: false };
  const target = sorted.find((p) => p.id === state.id);
  const MAX = 8;
  const save = () => { if (mode === 'dia') store.set('placar.craque.dia', state); };
  const stats = store.get('placar.craque.stats', { jogos: 0, vitorias: 0, seq: 0, melhor: 0 });

  const cell = (label, ok2, hint = '') => `<div class="cq-cell ${ok2 === true ? 'ok' : ok2 === 'near' ? 'near' : 'no'}"><span>${label}</span>${hint ? `<i>${hint}</i>` : ''}</div>`;
  const cmp = (g) => {
    const num = (a, b, near) => (a == null || b == null ? [false, ''] : a === b ? [true, ''] : [Math.abs(a - b) <= near ? 'near' : false, b > a ? '↑' : '↓']);
    const [ai, ah] = num(g.idade, target.idade, 2);
    const [gi, gh] = num(g.gols, target.gols, 3);
    return `<div class="cq-row">
      <div class="cq-name">${crest(g.time, 22)}<span>${esc(g.nome)}</span></div>
      ${cell(esc(g.liga), g.liga === target.liga)}
      ${cell(`${crest(g.time, 18)}<b class="sr">${esc(g.time.nome_popular)}</b>`, g.time.nome_popular === target.time.nome_popular)}
      ${cell(esc(g.posicao || '?'), g.posicao === target.posicao)}
      ${cell(g.idade ?? '?', ai, ah)}
      ${cell(esc(g.nacionalidade || '?'), g.nacionalidade === target.nacionalidade)}
      ${cell(g.gols ?? '?', gi, gh)}
    </div>`;
  };
  const render = () => {
    const guesses = state.guesses.map((id) => sorted.find((p) => p.id === id)).filter(Boolean);
    const result = state.done ? `<div class="card cq-result ${state.won ? 'won' : ''}">
        <div class="small muted">${state.won ? `Você acertou em ${guesses.length} ${guesses.length === 1 ? 'tentativa' : 'tentativas'}` : 'Não foi dessa vez. O craque era'}</div>
        <a class="cq-answer" href="#/jogador/${target.id}">${crest(target.time, 40)}<div><b>${esc(target.nome)}</b><span>${esc(target.time.nome_popular)} · ${esc(target.liga)} · ${target.gols} gols</span></div></a>
        <div class="cq-actions">${mode === 'dia' ? '<span class="small muted">Novo craque amanhã.</span>' : ''}<button class="btn primary-btn" id="cq-free">Jogar no modo livre</button></div>
      </div>` : '';
    $app.innerHTML = gameShell('Craque do dia', `
      ${result}
      ${state.done ? '' : `<div class="card card-body"><div class="cq-search"><input id="cq-in" placeholder="Digite o nome de um artilheiro…" autocomplete="off"><div class="suggest" id="cq-sug" hidden></div></div>
        <div class="small muted" style="margin-top:8px">${mode === 'dia' ? 'Desafio do dia' : 'Modo livre'} · tentativa ${guesses.length + 1} de ${MAX}</div></div>`}
      <div class="card"><div class="cq-head"><div>Jogador</div><div>Liga</div><div>Time</div><div>Posição</div><div>Idade</div><div>País</div><div>Gols</div></div>
        ${guesses.length ? [...guesses].reverse().map(cmp).join('') : `<div class="empty small">Verde: igual ao craque. Amarelo: perto (idade a até 2 anos, gols a até 3). As setas indicam se o número do craque é maior ou menor.</div>`}</div>`,
      `<div class="card"><div class="kv"><div><b>${stats.jogos}</b><span>Jogos</span></div><div><b>${stats.jogos ? Math.round((stats.vitorias / stats.jogos) * 100) : 0}%</b><span>Acertos</span></div><div><b>${stats.seq}</b><span>Sequência</span></div><div><b>${stats.melhor}</b><span>Melhor</span></div></div></div>
       <div class="card"><div class="card-body small muted">Artilheiros de ${[...new Set(pool.map((p) => p.liga))].map(esc).join(', ')}.</div></div>`);
    const free = document.getElementById('cq-free');
    if (free) free.addEventListener('click', () => gameCraque(ok, 'livre'));
    const $in = document.getElementById('cq-in'), $sug = document.getElementById('cq-sug');
    if (!$in) return;
    $in.focus();
    $in.addEventListener('input', () => {
      const q = norm($in.value);
      if (q.length < 2) { $sug.hidden = true; return; }
      const hits = sorted.filter((p) => norm(p.nome).includes(q) && !state.guesses.includes(p.id)).slice(0, 8);
      $sug.innerHTML = hits.map((p) => `<a data-id="${p.id}">${crest(p.time, 20)}<span>${esc(p.nome)}</span><span class="kind">${esc(p.time.nome_popular)}</span></a>`).join('') || '<div class="none">Nenhum artilheiro com esse nome</div>';
      $sug.hidden = false;
      $sug.querySelectorAll('[data-id]').forEach((a) => a.addEventListener('click', () => guess(+a.dataset.id)));
    });
    $in.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $sug.querySelector('[data-id]'); if (a) guess(+a.dataset.id); } });
  };
  const guess = (id) => {
    if (state.done || state.guesses.includes(id)) return;
    state.guesses.push(id);
    if (id === target.id || state.guesses.length >= MAX) {
      state.done = true; state.won = id === target.id;
      stats.jogos++; if (state.won) { stats.vitorias++; stats.seq++; stats.melhor = Math.max(stats.melhor, stats.seq); } else stats.seq = 0;
      store.set('placar.craque.stats', stats);
    }
    save(); render();
  };
  render();
}

/* ---- Disputa de pênaltis: public/penalty.js ---- */

/* ---- Quiz de escudos ---- */
async function gameCrests(ok, compId = null) {
  $app.innerHTML = gameShell('Quiz de escudos', skel(360));
  const comps = await api('/campeonatos', 600000);
  const leagues = comps.filter((c) => c.tipo === 'Pontos Corridos');
  const chosen = leagues.find((c) => c.campeonato_id === compId);
  const lists = await Promise.all((chosen ? [chosen] : leagues).map((c) => soft(api(`/campeonatos/${c.campeonato_id}/tabela`, 600000)).then((t) => flattenTable(t || []).flatMap((g) => g.rows.map((r) => r.time)))));
  if (!ok()) return;
  const seen = new Set();
  const teams = lists.flat().filter((t) => t.escudo && !seen.has(norm(t.nome_popular)) && seen.add(norm(t.nome_popular)));
  const key = `escudos${chosen ? '-' + chosen.campeonato_id : ''}`;
  const chooser = `<div class="pills" style="border:0;padding:0"><a class="pill ${!chosen ? 'active' : ''}" data-l="">Todas as ligas</a>${leagues.map((c) => `<a class="pill ${chosen && chosen.campeonato_id === c.campeonato_id ? 'active' : ''}" data-l="${c.campeonato_id}">${compLogo(c, 14)}${esc(c.nome_popular)}</a>`).join('')}</div>`;
  const bindChooser = () => $app.querySelectorAll('[data-l]').forEach((a) => a.addEventListener('click', () => gameCrests(ok, a.dataset.l ? +a.dataset.l : null)));
  if (teams.length < 6) { $app.innerHTML = gameShell('Quiz de escudos', `<div class="card card-body">${chooser}</div><div class="card">${empty('Sem times suficientes nesta liga agora.')}</div>`); bindChooser(); return; }
  const ROUNDS = 10, SECS = 10;
  let n = 0, score = 0, timer = null;
  const end = () => {
    setBest('escudos', score); setBest(key, score);
    $app.innerHTML = gameShell('Quiz de escudos', `<div class="card card-body">${chooser}</div>
      <div class="card card-body" style="text-align:center"><div class="small muted">Pontuação final</div><div class="qz-final">${score}</div>
      <div class="muted small" style="margin-bottom:14px">Recorde${chosen ? ` em ${esc(chosen.nome_popular)}` : ''}: ${best(key)} pontos</div><button class="btn primary-btn" id="qz-again">Jogar de novo</button></div>`);
    bindChooser();
    document.getElementById('qz-again').addEventListener('click', () => gameCrests(ok, compId));
  };
  const round = () => {
    if (!ok()) return;
    if (n >= ROUNDS) return end();
    n++;
    const target = pick(teams);
    const options = shuffle([target, ...shuffle(teams.filter((t) => t !== target)).slice(0, 3)]);
    const t0 = Date.now();
    let answered = false;
    $app.innerHTML = gameShell('Quiz de escudos', `<div class="card card-body">${chooser}</div>
      <div class="card"><div class="card-title">Escudo ${n} de ${ROUNDS}<span class="more">${score} pontos</span></div>
        <div class="qz-timer"><i id="qz-bar"></i></div>
        <div class="crest-box"><img id="qz-img" src="${esc((dark() && target.escudo_escuro) || target.escudo)}" alt="Escudo"></div>
        <div class="opts">${options.map((o, i) => `<button class="btn opt" data-i="${i}">${esc(o.nome_popular)}</button>`).join('')}</div></div>`,
      `<div class="card"><div class="card-body small muted">O escudo começa desfocado e vai ficando nítido. Acertar vale 100 pontos mais 10 por segundo que sobrar.</div></div>`);
    bindChooser();
    const $img = document.getElementById('qz-img'), $bar = document.getElementById('qz-bar');
    const finish = (i) => {
      if (answered) return;
      answered = true; clearInterval(timer);
      const left = Math.max(0, SECS - (Date.now() - t0) / 1000);
      const right = i != null && options[i] === target;
      if (right) score += 100 + Math.round(left) * 10;
      $img.style.filter = 'none';
      $app.querySelectorAll('.opt').forEach((b, k) => { b.disabled = true; if (options[k] === target) b.classList.add('right'); else if (k === i) b.classList.add('wrong'); });
      setTimeout(round, 1100);
    };
    timer = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      if (!document.getElementById('qz-img')) { clearInterval(timer); return; }
      $bar.style.width = `${Math.max(0, 100 - (el / SECS) * 100)}%`;
      $img.style.filter = `blur(${Math.max(0, 16 * (1 - el / SECS))}px) grayscale(${Math.max(0, 1 - el / SECS)})`;
      if (el >= SECS) finish(null);
    }, 100);
    view.cleanup = () => clearInterval(timer);
    $app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => finish(+b.dataset.i)));
  };
  round();
}

/* ================= Jogador: perfil Transfermarkt ================= */
function mvChart(hist) {
  const pts = (hist || []).filter((p) => p.valor != null && p.timestamp);
  if (pts.length < 2) return '';
  const W = 640, Hh = 200, P = { l: 52, r: 16, t: 16, b: 28 };
  const x0 = pts[0].timestamp, x1 = pts[pts.length - 1].timestamp, ymax = Math.max(...pts.map((p) => p.valor)) * 1.1 || 1;
  const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v) => Hh - P.b - (v / ymax) * (Hh - P.t - P.b);
  const fmt = (v) => (v >= 1e6 ? `€${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} mi` : `€${Math.round(v / 1e3)} mil`);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.timestamp).toFixed(1)},${Y(p.valor).toFixed(1)}`).join(' ');
  const area = `${path} L${X(x1).toFixed(1)},${Hh - P.b} L${X(x0).toFixed(1)},${Hh - P.b} Z`;
  const years = []; for (let y = new Date(x0).getFullYear() + 1; y <= new Date(x1).getFullYear(); y += Math.max(1, Math.ceil((new Date(x1).getFullYear() - new Date(x0).getFullYear()) / 6))) years.push(y);
  return `<svg class="mv-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Evolução do valor de mercado">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(ymax / 1.1 * f)}" y2="${Y(ymax / 1.1 * f)}" class="g"/><text x="${P.l - 6}" y="${Y(ymax / 1.1 * f) + 4}" text-anchor="end">${fmt(ymax / 1.1 * f)}</text>`).join('')}
    ${years.map((y) => { const t = new Date(`${y}-01-01`).getTime(); return `<text x="${X(t)}" y="${Hh - 8}" text-anchor="middle">${y}</text>`; }).join('')}
    <path d="${area}" class="a"/><path d="${path}" class="l"/>
    ${pts.map((p) => `<circle cx="${X(p.timestamp).toFixed(1)}" cy="${Y(p.valor).toFixed(1)}" r="3.5"><title>${esc(p.data)} · ${esc(p.valor_fmt)} · ${esc(p.clube || '')}</title></circle>`).join('')}
  </svg>`;
}

async function loadPlayerTM(pl, team, ok) {
  const $tm = document.getElementById('tm');
  if (!$tm) return;
  $tm.innerHTML = `${skel(160)}${skel(240)}`;
  const q = new URLSearchParams({ nome: pl.nome_popular, clube: (team && team.nome_popular) || '', idade: pl.idade || '' });
  let d, err = null;
  try { d = await api(`/jogador-tm?${q}`, 3600000); } catch (e) { d = null; err = e; }
  if (!ok()) return;
  if (!d) {
    const notFound = err && /não encontrado/i.test(err.message);
    $tm.innerHTML = `<div class="card">${empty(notFound ? 'Perfil detalhado não encontrado no Transfermarkt.' : `Não foi possível carregar o perfil completo agora.<div style="margin-top:12px"><button class="btn" id="tm-retry">Tentar de novo</button></div>`)}</div>`;
    const b = document.getElementById('tm-retry');
    if (b) b.addEventListener('click', () => loadPlayerTM(pl, team, ok));
    return;
  }
  const av = document.querySelector('.avatar');
  if (av && d.foto && !av.querySelector('img')) av.innerHTML = `<img src="${esc(d.foto)}" alt="">`;
  const facts = [
    ['Nome completo', d.nome_completo], ['Nascimento', d.nascimento ? `${d.nascimento}${d.idade ? ` (${d.idade} anos)` : ''}` : null], ['Naturalidade', d.naturalidade],
    ['Nacionalidade', (d.nacionalidades || []).map((n) => `<img class="flag" src="${esc(n.bandeira)}" alt=""> ${esc(n.nome)}`).join('<br>') || null],
    ['Altura', d.altura], ['Pé preferido', d.pe], ['Posição', d.posicao], ['Clube', d.clube && d.clube.nome ? `${d.clube.escudo ? `<img class="crest" src="${esc(d.clube.escudo)}" width="16" height="16" alt="">` : ''} ${esc(d.clube.nome)}` : null],
    ['No clube desde', d.no_clube_desde], ['Contrato até', d.contrato_ate], ['Empresário', d.empresario],
  ].filter(([, v]) => v);
  const raw = new Set(['Nacionalidade', 'Clube']);
  const mv = d.mercado;
  const tr = d.transferencias;
  $tm.innerHTML = `
    ${mv && mv.atual ? `<div class="card"><div class="card-title">Valor de mercado<span class="more">atualizado em ${esc(mv.atualizado_em || '')}</span></div>
      <div class="mv-head"><div><div class="mv-now">${esc(mv.atual)}</div><div class="small muted">Valor atual</div></div>
      ${mv.maior ? `<div><div class="mv-max">${esc(mv.maior)}</div><div class="small muted">Maior valor${mv.maior_em ? ` · ${esc(mv.maior_em)}` : ''}</div></div>` : ''}</div>
      ${mvChart(mv.historico)}</div>` : ''}
    <div class="card"><div class="card-title">Dados pessoais</div><div class="facts-grid">${facts.map(([k, v]) => `<div><span>${k}</span><b>${raw.has(k) ? v : esc(v)}</b></div>`).join('')}</div></div>
    ${tr && tr.lista && tr.lista.length ? `<div class="card"><div class="card-title">Transferências${tr.total_taxas ? `<span class="more">Total em taxas: ${esc(tr.total_taxas)}</span>` : ''}</div>
      ${tr.lista.map((t, i) => `<div class="tr-row ${i >= 8 ? 'tr-more' : ''}" ${i >= 8 ? 'hidden' : ''}><div class="tr-date"><b>${esc(t.temporada || '')}</b><span>${esc(t.data || '')}</span></div>
        <div class="tr-clubs"><span>${t.de.escudo ? `<img src="${esc(t.de.escudo)}" alt="" width="20" height="20">` : ''}${esc(t.de.clube || '')}</span>${I.right}<span>${t.para.escudo ? `<img src="${esc(t.para.escudo)}" alt="" width="20" height="20">` : ''}${esc(t.para.clube || '')}</span></div>
        <div class="tr-fee">${esc(t.taxa || '–')}${t.valor_mercado ? `<span>VM ${esc(t.valor_mercado)}</span>` : ''}</div></div>`).join('')}${tr.lista.length > 8 ? `<button class="btn tr-toggle" onclick="this.parentElement.querySelectorAll('.tr-more').forEach((r) => { r.hidden = false; }); this.remove()">Ver todas as ${tr.lista.length} transferências</button>` : ''}</div>` : ''}
    ${playerTitlesCard(d)}
    <div class="small faint">Perfil, valor de mercado e transferências: <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Transfermarkt</a>.</div>`;
  sources.add('transfermarkt'); renderFooter();
}
