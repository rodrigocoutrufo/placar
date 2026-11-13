/* Placar — outros esportes: basquete (NBA) e Fórmula 1, com placar e sessão ao vivo pela transmissão (SSE).
 * Carregado antes do app.js; usa os helpers de lá (api, esc, skel, ...) só em tempo de execução. */
'use strict';

let otherLive = { nba: [], f1: null }; // atualizado pelo evento "outros" da transmissão ao vivo
const SPORTS = [['#/', 'Futebol', 'futebol'], ['#/nba', 'NBA', 'nba'], ['#/f1', 'Fórmula 1', 'f1']];
const SPORT_ICON = {
  futebol: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10l4-3Z" class="fill"/></svg>',
  nba: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/></svg>',
  f1: '<svg viewBox="0 0 24 24"><path d="M4 21V4M4 4h14l-3 4.5L18 13H4"/></svg>',
};
const sportBar = (active) => `<nav class="sportbar" aria-label="Esportes">${SPORTS.map(([href, label, k]) =>
  `<a href="${href}" class="${k === active ? 'active' : ''}">${SPORT_ICON[k]}<span>${label}</span>${k !== 'futebol' && ((k === 'nba' && (otherLive.nba || []).length) || (k === 'f1' && otherLive.f1)) ? '<span class="live-dot"></span>' : ''}</a>`).join('')}</nav>`;

let tvGuideP = null;
const tvGuide = () => tvGuideP || (tvGuideP = api('/transmissoes', 3600000).catch(() => { tvGuideP = null; return {}; }));
const tvFor = async (k) => { const g = await tvGuide(); const c = ((g && g.campeonatos) || {})[k]; return c ? { ...c, atualizado_em: g.atualizado_em } : null; };

const fmtDT = (iso, o = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => {
  const d = iso ? new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
  return d ? d.toLocaleString('pt-BR', o).replace('.', '') : '';
};
const isoDate = (iso) => (iso ? new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null);
const logo = (src, size = 28, alt = '') => (src ? `<img class="crest" src="${esc(src)}" width="${size}" height="${size}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span style="width:${size}px;height:${size}px;display:inline-block"></span>`);

/* ================= NBA ================= */
function nbaRow(g) {
  const live = g.status === 'andamento', done = g.status === 'finalizado';
  const st = live ? `<span class="live">${esc(g.periodo || 'Ao vivo')}</span>` : done ? 'Final' : esc(g.hora || fmtDT(g.data_iso, { hour: '2-digit', minute: '2-digit' }));
  const team = (t, other) => `<div class="nba-t ${done && t.placar > other.placar ? 'win' : done ? 'lose' : ''}">${logo(t.logo, 24)}<span class="nm">${esc(t.curto || t.nome)}</span><span class="rec">${esc(t.recorde || '')}</span><b>${t.placar ?? ''}</b></div>`;
  const lead = (g.lideres || []).filter((l) => l.categoria === 'PTS').map((l) => `${esc(l.nome)} ${esc(l.valor)} pts`).join(' · ');
  return `<a class="nba-g ${live ? 'is-live' : ''}" href="#/nba/jogo/${g.id}" data-g="${g.id}">
    <div class="nba-st">${st}</div><div class="nba-teams">${team(g.fora, g.casa)}${team(g.casa, g.fora)}</div>
    ${lead && !g.status.startsWith('agend') ? `<div class="nba-lead small muted">${lead}</div>` : ''}</a>`;
}

async function viewNBA(ok, params, tab = 'jogos') {
  Taste.bump('e', 'nba', 2);
  $app.innerHTML = `<div class="stack">${sportBar('nba')}${skel(90)}${skel(400)}</div>`;
  const date = params.get('data') || '';
  const head = (sub) => `<div class="card sport-head nba-head"><div class="sh-ico">${SPORT_ICON.nba}</div><div><h1>NBA</h1><div class="sub">${sub}</div></div></div>
    <nav class="tabs card-tabs"><a href="#/nba" class="${tab === 'jogos' ? 'active' : ''}">Jogos</a><a href="#/nba/classificacao" class="${tab === 'classificacao' ? 'active' : ''}">Classificação</a></nav>`;
  if (tab === 'classificacao') {
    const confs = await api('/esportes/nba/classificacao', 300000);
    if (!ok()) return;
    $app.innerHTML = `<div class="stack">${sportBar('nba')}<div class="card">${head('Temporada 2026-27 · classificação por conferência')}</div>
      <div class="cols-2 even">${confs.map((c) => `<div class="card"><div class="card-title">${esc(c.nome)}</div><div class="table-wrap"><table class="tbl">
        <thead><tr><th>#</th><th class="l">Time</th><th>V</th><th>D</th><th>%</th><th class="hide-sm">Atrás</th><th class="hide-sm">Seq.</th><th class="hide-sm">Últ. 10</th></tr></thead>
        <tbody>${c.times.map((r) => `<tr class="${r.posicao <= 6 ? 'nba-po' : r.posicao <= 10 ? 'nba-pi' : ''}"><td class="pos" style="--z:${r.posicao <= 6 ? 'var(--z-lib)' : r.posicao <= 10 ? 'var(--z-prelib)' : 'transparent'}">${r.posicao}</td>
          <td class="team l"><a class="tn" href="#/nba/time/${r.time.id}">${logo(r.time.logo, 20)}<span>${esc(r.time.curto || r.time.nome)}</span></a></td><td class="pts">${r.v}</td><td>${r.d}</td><td>${esc(r.pct || '')}</td>
          <td class="hide-sm">${esc(r.atras || '–')}</td><td class="hide-sm">${esc(r.sequencia || '')}</td><td class="hide-sm">${esc(r.ultimos10 || '')}</td></tr>`).join('')}</tbody></table></div>
        <div class="legend"><span style="--c:var(--z-lib)">Playoffs (1º a 6º)</span><span style="--c:var(--z-prelib)">Play-in (7º a 10º)</span></div></div>`).join('')}</div></div>`;
    return;
  }
  const load = (force) => (force ? fresh : api)(`/esportes/nba/jogos${date ? `?data=${date}` : ''}`, 20000);
  let d = await load();
  if (!ok()) return;
  const tv = await tvFor('nba');
  if (!ok()) return;
  const shift = (n) => { const x = new Date(`${d.data || new Date().toISOString().slice(0, 10)}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
  const render = () => {
    const day = d.data ? new Date(`${d.data}T12:00:00`) : new Date();
    const live = d.jogos.filter((g) => g.status === 'andamento');
    $app.innerHTML = `<div class="cols-2"><div class="stack">${sportBar('nba')}<div class="card">${head(`${live.length ? `<span class="live-dot"></span> ${live.length} ao vivo · ` : ''}${d.jogos.length} jogos`)}</div>
      <div class="card"><div class="roundbar"><a class="arrow" href="#/nba?data=${shift(-1)}" aria-label="Dia anterior">${I.left}</a>
        <b style="flex:1;text-align:center">${esc(day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</b>
        <a class="arrow" href="#/nba?data=${shift(1)}" aria-label="Próximo dia">${I.right}</a></div>
        <div class="small faint" style="padding:8px 16px 0">Data dos EUA · horários de Brasília</div>
        <div class="nba-grid">${d.jogos.map(nbaRow).join('') || empty('Nenhum jogo neste dia.')}</div>
        ${date ? '<div style="padding:0 16px 14px"><a class="btn" href="#/nba">Voltar para hoje</a></div>' : ''}</div>
    </div><aside class="side">${watchCard(tv, 'Onde assistir a NBA')}<div class="card card-body small muted">Placar, box score e chance de vitória pela ESPN, atualizados ao vivo a cada 15 segundos.</div></aside></div>`;
  };
  render();
  const refresh = async () => { try { const n = await load(true); if (ok() && n) { d = n; render(); } } catch { /* mantém */ } };
  view.onOther = (o) => { if (ok() && (o.nba || []).some((g) => d.jogos.some((x) => x.id === g.id))) refresh(); };
  if (d.jogos.some((g) => g.status === 'andamento')) {
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
    view.cleanup = () => clearInterval(t);
  }
}

function wpChart(series, home, away) {
  if (!series || series.length < 3) return '';
  const W = 600, H = 150, n = series.length - 1;
  const pts = series.map((v, i) => [(i / n) * W, H - (v / 100) * H]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = series[series.length - 1];
  const cH = home.cor || 'var(--brand)', cA = away.cor || '#888';
  return `<div class="card"><div class="card-title">Chance de vitória<span class="more">${esc(home.sigla)} ${Math.round(last)}% · ${esc(away.sigla)} ${Math.round(100 - last)}%</span></div>
    <svg class="wp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chance de vitória ao longo do jogo">
      <defs><clipPath id="wpTop"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="wpBot"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
      <path d="${line}L${W},${H / 2}L0,${H / 2}Z" fill="${cH}" opacity=".22" clip-path="url(#wpTop)"/>
      <path d="${line}L${W},${H / 2}L0,${H / 2}Z" fill="${cA}" opacity=".22" clip-path="url(#wpBot)"/>
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
      ${[1, 2, 3].map((q) => `<line x1="${(W * q) / 4}" x2="${(W * q) / 4}" y1="0" y2="${H}" class="q"/>`).join('')}
      <path d="${line}" fill="none" stroke="var(--text)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="wp-legend small muted"><span>${logo(home.logo, 16)} ${esc(home.curto)} acima</span><span>1º · 2º · 3º · 4º quarto</span><span>${esc(away.curto)} abaixo ${logo(away.logo, 16)}</span></div></div>`;
}

const NBA_COLS = ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF', '+/-'];
const NBA_COL_PT = { MIN: 'Min', PTS: 'Pts', REB: 'Reb', AST: 'Ast', FG: 'Arr.', '3PT': '3 pts', FT: 'LL', STL: 'Rb', BLK: 'Toc', TO: 'Err', PF: 'Flt', '+/-': '+/-' };
function boxTable(b, title) {
  if (!b) return '';
  const cols = NBA_COLS.filter((c) => b.colunas.includes(c));
  const row = (p) => `<tr class="${p.nao_jogou ? 'dnp' : ''}"><td class="team l"><a class="tn" href="#/nba/jogador/${p.id}">${p.foto ? `<img class="hs" src="${esc(p.foto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span><b>${esc(p.curto || p.nome)}</b><small>${esc(p.posicao || '')}${p.camisa ? ` · #${esc(p.camisa)}` : ''}</small></span></a></td>
    ${p.nao_jogou ? `<td colspan="${cols.length}" class="l muted small">Não jogou${p.nao_jogou && p.nao_jogou !== true ? ` · ${esc(String(p.nao_jogou).replace(/^DNP-?\s*/i, ''))}` : ''}</td>` : cols.map((c) => `<td class="${c === 'PTS' ? 'pts' : ''} ${['FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF'].includes(c) ? 'hide-sm' : ''}">${esc(p.stats[c] ?? '')}</td>`).join('')}</tr>`;
  const headRow = `<tr><th class="l">${esc(title)}</th>${cols.map((c) => `<th class="${['FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF'].includes(c) ? 'hide-sm' : ''}" title="${c}">${NBA_COL_PT[c] || c}</th>`).join('')}</tr>`;
  return `<div class="table-wrap"><table class="tbl box"><thead>${headRow}</thead><tbody>
    <tr class="sub-h"><td colspan="${cols.length + 1}">Titulares</td></tr>${b.titulares.map(row).join('')}
    <tr class="sub-h"><td colspan="${cols.length + 1}">Reservas</td></tr>${b.reservas.map(row).join('')}
    <tr class="tot"><td class="l"><b>Total</b></td>${cols.map((c) => `<td class="${['FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF'].includes(c) ? 'hide-sm' : ''}">${esc(b.totais[c] ?? '')}</td>`).join('')}</tr></tbody></table></div>`;
}

async function viewNBAGame(id, ok, params) {
  Taste.bump('e', 'nba', 1);
  $app.innerHTML = `<div class="stack">${skel(200)}${skel(400)}</div>`;
  let tab = params.get('aba') || 'resumo';
  let side = 'casa';
  const load = (force) => (force ? fresh : api)(`/esportes/nba/jogo/${id}`, 15000);
  let g = await load();
  const tv = await tvFor('nba');
  if (!ok()) return;
  const render = () => {
    const live = g.status === 'andamento';
    const H = g.casa, A = g.fora;
    const periods = Math.max(4, (H.parciais || []).length, (A.parciais || []).length);
    const ls = `<div class="table-wrap"><table class="tbl linescore"><thead><tr><th class="l"></th>${Array.from({ length: periods }, (_, i) => `<th>${i < 4 ? `${i + 1}º` : `P${i - 3}`}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${[A, H].map((t) => `<tr><td class="team l"><span class="tn">${logo(t.logo, 18)}<span>${esc(t.sigla)}</span></span></td>${Array.from({ length: periods }, (_, i) => `<td>${t.parciais && t.parciais[i] != null ? t.parciais[i] : '–'}</td>`).join('')}<td class="pts">${t.placar ?? '–'}</td></tr>`).join('')}</tbody></table></div>`;
    const stats = (g.estatisticas || []).map((s) => {
      const a = parseFloat(s.casa) || 0, b = parseFloat(s.fora) || 0, tot = a + b || 1;
      const lower = /Erros|Faltas/.test(s.nome);
      const wa = lower ? a < b : a > b, wb = lower ? b < a : b > a;
      return `<div class="stat"><div class="stat-top"><span>${wa ? `<b>${esc(s.casa)}</b>` : esc(s.casa)}</span><span>${esc(s.nome)}</span><span>${wb ? `<b>${esc(s.fora)}</b>` : esc(s.fora)}</span></div>
        <div class="stat-bars"><div><i class="h ${wa ? 'lead' : ''}" style="width:${(a / tot) * 100}%"></i></div><div><i class="a ${wb ? 'lead' : ''}" style="width:${(b / tot) * 100}%"></i></div></div></div>`;
    }).join('');
    const injuries = (g.lesoes || []).filter((x) => x.jogadores.length);
    let body = '';
    if (tab === 'box') {
      body = `<div class="card"><div class="seg box-seg"><button data-side="casa" class="${side === 'casa' ? 'active' : ''}">${logo(H.logo, 16)} ${esc(H.curto)}</button><button data-side="fora" class="${side === 'fora' ? 'active' : ''}">${logo(A.logo, 16)} ${esc(A.curto)}</button></div>
        ${g.box && g.box[side] ? boxTable(g.box[side], side === 'casa' ? H.curto : A.curto) : empty('O box score aparece quando o jogo começa.')}</div>`;
    } else if (tab === 'lances') {
      body = `<div class="card"><div class="card-title">Lances${live ? ' <span class="live-dot"></span>' : ''}<span class="more">mais recentes primeiro</span></div>
        ${(g.lances || []).map((p) => `<div class="play ${p.cesta ? 'score' : ''} ${p.lado || ''}"><span class="pq">${p.periodo ? `${p.periodo <= 4 ? p.periodo + 'º' : 'P' + (p.periodo - 4)} · ` : ''}${esc(p.relogio || '')}</span><span class="pt">${p.cesta && p.valor ? `<b class="pv">+${p.valor}</b>` : ''}${esc(p.texto)}</span><span class="ps">${esc(p.placar || '')}</span></div>`).join('') || empty('Os lances aparecem aqui em tempo real.')}
        <div class="small faint" style="padding:10px 16px">Texto dos lances da ESPN, traduzido automaticamente.</div></div>`;
    } else {
      body = `${g.status !== 'finalizado' ? watchCard(tv, 'Onde assistir') : ''}${wpChart(g.chance_vitoria, H, A)}
        ${stats ? `<div class="card" style="--ch:${H.cor || 'var(--brand)'};--ca:${A.cor || '#888'}"><div class="card-title">Estatísticas<span class="more">${esc(H.sigla)} · ${esc(A.sigla)}</span></div>${stats}</div>` : ''}
        ${injuries.length ? `<div class="card"><div class="card-title">Desfalques</div>${injuries.map((x) => `<div class="card-body small"><b>${esc((x.time === 'casa' ? H : A).curto)}:</b> ${x.jogadores.map((j) => `${esc(j.nome)} <span class="muted">(${esc(j.status || '')})</span>`).join(', ')}</div>`).join('')}</div>` : ''}
        ${!stats && !g.chance_vitoria ? `<div class="card">${empty('O jogo ainda não começou. Placar, estatísticas e chance de vitória aparecem aqui ao vivo.')}</div>` : ''}`;
    }
    $app.innerHTML = `<div class="stack"><div class="card">
      <div class="mh"><div class="mh-comp">${SPORT_ICON.nba.replace('<svg', '<svg width="16" height="16"')}<a href="#/nba">NBA</a>${g.titulo ? `<span>· ${esc(g.titulo)}</span>` : ''}</div>
        <div class="mh-grid">
          <a class="mh-team" href="#/nba/time/${A.id}">${logo(A.logo, 64)}<span>${esc(A.nome)}</span><small class="muted">${esc(A.recorde || '')} · visitante</small></a>
          <div class="mh-center">${g.status === 'agendado' ? `<div class="mh-score time">${esc(g.hora || '')}</div><div class="mh-status">${esc(fmtDT(g.data_iso, { weekday: 'short', day: 'numeric', month: 'short' }))}</div>`
            : `<div class="mh-score">${A.placar ?? 0} - ${H.placar ?? 0}</div><div class="mh-status ${live ? 'live' : ''}">${live ? '<span class="live-dot"></span>' : ''}${esc(g.periodo || '')}</div>`}</div>
          <a class="mh-team" href="#/nba/time/${H.id}">${logo(H.logo, 64)}<span>${esc(H.nome)}</span><small class="muted">${esc(H.recorde || '')} · casa</small></a></div>
        ${g.local ? `<div class="mh-info"><span>${esc(g.local)}</span></div>` : ''}</div>
      ${g.status !== 'agendado' ? ls : ''}
      <nav class="tabs">${[['resumo', 'Resumo'], ['box', 'Box score'], ['lances', 'Lances']].map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav></div>
      ${body}</div>`;
    $app.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', () => { tab = a.dataset.tab; history.replaceState(null, '', `#/nba/jogo/${id}?aba=${tab}`); render(); }));
    $app.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { side = b.dataset.side; render(); }));
  };
  render();
  if (g.status === 'andamento' || g.status === 'agendado') {
    const refresh = async () => { try { const n = await load(true); if (ok() && n) { g = n; const y = scrollY; render(); scrollTo(0, y); } } catch { /* mantém */ } };
    const t = setInterval(() => { if (!document.hidden && g.status !== 'finalizado') refresh(); }, g.status === 'andamento' ? 15000 : 60000);
    view.cleanup = () => clearInterval(t);
    view.onOther = (o) => { const m = (o.nba || []).find((x) => x.id === g.id); if (ok() && m && (m.casa.placar !== g.casa.placar || m.fora.placar !== g.fora.placar || m.periodo !== g.periodo)) refresh(); };
  }
}

/* ================= Fórmula 1 ================= */
const flag = (src, w = 20) => (src ? `<img class="flag" src="${esc(src)}" alt="" width="${w}" loading="lazy" onerror="this.remove()">` : '');
function countdown(iso) {
  const d = isoDate(iso);
  if (!d) return '';
  const s = Math.max(0, Math.floor((d - Date.now()) / 1000));
  const dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `<div class="cd" data-cd="${esc(iso)}">${dd ? `<div><b>${dd}</b><span>dia${dd > 1 ? 's' : ''}</span></div>` : ''}<div><b>${String(hh).padStart(2, '0')}</b><span>h</span></div><div><b>${String(mm).padStart(2, '0')}</b><span>min</span></div><div><b>${String(ss).padStart(2, '0')}</b><span>s</span></div></div>`;
}
setInterval(() => document.querySelectorAll('[data-cd]').forEach((el) => { const n = countdown(el.dataset.cd); if (n) el.outerHTML = n; }), 1000);

function liveSessionCard(s) {
  if (!s) return '';
  return `<div class="card f1-live"><div class="card-title"><span class="live-dot"></span> Ao vivo · ${esc(s.nome)}${s.volta ? `<span class="more">volta ${esc(s.volta)}</span>` : ''}</div>
    <div class="f1-order">${(s.ordem || []).map((x) => `<div class="f1-row"><span class="p">${x.pos}</span>${flag(x.bandeira, 18)}<span class="nm">${esc(x.nome)}</span></div>`).join('') || empty('Aguardando a ordem da sessão…')}</div>
    <div class="small faint" style="padding:8px 16px 12px">Posições pela ESPN, atualizadas a cada 15 segundos.</div></div>`;
}

async function viewF1(ok, params, tab = 'pilotos') {
  Taste.bump('e', 'f1', 2);
  $app.innerHTML = `<div class="stack">${sportBar('f1')}${skel(220)}${skel(400)}</div>`;
  let d = await api('/esportes/f1', 60000);
  const tv = await tvFor('f1');
  if (!ok()) return;
  const render = () => {
    const nx = d.proxima;
    const now = Date.now();
    const nextSession = nx ? nx.sessoes.find((s) => isoDate(s.data_iso) > now - 2 * 3600e3) : null;
    const live = (otherLive.f1) || (d.fim_de_semana && d.fim_de_semana.ao_vivo);
    const leaderPts = (d.pilotos[0] || {}).pontos || 1;
    const teamPts = (d.construtores[0] || {}).pontos || 1;
    const T = d.titulo;
    const title = T ? (T.decidido
      ? `<div class="card f1-champ"><div class="trophy-big">🏆</div><div><b>${esc(T.lider)} é campeão mundial de ${d.temporada}</b><div class="small muted">Vantagem de ${T.vantagem} pontos com só ${T.pontos_em_jogo} em jogo nas ${d.restantes} etapas restantes.</div></div></div>`
      : `<div class="card f1-champ"><div class="trophy-big">🏁</div><div><b>${esc(T.lider)} lidera por ${T.vantagem} pontos</b><div class="small muted">Ainda há ${T.pontos_em_jogo} pontos em jogo.${T.pode_decidir_no_proximo ? ' O título pode ser decidido no próximo GP.' : ''}</div></div></div>`) : '';
    const tabs = [['pilotos', 'Pilotos'], ['construtores', 'Construtores'], ['calendario', 'Calendário']];
    let body;
    if (tab === 'construtores') {
      body = d.construtores.map((c) => `<a class="f1-st" href="#/f1/equipe/${esc(c.equipe.id)}"><span class="p">${c.posicao}</span><i class="tc" style="background:${esc(c.equipe.cor)}"></i><span class="nm"><b>${esc(c.equipe.nome)}</b><small>${c.vitorias} vitória${c.vitorias === 1 ? '' : 's'}</small></span>
        <span class="bar"><i style="width:${(c.pontos / teamPts) * 100}%;background:${esc(c.equipe.cor)}"></i></span><b class="pt">${c.pontos}</b></a>`).join('');
    } else if (tab === 'calendario') {
      body = d.calendario.map((r) => `<a class="f1-cal ${r.status} ${nx && r.rodada === nx.rodada ? 'next' : ''}" href="#/f1/corrida/${r.rodada}">
        <span class="rd">${r.rodada}</span><span class="when">${esc(fmtDT(r.data_iso, { day: '2-digit', month: 'short' }))}</span>
        <span class="nm"><b>${esc(r.nome)}</b><small>${esc(r.circuito || '')}${r.sprint ? ' · sprint' : ''}</small></span>
        <span class="win">${r.vencedor ? `${flag(r.vencedor.bandeira, 16)}<span>${esc(r.vencedor.sobrenome)}</span><i class="tc" style="background:${esc((r.vencedor.equipe || {}).cor || '#888')}"></i>` : nx && r.rodada === nx.rodada ? '<span class="badge ok">Próximo</span>' : ''}</span></a>`).join('');
    } else {
      body = d.pilotos.map((x) => `<a class="f1-st ${x.piloto.brasileiro ? 'br' : ''}" href="#/f1/piloto/${esc(x.piloto.id)}"><span class="p">${x.posicao}</span><i class="tc" style="background:${esc((x.piloto.equipe || {}).cor || '#888')}"></i>
        ${flag(x.piloto.bandeira, 20)}<span class="nm"><b>${esc(x.piloto.nome)}</b><small>${esc((x.piloto.equipe || {}).nome || '')}${x.vitorias ? ` · ${x.vitorias} vitória${x.vitorias === 1 ? '' : 's'}` : ''}</small></span>
        <span class="bar"><i style="width:${(x.pontos / leaderPts) * 100}%;background:${esc((x.piloto.equipe || {}).cor || '#888')}"></i></span><b class="pt">${x.pontos}</b></a>`).join('');
    }
    $app.innerHTML = `<div class="cols-2"><div class="stack">${sportBar('f1')}
      ${nx ? `<div class="card f1-hero"><div class="f1-hero-top"><div><div class="eyebrow">Etapa ${nx.rodada} de ${d.etapas} · ${esc(nx.cidade || '')}</div><h1>${esc(nx.nome)}</h1><div class="sub">${esc(nx.circuito || '')}</div></div>
          ${nextSession ? `<div class="f1-next"><span class="small muted">${isoDate(nextSession.data_iso) <= now ? 'Agora' : `Próxima sessão: <b>${esc(nextSession.nome)}</b>`}</span>${isoDate(nextSession.data_iso) > now ? countdown(nextSession.data_iso) : ''}</div>` : ''}</div>
        <div class="f1-sessions">${nx.sessoes.map((s) => { const t = isoDate(s.data_iso); const past = t && t < now - 2 * 3600e3; return `<div class="${past ? 'past' : ''} ${nextSession && s === nextSession ? 'next' : ''} ${s.nome === 'Corrida' ? 'race' : ''}"><b>${esc(s.nome)}</b><span>${esc(fmtDT(s.data_iso))}</span></div>`; }).join('')}</div>
        <a class="btn" href="#/f1/corrida/${nx.rodada}" style="margin:0 16px 16px">Detalhes da etapa</a></div>` : ''}
      ${live ? liveSessionCard(live) : ''}
      ${title}
      <div class="card"><nav class="tabs">${tabs.map(([k, l]) => `<a href="#/f1${k === 'pilotos' ? '' : '/' + k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav><div class="f1-list">${body || empty('Sem dados agora.')}</div></div>
    </div><aside class="side">${watchCard(tv, 'Onde assistir a F1')}
      ${d.fim_de_semana && !live ? `<div class="card"><div class="card-title">${esc(d.fim_de_semana.nome || 'Fim de semana')}</div>${d.fim_de_semana.sessoes.filter((s) => s.ordem.length).slice(-3).reverse().map((s) => `<div class="card-body"><div class="sec-label" style="padding:0 0 6px">${esc(s.nome)}</div>${s.ordem.slice(0, 3).map((x) => `<div class="f1-row"><span class="p">${x.pos}</span>${flag(x.bandeira, 16)}<span class="nm">${esc(x.nome)}</span></div>`).join('')}</div>`).join('')}</div>` : ''}
      <div class="card card-body small muted">Calendário, resultados e classificação: Jolpica (base Ergast). Sessão ao vivo: ESPN. Horários de Brasília.</div></aside></div>`;
  };
  render();
  view.onOther = (o) => { if (ok()) render(); void o; };
}

async function viewF1Race(rnd, ok) {
  Taste.bump('e', 'f1', 1);
  $app.innerHTML = `<div class="stack">${skel(160)}${skel(400)}</div>`;
  const r = await api(`/esportes/f1/corrida/${rnd}`, 120000);
  if (!ok()) return;
  const pilot = (p) => `<a class="tn" href="#/f1/piloto/${esc(p.id)}">${flag(p.bandeira, 18)}<span class="nm"><b>${esc(p.nome)}</b><small>${esc((p.equipe || {}).nome || '')}</small></span></a>`;
  const results = r.resultado.length ? `<div class="card"><div class="card-title">Resultado da corrida</div><div class="table-wrap"><table class="tbl f1-res"><thead><tr><th>#</th><th class="l">Piloto</th><th class="hide-sm">Largou</th><th class="l">Tempo</th><th>Pts</th></tr></thead><tbody>
      ${r.resultado.map((x) => { const gain = x.largada && x.posicao ? x.largada - x.posicao : 0; return `<tr class="${x.piloto.brasileiro ? 'hl' : ''}"><td class="pos" style="--z:${esc((x.piloto.equipe || {}).cor || 'transparent')}">${x.posicao}</td><td class="team l"><span class="tn">${pilot(x.piloto)}</span></td>
        <td class="hide-sm">${x.largada || 'Box'} ${gain ? `<span class="mv ${gain > 0 ? 'up' : 'down'}">${gain > 0 ? '▲' : '▼'}${Math.abs(gain)}</span>` : ''}</td><td class="l small">${esc(x.tempo || '')}${x.volta_rapida ? ' <span class="badge" title="Volta mais rápida">⏱ ' + esc(x.melhor_volta || '') + '</span>' : ''}</td><td class="pts">${x.pontos || ''}</td></tr>`; }).join('')}</tbody></table></div></div>` : '';
  const quali = r.classificacao.length ? `<div class="card"><div class="card-title">Classificação (grid)</div><div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th class="l">Piloto</th><th>Q1</th><th class="hide-sm">Q2</th><th>Q3</th></tr></thead><tbody>
      ${r.classificacao.map((x) => `<tr class="${x.piloto.brasileiro ? 'hl' : ''}"><td>${x.posicao}</td><td class="team l"><span class="tn">${pilot(x.piloto)}</span></td><td class="small">${esc(x.q1 || '')}</td><td class="small hide-sm">${esc(x.q2 || '')}</td><td class="small">${esc(x.q3 || '')}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const sprint = (r.sprint_resultado || []).length ? `<div class="card"><div class="card-title">Corrida sprint</div>${r.sprint_resultado.slice(0, 10).map((x) => `<div class="f1-row"><span class="p">${x.posicao}</span>${pilot(x.piloto)}<span class="small muted" style="margin-left:auto">${esc(x.tempo || '')}</span><b style="width:30px;text-align:right">${x.pontos || ''}</b></div>`).join('')}</div>` : '';
  $app.innerHTML = `<div class="stack"><div class="card f1-hero"><div class="f1-hero-top"><div><div class="eyebrow"><a href="#/f1/calendario">Fórmula 1</a> · etapa ${r.rodada}</div><h1>${esc(r.nome)}</h1><div class="sub">${esc(r.circuito || '')} · ${esc(r.cidade || '')}, ${esc(r.pais || '')}</div></div></div>
      <div class="f1-sessions">${r.sessoes.map((s) => `<div class="${s.nome === 'Corrida' ? 'race' : ''}"><b>${esc(s.nome)}</b><span>${esc(fmtDT(s.data_iso))}</span></div>`).join('')}</div></div>
    ${results}${sprint}${quali}${!results && !quali ? `<div class="card">${empty('Os resultados aparecem aqui depois de cada sessão.')}</div>` : ''}</div>`;
}

/* ================= Páginas de time e jogador (NBA) e piloto e equipe (F1) ================= */
const hexA = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return `rgba(11,138,67,${a})`; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const heroStyle = (c) => `--tc:${c || 'var(--brand)'};--tc-soft:${hexA(c, 0.22)};--tc-faint:${hexA(c, 0.08)}`;
const kpis = (list) => `<div class="kpis">${list.filter(Boolean).map(([v, l, sub]) => `<div><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;

function lineChart(points, color, { label = '', height = 170, mate = null } = {}) {
  if (!points || points.length < 2) return '';
  const W = 640, H = height, P = 28;
  const all = [...points.map((p) => p.y), ...(mate || []).map((p) => p.y)];
  const max = Math.max(...all, 1);
  const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v) => H - P - (v / max) * (H - P * 2);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${path(points)}L${x(points.length - 1)},${H - P}L${x(0)},${H - P}Z`;
  const last = points[points.length - 1];
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${P}" x2="${W - P}" y1="${y(max * f)}" y2="${y(max * f)}" class="g"/><text x="${P - 6}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join('')}
    <path d="${area}" fill="${color}" opacity=".14"/>
    ${mate ? `<path d="${path(mate)}" fill="none" stroke="var(--faint)" stroke-width="2" stroke-dasharray="5 5"/>` : ''}
    <path d="${path(points)}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.2" fill="var(--surface)" stroke="${color}" stroke-width="2"><title>${esc(p.l)}: ${p.y}</title></circle>`).join('')}
    <text x="${x(points.length - 1)}" y="${y(last.y) - 10}" text-anchor="end" class="v">${last.y}</text>
    ${points.map((p, i) => (i % Math.ceil(points.length / 12) === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.x)}</text>` : '')).join('')}</svg>`;
}

async function viewNBATeam(id, ok, params) {
  $app.innerHTML = `<div class="stack">${skel(240)}${skel(400)}</div>`;
  const t = await api(`/esportes/nba/time/${id}`, 600000);
  if (!ok()) return;
  Taste.bump('n', id, 3, { n: t.curto || t.nome, e: t.logo });
  Taste.bump('e', 'nba', 1);
  let tab = params.get('aba') || 'visao';
  const c = t.campanha || {};
  const game = (g) => `<a class="tg-row" href="#/nba/jogo/${g.id}"><span class="when">${esc(fmtDT(g.data_iso, { day: '2-digit', month: 'short' }))}</span>
    <span class="vs">${g.casa ? 'vs' : '@'}</span><span class="tn">${logo(g.adversario.logo, 22)}<b>${esc(g.adversario.nome)}</b></span>
    ${g.status === 'finalizado' ? `<span class="res ${g.vitoria ? 'w' : 'l'}">${g.vitoria ? 'V' : 'D'}</span><span class="sc">${g.placar}-${g.placar_adv}</span>` : `<span class="sc muted">${esc(fmtDT(g.data_iso, { hour: '2-digit', minute: '2-digit' }))}</span>`}</a>`;
  const render = () => {
    let body;
    if (tab === 'elenco') {
      body = `<div class="card"><div class="card-title">Elenco<span class="more">${t.elenco.length} jogadores${t.tecnico ? ` · técnico ${esc(t.tecnico)}` : ''}</span></div>
        <div class="roster">${t.elenco.map((p) => `<a class="rp" href="#/nba/jogador/${p.id}"><div class="rp-img">${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="rp-n">${esc(p.camisa || '')}</span></div>
          <b>${esc(p.nome)}</b><span>${esc(p.posicao || '')}</span><small>${[p.altura, p.peso, p.idade ? `${p.idade} anos` : ''].filter(Boolean).map(esc).join(' · ')}</small>${p.lesao ? `<em class="inj">${esc(p.lesao === 'Out' ? 'Fora' : p.lesao)}</em>` : ''}</a>`).join('')}</div></div>`;
    } else if (tab === 'jogos') {
      body = `<div class="cols-2 even"><div class="card"><div class="card-title">Próximos jogos</div>${t.proximos.map(game).join('') || empty('Sem jogos marcados.')}</div>
        <div class="card"><div class="card-title">Últimos resultados</div>${t.ultimos.map(game).join('') || empty('Ainda sem jogos.')}</div></div>`;
    } else {
      const form = t.ultimos.slice(0, 5).reverse().map((g) => `<i class="${g.vitoria ? 'v' : 'd'}">${g.vitoria ? 'V' : 'D'}</i>`).join('');
      body = `<div class="cols-2"><div class="stack">
        ${t.proximos[0] ? `<div class="card"><div class="card-title">Próximo jogo</div>${game(t.proximos[0])}</div>` : ''}
        ${t.estatisticas.length ? `<div class="card"><div class="card-title">Médias por jogo</div><div class="stat-grid">${t.estatisticas.map((s) => `<div><b>${esc(s.valor)}</b><span>${esc(s.nome)}</span>${s.rank ? `<small>${esc(String(s.rank))} na liga</small>` : ''}</div>`).join('')}</div></div>` : ''}
        <div class="card"><div class="card-title">Últimos resultados<a class="more" data-goto="jogos">Todos</a></div>${t.ultimos.slice(0, 5).map(game).join('') || empty('Ainda sem jogos.')}</div>
      </div><aside class="side">
        <div class="card"><div class="card-title">Destaques do elenco</div>${t.elenco.slice(0, 6).map((p) => `<a class="list-row" href="#/nba/jogador/${p.id}">${p.foto ? `<img class="hs" src="${esc(p.foto)}" alt="" loading="lazy">` : ''}<div><b>${esc(p.nome)}</b><div class="small muted">${esc(p.posicao || '')} · #${esc(p.camisa || '')}</div></div></a>`).join('')}<a class="more-link" data-goto="elenco">Ver elenco completo</a></div>
        ${form ? `<div class="card card-body"><div class="sec-label" style="padding:0 0 8px">Últimos 5</div><span class="form">${form}</span></div>` : ''}
      </aside></div>`;
    }
    $app.innerHTML = `<div class="stack">${sportBar('nba')}
      <div class="card hero" style="${heroStyle(t.cor)}"><div class="hero-main">${logo(t.logo, 96)}
        <div><div class="eyebrow">NBA · ${esc(t.resumo || '')}</div><h1>${esc(t.nome)}</h1><div class="sub">${esc([t.ginasio, t.local].filter(Boolean).join(' · '))}</div></div></div>
        ${kpis([[`${c.v}-${c.d}`, 'Campanha', c.posicao ? `${c.posicao}º na conferência` : ''], [c.pontos_pro, 'Pontos por jogo'], [c.pontos_contra, 'Sofridos por jogo'],
                [`${c.saldo > 0 ? '+' : ''}${c.saldo}`, 'Saldo médio'], c.sequencia ? [esc(c.sequencia), 'Sequência'] : null, t.casa_fora ? [t.casa_fora.casa, 'Em casa', `fora ${t.casa_fora.fora}`] : null])}
        <nav class="tabs">${[['visao', 'Visão geral'], ['jogos', 'Jogos'], ['elenco', 'Elenco']].map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav></div>
      ${body}</div>`;
    const go = (k) => { tab = k; history.replaceState(null, '', `#/nba/time/${id}?aba=${k}`); render(); };
    $app.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', () => go(a.dataset.tab)));
    $app.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', () => go(a.dataset.goto)));
  };
  render();
}

async function viewNBAPlayer(id, ok) {
  $app.innerHTML = `<div class="stack">${skel(240)}${skel(300)}</div>`;
  const p = await api(`/esportes/nba/jogador/${id}`, 600000);
  if (!ok()) return;
  const t = p.time || {};
  const season = (p.medias || [])[0], career = (p.medias || [])[1];
  const val = (m, s) => ((m && m.stats.find((x) => x.sigla === s)) || {}).valor || '–';
  $app.innerHTML = `<div class="stack">${sportBar('nba')}
    <div class="card hero" style="${heroStyle(t.cor)}"><div class="hero-main">
      <div class="hero-photo">${p.foto ? `<img src="${esc(p.foto)}" alt="">` : ''}${p.camisa ? `<span>#${esc(p.camisa)}</span>` : ''}</div>
      <div><div class="eyebrow">${t.id ? `<a href="#/nba/time/${t.id}">${logo(t.logo, 18)} ${esc(t.nome)}</a>` : 'NBA'}</div><h1>${esc(p.nome)}</h1>
        <div class="sub">${esc([p.posicao, p.idade ? `${p.idade} anos` : '', p.altura, p.peso].filter(Boolean).join(' · '))}</div></div></div>
      ${season ? kpis([[val(season, 'PTS'), 'Pontos', `carreira ${val(career, 'PTS')}`], [val(season, 'REB'), 'Rebotes', `carreira ${val(career, 'REB')}`], [val(season, 'AST'), 'Assistências', `carreira ${val(career, 'AST')}`],
        [val(season, 'FG%'), 'Arremessos %'], [val(season, '3P%'), 'Bolas de 3 %'], [val(season, 'MIN'), 'Minutos', `${val(season, 'GP')} jogos`]]) : ''}</div>
    <div class="cols-2"><div class="stack">
      ${(p.ultimos_jogos || []).length ? `<div class="card"><div class="card-title">Últimos jogos</div><div class="table-wrap"><table class="tbl"><thead><tr><th class="l">Jogo</th><th>Res.</th><th>Pts</th><th>Reb</th><th>Ast</th><th class="hide-sm">Min</th></tr></thead><tbody>
        ${p.ultimos_jogos.map((g) => `<tr><td class="team l"><a href="#/nba/jogo/${g.id}"><span class="tn"><span class="small muted">${esc(fmtDT(g.data_iso, { day: '2-digit', month: 'short' }))}</span> ${g.casa ? 'vs' : '@'} ${logo(g.adv_logo, 18)}<b>${esc(g.adversario || '')}</b></span></a></td>
          <td><span class="res ${g.resultado === 'W' ? 'w' : 'l'}">${g.resultado === 'W' ? 'V' : 'D'}</span> <span class="small muted">${esc(g.placar || '')}</span></td><td class="pts">${esc(g.pts || '')}</td><td>${esc(g.reb || '')}</td><td>${esc(g.ast || '')}</td><td class="hide-sm">${esc(g.min || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${(p.medias || []).length ? `<div class="card"><div class="card-title">Médias</div><div class="table-wrap"><table class="tbl"><thead><tr><th class="l"></th>${p.medias[0].stats.map((s) => `<th title="${esc(s.nome)}">${esc(s.sigla)}</th>`).join('')}</tr></thead><tbody>
        ${p.medias.map((m) => `<tr><td class="l"><b>${esc(m.nome)}</b></td>${m.stats.map((s) => `<td class="${s.sigla === 'PTS' ? 'pts' : ''}">${esc(s.valor)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}
    </div><aside class="side"><div class="card"><div class="card-title">Ficha</div><div class="facts-grid">${[['Nome completo', p.nome_completo], ['Nascimento', p.nascimento], ['Naturalidade', p.naturalidade], ['Universidade', p.universidade], ['Draft', p.draft], ['Experiência', p.experiencia]]
      .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div></div></aside></div></div>`;
}

const posClass = (r) => (!r.classificado ? 'dnf' : r.posicao === 1 ? 'p1' : r.posicao <= 3 ? 'pod' : r.posicao <= 10 ? 'pts' : '');
async function viewF1Driver(id, ok) {
  $app.innerHTML = `<div class="stack">${skel(260)}${skel(300)}</div>`;
  const d = await api(`/esportes/f1/piloto/${id}`, 600000);
  if (!ok()) return;
  Taste.bump('p', id, 3, { n: d.nome, e: d.bandeira });
  Taste.bump('e', 'f1', 1);
  const team = d.equipe || {};
  const cs = d.campeonato || {}, cr = d.carreira || {};
  const tm = d.companheiro;
  const duel = (label, a, b) => { const tot = (a + b) || 1; return `<div class="duel"><div class="duel-top"><b>${a}</b><span>${label}</span><b>${b}</b></div><div class="duel-bar"><i style="width:${(a / tot) * 100}%;background:${esc(team.cor || 'var(--brand)')}"></i><i style="width:${(b / tot) * 100}%"></i></div></div>`; };
  $app.innerHTML = `<div class="stack">${sportBar('f1')}
    <div class="card hero f1h" style="${heroStyle(team.cor)}"><div class="hero-main">
      <div class="hero-photo tall">${d.foto ? `<img src="${esc(d.foto)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
      <div><div class="eyebrow">${team.id ? `<a href="#/f1/equipe/${esc(team.id)}"><i class="tc" style="background:${esc(team.cor)}"></i> ${esc(team.nome)}</a>` : 'Fórmula 1'}</div>
        <h1>${flag(d.bandeira, 28)} ${esc(d.nome)}</h1><div class="sub">${esc([d.idade ? `${d.idade} anos` : '', d.nascimento ? `nascido em ${d.nascimento}` : ''].filter(Boolean).join(' · '))}</div></div>
      ${d.numero ? `<div class="big-num">${esc(d.numero)}</div>` : ''}</div>
      ${kpis([[cs.posicao ? `${cs.posicao}º` : '–', 'No campeonato', `${cs.pontos ?? 0} pontos`], [cs.vitorias ?? 0, 'Vitórias em 2026'], [cr.titulos, 'Títulos mundiais'], [cr.vitorias, 'Vitórias na carreira'], [cr.podios, 'Pódios'], [cr.poles, 'Poles'], [cr.corridas, 'GPs disputados']])}</div>
    <div class="cols-2"><div class="stack">
      <div class="card"><div class="card-title">Pontos na temporada<span class="more">corridas + sprints</span></div>${lineChart(d.temporada.map((r) => ({ x: r.rodada, y: r.acumulado, l: r.gp })), team.cor || 'var(--brand)', { label: 'Pontos acumulados' })}</div>
      <div class="card"><div class="card-title">Etapa a etapa</div><div class="results-strip">${d.temporada.map((r) => `<a class="rs ${posClass(r)}" href="#/f1/corrida/${r.rodada}" title="${esc(r.gp)} · largou ${r.largada || 'box'} · ${esc(r.classificado ? r.posicao + 'º' : r.status)}"><span>${r.classificado ? r.posicao : 'AB'}</span><small>${esc(r.gp.replace(/^GP (do|da|de) /, '').slice(0, 10))}</small></a>`).join('')}</div>
        <div class="legend"><span style="--c:#d4a017">Vitória</span><span style="--c:#9aa4b1">Pódio</span><span style="--c:var(--brand)">Pontos</span><span style="--c:var(--loss)">Abandono</span></div></div>
      ${d.resumo ? `<div class="card"><div class="card-title">Sobre</div><div class="card-body bio">${esc(d.resumo)}<div class="small faint" style="margin-top:8px">Fonte: Wikipédia</div></div></div>` : ''}
    </div><aside class="side">
      ${tm ? `<div class="card"><div class="card-title">Duelo com o companheiro</div><div class="duel-head"><span>${esc(d.sobrenome)}</span><span>x</span><a href="#/f1/piloto/${esc(tm.piloto.id)}">${esc(tm.piloto.sobrenome)}</a></div>
        ${duel('Chegou à frente', tm.corrida[0], tm.corrida[1])}${duel('Largou à frente', tm.largada[0], tm.largada[1])}${duel('Pontos', tm.pontos[0], tm.pontos[1])}</div>` : ''}
      <div class="card"><div class="card-title">Ficha</div><div class="facts-grid">${[['Número', d.numero], ['Sigla', d.sigla], ['Equipe', team.nome], ['Nascimento', d.nascimento]].filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div></div>
      <div class="card card-body small muted">Títulos mundiais: levantamento até 2025 + o título de 2026 quando já decidido. Demais números: Jolpica (base Ergast).</div>
    </aside></div></div>`;
}

async function viewF1Team(id, ok) {
  $app.innerHTML = `<div class="stack">${skel(260)}${skel(300)}</div>`;
  const t = await api(`/esportes/f1/equipe/${id}`, 600000);
  if (!ok()) return;
  Taste.bump('e', 'f1', 1);
  const cs = t.campeonato || {}, cr = t.carreira || {};
  const maxPts = Math.max(1, ...t.temporada.map((r) => r.pontos));
  $app.innerHTML = `<div class="stack">${sportBar('f1')}
    <div class="card hero f1h" style="${heroStyle(t.cor)}"><div class="hero-main">
      <div class="hero-photo wide">${t.foto ? `<img src="${esc(t.foto)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
      <div><div class="eyebrow"><i class="tc" style="background:${esc(t.cor)}"></i> Equipe de Fórmula 1</div><h1>${esc(t.nome)}</h1><div class="sub">${esc(t.pais || '')}</div></div></div>
      ${kpis([[cs.posicao ? `${cs.posicao}º` : '–', 'Construtores', `${cs.pontos ?? 0} pontos`], [cs.vitorias ?? 0, 'Vitórias em 2026'], [cr.titulos, 'Títulos de construtores'], [cr.vitorias, 'Vitórias na história'], [cr.poles, 'Poles na história']])}</div>
    <div class="cols-2"><div class="stack">
      <div class="team-drivers">${t.pilotos.map((x) => `<a class="card td" href="#/f1/piloto/${esc(x.piloto.id)}" style="${heroStyle(t.cor)}">${flag(x.piloto.bandeira, 24)}<div><b>${esc(x.piloto.nome)}</b><span>${x.pontos} pontos · melhor ${x.melhor < 99 ? x.melhor + 'º' : '–'}</span><small>${x.vitorias} vitória${x.vitorias === 1 ? '' : 's'} · ${x.podios} pódio${x.podios === 1 ? '' : 's'}</small></div></a>`).join('')}</div>
      <div class="card"><div class="card-title">Pontos acumulados</div>${lineChart(t.temporada.map((r) => ({ x: r.rodada, y: r.acumulado, l: r.gp })), t.cor, { label: 'Pontos acumulados' })}</div>
      <div class="card"><div class="card-title">Pontos por etapa</div><div class="bars">${t.temporada.map((r) => `<a href="#/f1/corrida/${r.rodada}" title="${esc(r.gp)}: ${r.pontos} pts"><i style="height:${(r.pontos / maxPts) * 100}%;background:${esc(t.cor)}"></i><span>${r.rodada}</span></a>`).join('')}</div></div>
      <div class="card"><div class="card-title">Resultados</div><div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th class="l">GP</th>${t.pilotos.map((x) => `<th>${esc(x.piloto.sigla)}</th>`).join('')}<th>Pts</th></tr></thead><tbody>
        ${t.temporada.map((r) => `<tr><td class="muted">${r.rodada}</td><td class="l"><a href="#/f1/corrida/${r.rodada}">${esc(r.gp)}</a></td>${t.pilotos.map((x) => { const res = r.resultados.find((y) => y.piloto === x.piloto.sigla || y.piloto === x.piloto.sobrenome); return `<td>${res ? (res.posicao ? `<span class="rpos ${res.posicao === 1 ? 'p1' : res.posicao <= 3 ? 'pod' : res.posicao <= 10 ? 'pts' : ''}">${res.posicao}</span>` : '<span class="rpos dnf">AB</span>') : '–'}</td>`; }).join('')}<td class="pts">${r.pontos}</td></tr>`).join('')}</tbody></table></div></div>
    </div><aside class="side">${t.resumo ? `<div class="card"><div class="card-title">Sobre</div><div class="card-body bio">${esc(t.resumo)}<div class="small faint" style="margin-top:8px">Fonte: Wikipédia</div></div></div>` : ''}
      <div class="card card-body small muted">Títulos: levantamento até 2025 + o de 2026 quando já decidido. Vitórias e poles: Jolpica (base Ergast), com o nome atual da equipe.</div></aside></div></div>`;
}

/* ================= Faixa "outros esportes" no início ================= */
async function otherSportsCard() {
  const [nba, f1] = await Promise.all([soft(api('/esportes/nba/jogos', 60000)), soft(api('/esportes/f1', 300000))]);
  const games = ((nba && nba.jogos) || []).slice(0, 4);
  const nx = f1 && f1.proxima;
  const now = Date.now();
  const ses = nx ? nx.sessoes.find((s) => isoDate(s.data_iso) > now - 2 * 3600e3) : null;
  const live = otherLive.f1;
  if (!games.length && !nx) return '';
  return `<div class="card other-sports"><div class="card-title">Outros esportes</div>
    ${nx ? `<a class="os-f1" href="#/f1">${SPORT_ICON.f1}<div><b>${live ? `<span class="live-dot"></span> ${esc(live.nome)} ao vivo` : esc(nx.nome)}</b><span class="small muted">${live ? esc((live.ordem[0] || {}).nome ? `Líder: ${live.ordem[0].nome}` : '') : ses ? `${esc(ses.nome)} · ${esc(fmtDT(ses.data_iso))}` : ''}</span></div></a>` : ''}
    ${games.length ? `<div class="sec-label">NBA</div>${games.map((g) => `<a class="os-nba" href="#/nba/jogo/${g.id}"><span class="t">${logo(g.fora.logo, 18)}${esc(g.fora.sigla)} <b>${g.fora.placar ?? ''}</b></span><span class="t">${logo(g.casa.logo, 18)}${esc(g.casa.sigla)} <b>${g.casa.placar ?? ''}</b></span>
      <span class="small ${g.status === 'andamento' ? 'live' : 'muted'}">${g.status === 'andamento' ? esc(g.periodo || 'Ao vivo') : g.status === 'finalizado' ? 'Final' : esc(g.hora || '')}</span></a>`).join('')}<a class="more-link" href="#/nba">Todos os jogos da NBA</a>` : ''}</div>`;
}
