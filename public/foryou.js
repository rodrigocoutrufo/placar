/* Placar — "Para você": aprende do que a pessoa acompanha (times, campeonatos e esportes que abre, times que segue,
 * notícias que lê) e usa isso para ordenar jogos e notícias. Tudo fica no aparelho e, com conta, sincroniza.
 * Os pontos perdem metade do peso a cada 3 semanas: o gosto acompanha a fase da pessoa. */
'use strict';

const Taste = (() => {
  const KEY = 'placar.gostos', HALF = 21 * 864e5, MAX = 120;
  let cur = null, timer = null;
  const get = () => cur || (cur = store.get(KEY, null) || { t: {}, c: {}, e: {} });
  const dec = (x) => (x ? x.s * Math.pow(0.5, (Date.now() - x.at) / HALF) : 0);
  const save = () => { clearTimeout(timer); timer = setTimeout(() => store.set(KEY, cur), 1000); };
  return {
    bump(kind, id, w = 1, meta = null) {
      if (id == null || id === '') return;
      const d = get();
      const bag = d[kind] || (d[kind] = {});
      const x = bag[id];
      bag[id] = { s: Math.min(200, dec(x) + w), at: Date.now(), ...(meta ? { m: meta } : x && x.m ? { m: x.m } : {}) };
      const keys = Object.keys(bag);
      if (keys.length > MAX) keys.sort((a, b) => dec(bag[a]) - dec(bag[b])).slice(0, keys.length - MAX).forEach((k) => delete bag[k]);
      save();
    },
    score(kind, id) { return dec((get()[kind] || {})[id]); },
    team(id) { return this.score('t', id) + (isFav(id) ? 25 : 0); },
    top(kind, n = 8) {
      const bag = get()[kind] || {};
      return Object.entries(bag).map(([id, x]) => ({ id, s: dec(x), m: x.m || {} })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s).slice(0, n);
    },
    empty() { return !this.top('t', 1).length && !this.top('c', 1).length && !Object.keys(getFavs()).length; },
    reset() { cur = { t: {}, c: {}, e: {} }; store.set(KEY, cur); },
    reload() { cur = null; },
  };
})();
const teamMeta = (t) => (t ? { n: t.nome_popular, e: t.escudo || t.escudo_escuro || null } : null);
function tasteMatch(p, w = 1) {
  if (!p) return;
  Taste.bump('t', p.time_mandante && p.time_mandante.time_id, w, teamMeta(p.time_mandante));
  Taste.bump('t', p.time_visitante && p.time_visitante.time_id, w, teamMeta(p.time_visitante));
  if (p.campeonato) Taste.bump('c', p.campeonato.campeonato_id, w, { n: p.campeonato.nome_popular || p.campeonato.nome });
}
// notícia lida conta um pouco para os times citados
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-tt]');
  if (a) a.dataset.tt.split(',').filter(Boolean).forEach((id) => Taste.bump('t', +id, 0.5));
}, true);

// Nota de um jogo para esta pessoa (0 = nada a ver)
function matchAffinity(p) {
  const th = Taste.team(p.time_mandante.time_id), ta = Taste.team(p.time_visitante.time_id);
  const tc = Taste.score('c', p.campeonato && p.campeonato.campeonato_id);
  const best = th >= ta ? p.time_mandante : p.time_visitante;
  let why = '';
  if (isFav(best.time_id)) why = `Você segue o ${best.nome_popular}`;
  else if (Math.max(th, ta) >= 0.9) why = `Você acompanha o ${best.nome_popular}`;
  else if (tc >= 1.8) why = `Você acompanha ${(p.campeonato && (p.campeonato.nome_popular || p.campeonato.nome)) || 'este campeonato'}`;
  return { s: Math.max(th, ta) * 2 + Math.min(th, ta) * 0.5 + tc * 0.8, why };
}

function forYouCard(list) {
  const now = Date.now();
  const rows = list.filter((p) => {
    const d = parseDate(p);
    return isLive(p) || (p.status !== 'finalizado' && d && d - now > -3 * 36e5 && d - now < 4 * 864e5) || (p.status === 'finalizado' && d && now - d < 20 * 36e5);
  }).map((p) => ({ p, ...matchAffinity(p) })).filter((x) => x.s >= 2 && x.why)
    .sort((a, b) => (isLive(b.p) - isLive(a.p)) || (b.p.status !== 'finalizado') - (a.p.status !== 'finalizado') || b.s - a.s || (parseDate(a.p) || 0) - (parseDate(b.p) || 0))
    .slice(0, 6);
  if (!rows.length) {
    if (!Taste.empty()) return '';
    return `<div class="card fy fy-empty"><div class="fy-ico">✦</div><div><b>Monte o seu Placar</b><div class="small muted">Siga seus times (estrela na página do time) e abra os jogos que te interessam: o Placar aprende e passa a mostrar primeiro o que importa para você.</div></div></div>`;
  }
  return `<div class="card fy"><div class="card-title"><span class="fy-spark">✦</span> Para você<span class="more">pelo que você acompanha</span></div>
    ${rows.map(({ p, why }) => `<div class="fy-row">${matchRow(p, { showDate: true, comp: p.campeonato })}<div class="fy-why">${esc(why)}</div></div>`).join('')}</div>`;
}

/* ============ Página "Para você" ============ */
async function viewForYou(ok) {
  $app.innerHTML = `<div class="cols-2"><div class="stack">${skel(150)}${skel(260)}${skel(320)}</div><div class="side">${skel(300)}</div></div>`;
  const comps = await api('/campeonatos', 600000);
  const [live, agenda, newsData, nba, f1] = await Promise.all([
    pollLive().then((l) => l || []), loadAgenda(comps), soft(api('/noticias?por_pagina=40', 600000)),
    soft(api('/esportes/nba/jogos', 60000)), soft(api('/esportes/f1', 300000))]);
  if (!ok()) return;
  const now = Date.now();
  const liveIds = new Map(live.map((p) => [p.partida_id, p]));
  const all = [...live, ...agenda.filter((p) => !liveIds.has(p.partida_id))];
  const mine = all.filter((p) => {
    const d = parseDate(p);
    return isLive(p) || (p.status !== 'finalizado' && d && d - now > -3 * 36e5 && d - now < 6 * 864e5) || (p.status === 'finalizado' && d && now - d < 30 * 36e5);
  }).map((p) => ({ p, ...matchAffinity(p) })).filter((x) => x.s >= 1 && x.why)
    .sort((a, b) => (isLive(b.p) - isLive(a.p)) || (b.p.status !== 'finalizado') - (a.p.status !== 'finalizado') || b.s - a.s || (parseDate(a.p) || 0) - (parseDate(b.p) || 0))
    .slice(0, 12);

  // NBA: times que a pessoa acompanha; F1: próxima etapa se ela acompanha o esporte ou um piloto
  const nbaFollow = new Set(Taste.top('n', 10).map((x) => +x.id));
  const nbaGames = ((nba && nba.jogos) || []).filter((g) => nbaFollow.has(+g.casa.id) || nbaFollow.has(+g.fora.id));
  const likesF1 = Taste.score('e', 'f1') >= 2 || Taste.top('p', 1).length;
  const nx = f1 && f1.proxima;
  const news = rankNews((newsData && newsData.noticias) || []).slice(0, 8);
  const favs = Object.values(getFavs());
  const learning = !mine.length && !nbaGames.length && Taste.empty();

  const h = new Date().getHours();
  const hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nLive = mine.filter((x) => isLive(x.p)).length;
  $app.innerHTML = `<div class="cols-2"><div class="stack">
    <div class="card fy-hero"><div class="fy-hero-in"><div class="eyebrow">✦ Para você</div><h1>${hello}!</h1>
      <div class="sub">${learning ? 'Seu Placar ainda está aprendendo o que você gosta.' : nLive ? `${nLive} jogo${nLive > 1 ? 's' : ''} seu${nLive > 1 ? 's' : ''} rolando agora.` : mine.length ? `${mine.length} jogo${mine.length === 1 ? '' : 's'} do seu interesse nos próximos dias.` : 'Nenhum jogo dos seus times nos próximos dias. Veja abaixo o que rola no seu radar.'}</div></div>
      <div class="fy-orb" aria-hidden="true"></div></div>
    <div id="ai-day">${aiDayHtml}</div>
    ${learning ? forYouCard([]) : ''}
    ${mine.length ? `<section class="hero-strip"><div class="hs-head"><h2>Seus jogos</h2><span>ao vivo, próximos e resultados recentes</span></div>
      <div class="fy-grid">${mine.map(({ p, why }) => heroCard(p, comps, why)).join('')}</div></section>` : ''}
    ${nbaGames.length ? `<section class="hero-strip"><div class="hs-head"><h2>Na NBA</h2><span>times que você acompanha</span></div><div class="nba-grid fy-nba">${nbaGames.map(nbaRow).join('')}</div></section>` : ''}
    ${likesF1 && nx ? `<a class="card fy-f1" href="#/f1"><div class="eyebrow">Fórmula 1 · etapa ${nx.rodada}</div><b>${esc(nx.nome)}</b><span class="small muted">${esc(nx.circuito || '')}</span></a>` : ''}
    ${news.length ? `<div class="card"><div class="card-title">Notícias para você<a class="more" href="#/noticias">Todas</a></div>${news.map((x) => `
      <a class="news" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" data-tt="${esc((x.times || []).map((t) => t.time_id).join(','))}">
        ${x.imagem ? `<img src="${esc(x.imagem)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <div><div class="tt">${esc(x.titulo)}</div><div class="src">${esc(x.provedor ? x.provedor.nome : '')} · ${esc(timeAgo(x.publicado_em))}</div></div></a>`).join('')}</div>` : ''}
  </div><aside class="side">
    <div class="card"><div class="card-title">Seus times<a class="more" href="#/favoritos">Gerenciar</a></div>${favs.length
      ? `<div class="nav-list">${favs.map((t) => `<a href="#/time/${t.time_id}">${crest(t, 22)}<span>${esc(t.nome_popular)}</span></a>`).join('')}</div>`
      : '<div class="card-body small muted">Toque na estrela na página de um time para segui-lo.</div>'}</div>
    ${interestsCard()}
  </aside></div>`;
  loadAiDay(ok);
  const reset = document.getElementById('taste-reset');
  if (reset) reset.addEventListener('click', () => { Taste.reset(); viewForYou(ok); });
  const ids = new Set(mine.map((x) => x.p.partida_id));
  const sig = (l) => l.filter((p) => ids.has(p.partida_id)).map((p) => `${p.partida_id}:${p.placar_mandante}-${p.placar_visitante}:${p.status}`).join('|');
  const was = sig(live);
  view.onLive = (l) => { if (ok() && sig(l) !== was) viewForYou(ok); };
}

// Ordem dos campeonatos na lista de jogos: os que a pessoa acompanha sobem
function compRank(id, base) { return base - Math.min(40, Taste.score('c', id) * 3); }

// Notícias "Para você": interesse nos times citados + quão recente é
function rankNews(list) {
  const now = Date.now();
  return list.map((n) => {
    const aff = (n.times || []).reduce((s, t) => s + Taste.team(t.time_id), 0);
    const d = n.publicado_em ? new Date(n.publicado_em.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
    const hours = d ? (now - d) / 36e5 : 48;
    return { n, s: Math.min(aff, 60) * 1.5 + 30 / (1 + hours / 6) };
  }).sort((a, b) => b.s - a.s).map((x) => x.n);
}

function interestsCard() {
  const teams = Taste.top('t', 10).filter((x) => x.m && x.m.n);
  const comps = Taste.top('c', 6).filter((x) => x.m && x.m.n);
  const sports = Taste.top('e', 3);
  const nba = Taste.top('n', 5).filter((x) => x.m && x.m.n);
  const drivers = Taste.top('p', 5).filter((x) => x.m && x.m.n);
  const extra = `${nba.map((x) => `<a class="chip" href="#/nba/time/${esc(x.id)}">${x.m.e ? `<img src="${esc(x.m.e)}" alt="" width="16" height="16">` : ''}${esc(x.m.n)}</a>`).join('')}${drivers.map((x) => `<a class="chip" href="#/f1/piloto/${esc(x.id)}">${x.m.e ? `<img src="${esc(x.m.e)}" alt="" width="16" height="11">` : ''}${esc(x.m.n)}</a>`).join('')}`;
  if (!teams.length && !comps.length && !extra) return `<div class="card"><div class="card-title">Seus interesses</div><div class="card-body small muted">Ainda aprendendo. Abra jogos, times e campeonatos e o Placar passa a priorizar o que você gosta.</div></div>`;
  const label = { nba: 'NBA', f1: 'Fórmula 1' };
  return `<div class="card"><div class="card-title">Seus interesses<button class="more linkish" id="taste-reset">Limpar</button></div>
    <div class="card-body"><div class="chips">${teams.map((x) => `<a class="chip" href="#/time/${esc(x.id)}">${x.m.e ? `<img src="${esc(x.m.e)}" alt="" width="16" height="16">` : ''}${esc(x.m.n)}</a>`).join('')}
      ${comps.map((x) => `<a class="chip c" href="#/campeonato/${esc(x.id)}">${esc(x.m.n)}</a>`).join('')}${extra}${sports.map((x) => `<a class="chip c" href="#/${esc(x.id)}">${esc(label[x.id] || x.id)}</a>`).join('')}</div>
    <div class="small faint" style="margin-top:10px">Usado para ordenar jogos e notícias. Fica salvo neste aparelho e na sua conta.</div></div></div>`;
}
