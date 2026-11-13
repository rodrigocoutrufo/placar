/* Placar — SPA em JavaScript puro.
 * Consome /api/* (server.py), sempre no formato da API Futebol, venha o dado da API Futebol ou da ESPN. */
'use strict';

const LIVE_POLL_MS = 30000; // a documentação recomenda consultar o ao vivo a cada 15–30 s
const MATCH_POLL_MS = 15000;
const $app = document.getElementById('app');

/* ============ API ============ */
const memo = new Map();
const sources = new Set();
function api(path, ttl = 10000) {
  const now = Date.now();
  const hit = memo.get(path);
  if (hit && hit.exp > now) return hit.promise;
  const promise = fetch('/api' + path).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || `Erro ${r.status}`);
    const src = r.headers.get('X-Data-Source');
    if (src && !sources.has(src)) { sources.add(src); renderFooter(); }
    return body;
  });
  memo.set(path, { exp: now + ttl, promise });
  promise.catch(() => memo.delete(path));
  return promise;
}
const fresh = (path) => { memo.delete(path); return api(path); };
const soft = (p) => p.catch(() => null);

function renderFooter() {
  const parts = [];
  if (sources.has('live')) parts.push('API Futebol');
  if (sources.has('espn')) parts.push('ESPN (fonte pública, não oficial)');
  if (sources.has('football-data')) parts.push('football-data.org');
  if (sources.has('transfermarkt')) parts.push('Transfermarkt');
  document.getElementById('footer').innerHTML = `${parts.length ? `Dados: ${esc(parts.join(' · '))}. Horários de Brasília. ` : ''}<a href="#/sobre">Sobre, fontes e privacidade</a>`;
}

/* ============ Ícones ============ */
const I = {
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/><path d="M12 3v4M20.5 9.5 16 10M17 19l-2.5-4.5M7 19l2.5-4.5M3.5 9.5 8 10"/></svg>',
  in: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>',
};
const cardIcon = (c) => `<span class="cardi ${c}"></span>`;

/* ============ Cores dos clubes ============ */
const CLUB_COLORS = {
  FLA: '#c8102e', PAL: '#006437', COR: '#222222', SAO: '#d0021b', SAN: '#222222', VAS: '#222222', FLU: '#7a0026', BOT: '#222222',
  GRE: '#0d80bf', INT: '#d0021b', CAM: '#222222', CRU: '#1a3c8f', BAH: '#0050a0', FOR: '#0b3d91', CEA: '#222222', CAP: '#c8102e',
  BGT: '#d0021b', RBB: '#d0021b', VIT: '#d0021b', JUV: '#00843d', SPT: '#d0021b', MIR: '#e6c200', CHA: '#00843d', CFC: '#00543d', REM: '#0033a0',
};
function teamColor(t) {
  if (!t) return '#3d6b4f';
  if (t.cor) return t.cor;
  if (CLUB_COLORS[t.sigla]) return CLUB_COLORS[t.sigla];
  let h = 0; for (const c of String(t.nome_popular || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 38%)`;
}
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
const inkFor = (c) => (luminance(c) > 0.6 ? '#111' : '#fff');
// cor da camisa/barra legível: clubes de cor muito escura ou muito clara usam a secundária se ela contrastar melhor
function kitColor(t) {
  const c = teamColor(t);
  const l = luminance(c);
  if ((l < 0.12 || l > 0.9) && t && t.cor_secundaria && Math.abs(luminance(t.cor_secundaria) - 0.5) < Math.abs(l - 0.5)) return t.cor_secundaria;
  return c;
}
function barColors(h, a) {
  let ch = kitColor(h), ca = kitColor(a);
  if (luminance(ch) < 0.12) ch = '#6b7280';
  if (luminance(ca) < 0.12) ca = '#6b7280';
  if (ch === ca) ca = '#9ca3af';
  return [ch, ca];
}

/* ============ Registro local ============ */
const registry = { teams: new Map(), players: new Map() };
function regTeam(t) { if (t && t.time_id) registry.teams.set(+t.time_id, { ...registry.teams.get(+t.time_id), ...t }); }
function regPlayer(a, extra = {}) {
  if (!a || !a.atleta_id) return;
  const prev = registry.players.get(+a.atleta_id) || {};
  const ok = (p) => p && p.nome;
  registry.players.set(+a.atleta_id, { ...prev, ...extra, ...a, nome_popular: (a.nome_popular || prev.nome_popular || '').trim(),
    posicao: ok(a.posicao) ? a.posicao : ok(extra.posicao) ? extra.posicao : prev.posicao, time: extra.time || prev.time });
}
const regMatch = (p) => { if (p) { regTeam(p.time_mandante); regTeam(p.time_visitante); } };

/* ============ Preferências ============ */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponível */ }
    if (window.onStoreSet) window.onStoreSet(k); // sincroniza com a conta (account.js)
  },
};
// Favoritos: o mesmo clube pode ter vindo com IDs de fontes diferentes (ex.: Série B pela API Futebol e pela
// ESPN). Um clube = um favorito: duplicados pelo nome são unidos, preferindo o ID canônico (ESPN/football-data).
const CANON_MIN = 800000000;
function getFavs() {
  const f = store.get('placar.favs', {});
  const byName = new Map();
  Object.values(f).forEach((t) => {
    const k = norm(t.nome_popular), cur = byName.get(k);
    if (!cur || (+t.time_id >= CANON_MIN && +cur.time_id < CANON_MIN)) byName.set(k, t);
  });
  if (byName.size === Object.keys(f).length) return f;
  const out = {};
  byName.forEach((t) => { out[t.time_id] = t; });
  store.set('placar.favs', out);
  return out;
}
const favByName = (name) => Object.values(getFavs()).find((x) => norm(x.nome_popular) === norm(name));
const isFav = (id) => { if (getFavs()[id]) return true; const t = registry.teams.get(+id); return !!(t && favByName(t.nome_popular)); };
function toggleFav(t) {
  const f = getFavs();
  const same = Object.values(f).filter((x) => +x.time_id === +t.time_id || norm(x.nome_popular) === norm(t.nome_popular));
  if (same.length) same.forEach((x) => delete f[x.time_id]);
  else f[t.time_id] = { time_id: t.time_id, nome_popular: t.nome_popular, sigla: t.sigla, escudo: t.escudo, cor: t.cor };
  store.set('placar.favs', f);
  return !same.length;
}

/* ============ Helpers ============ */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const titleize = (s) => String(s || '').split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const dark = () => document.documentElement.dataset.theme === 'dark';
// escudos/logos têm versão própria para fundo escuro quando a fonte oferece
const crest = (t, size = 22, cls = '') => t && (t.escudo || t.escudo_escuro) ? `<img class="crest ${cls}" src="${esc((dark() && t.escudo_escuro) || t.escudo || '')}" alt="" width="${size}" height="${size}" loading="lazy" onerror="if(this.dataset.f!=='1'&&'${esc(t.escudo || '')}'){this.dataset.f='1';this.src='${esc(t.escudo || '')}'}else{this.style.visibility='hidden'}">` : `<span style="display:inline-block;width:${size}px;height:${size}px;flex:none"></span>`;
const compLogo = (c, size = 18) => c && c.logo ? `<img class="crest" src="${esc((dark() && c.logo_escuro) || c.logo)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.visibility='hidden'">` : '';
const parseDate = (p) => p && p.data_realizacao_iso ? new Date(p.data_realizacao_iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
const dayKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'tbd';
const fmtDay = (d) => d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Data a definir';
const fmtShort = (d) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const fmtTime = (p) => (p && p.hora_realizacao) || '–';
const isLive = (p) => p && (p.status === 'andamento' || p.status === 'ao-vivo');
const PERIOD = { 'primeiro-tempo': '1º tempo', intervalo: 'Intervalo', 'segundo-tempo': '2º tempo', 'fim-de-jogo': 'Encerrado', 'primeiro-tempo-prorrogacao': 'Prorrogação', 'segundo-tempo-prorrogacao': 'Prorrogação', 'intervalo-prorrogacao': 'Intervalo da prorrogação', 'disputa-penalti': 'Pênaltis', 'disputa-penaltis': 'Pênaltis' };
// status da documentação que não são "agendado/andamento/finalizado"
const STATUS_NAME = { adiado: 'Adiado', cancelado: 'Cancelado', suspenso: 'Suspenso', suspensa: 'Suspensa', 'pre-jogo': 'Pré-jogo' };
function liveLabel(p) {
  if (p.periodo === 'intervalo') return 'Intervalo';
  if (p.periodo === 'disputa-penalti' || p.periodo === 'disputa-penaltis') return 'Pênaltis';
  if (p.periodo === 'intervalo-prorrogacao') return 'Intervalo';
  if (p.cronometro_label) return p.cronometro_label;
  return p.cronometro != null ? `${p.cronometro}'` : 'Ao vivo';
}
const penScore = (p) => { const d = p.disputa_penalti; return d && typeof d === 'object' ? [d.placar_penalti_mandante, d.placar_penalti_visitante] : null; };
function winnerSide(p) {
  if (p.status !== 'finalizado' || p.placar_mandante == null) return null;
  if (p.placar_mandante !== p.placar_visitante) return p.placar_mandante > p.placar_visitante ? 'h' : 'a';
  const pen = penScore(p);
  return pen ? (pen[0] > pen[1] ? 'h' : 'a') : null;
}
function resultFor(p, id) {
  if (p.status !== 'finalizado' || p.placar_mandante == null) return null;
  const home = +p.time_mandante.time_id === id;
  const [g, c] = home ? [p.placar_mandante, p.placar_visitante] : [p.placar_visitante, p.placar_mandante];
  return g > c ? 'v' : g < c ? 'd' : 'e';
}
// Minuto de um lance: a ESPN já manda o rótulo; a API Futebol manda "mm:ss" dentro do período
const PERIOD_BASE = { 'primeiro-tempo': [0, 45], intervalo: [45, 0], 'segundo-tempo': [45, 45], 'primeiro-tempo-prorrogacao': [90, 15], 'segundo-tempo-prorrogacao': [105, 15] };
function evMinute(e) {
  if (e.minuto_label != null) return { label: e.minuto_label || '–', key: e.ordem_seg || 0 };
  const slug = e.periodo_slug;
  const [base, len] = PERIOD_BASE[slug] || [0, 45];
  if (slug === 'intervalo' || !e.minuto) return { label: slug === 'intervalo' ? 'Int' : '–', key: base * 60 + 1 };
  const [m, s] = String(e.minuto).split(':').map(Number);
  const n = Math.floor(m) + 1;
  return { label: n > len ? `${base + len}+${n - len}'` : `${base + n}'`, key: base * 60 + m * 60 + (s || 0) };
}
function toast(html, img) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (img ? `<img src="${esc(img)}" alt="">` : '') + `<div>${html}</div>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
const skel = (h, n = 1) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px"></div>`).join('');
const empty = (text) => `<div class="empty">${text}</div>`;
const errorBox = (e) => `<div class="card err-retry"><div class="empty"><div style="font-weight:600;color:var(--text)">Não foi possível carregar</div><div class="small" style="margin:4px 0 4px">${esc(e && e.message)}</div><div class="small faint" style="margin-bottom:12px">Tentando de novo automaticamente…</div><button class="btn" onclick="router()">Tentar agora</button></div></div>`;
// Página com erro (servidor reiniciando, internet caiu): tenta de novo sozinha a cada 15 s
setInterval(() => { if (!document.hidden && navigator.onLine !== false && document.querySelector('#app > .err-retry, #app .err-retry')) router(); }, 15000);

/* ============ Tempo real: transmissão ao vivo, alertas de gol e tema ============ */
// Alertas: 'off' (desligado) | 'fav' (só jogos dos meus times) | 'all' (todos os jogos)
const alertMode = () => { const v = store.get('placar.alerts', 'off'); return v === true ? 'all' : v === false ? 'off' : v; };
const involvesFav = (p) => { const f = getFavs(); return !!(f[p.time_mandante.time_id] || f[p.time_visitante.time_id]); };
let streamOn = false; // com a transmissão ativa, os gols chegam por ela (sem toast duplicado)
const lastScores = new Map();

function flashMatch(id) {
  document.querySelectorAll(`[data-match="${id}"]`).forEach((el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}
function goalNotice(p, team, autor) {
  const score = `${p.time_mandante.nome_popular} ${p.placar_mandante} x ${p.placar_visitante} ${p.time_visitante.nome_popular}`;
  const who = autor && autor.nome ? `${autor.minuto ? `${autor.minuto} ` : ''}${autor.nome}${autor.penalti ? ' (pênalti)' : autor.contra ? ' (contra)' : ''}` : '';
  const mode = alertMode();
  if (mode === 'all' || (mode === 'fav' && involvesFav(p)) || location.hash.includes(`/partida/${p.partida_id}`)) {
    toast(`<b>Gol do ${esc(team.nome_popular)}!</b>${who ? ` ${esc(who)}` : ''}<br><span class="small">${esc(score)}</span>`, team.escudo);
    if (mode !== 'off' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(`Gol do ${team.nome_popular}!`, { body: `${who ? who + ' · ' : ''}${score}`, icon: team.escudo, tag: `gol-${p.partida_id}` });
    }
  }
  flashMatch(p.partida_id);
}
function checkGoals(list) { // usado no modo de consulta periódica (sem transmissão) e ao abrir uma partida
  for (const p of list) {
    const key = `${p.placar_mandante ?? 0}-${p.placar_visitante ?? 0}`;
    const prev = lastScores.get(p.partida_id);
    lastScores.set(p.partida_id, key);
    if (!prev || prev === key || streamOn) continue;
    const [ph, pa] = prev.split('-').map(Number);
    const team = (p.placar_mandante ?? 0) > ph ? p.time_mandante : (p.placar_visitante ?? 0) > pa ? p.time_visitante : null;
    if (team) goalNotice(p, team, null);
  }
}

const $alerts = document.getElementById('alerts-btn');
const ALERT_LABEL = { off: 'Alertas de gol desligados.', fav: 'Alertas de gol só dos seus times favoritos.', all: 'Alertas de gol de todos os jogos.' };
function paintAlerts() { $alerts.classList.toggle('on', alertMode() !== 'off'); $alerts.title = ALERT_LABEL[alertMode()]; }
paintAlerts();
$alerts.addEventListener('click', async () => {
  const next = { off: 'fav', fav: 'all', all: 'off' }[alertMode()];
  if (next !== 'off' && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  store.set('placar.alerts', next);
  paintAlerts();
  toast(ALERT_LABEL[next] + (next === 'fav' && !Object.keys(getFavs()).length ? ' Siga um time para receber.' : ''));
});
document.getElementById('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('placar.theme', next); } catch { /* ignore */ }
  if (window.onStoreSet) window.onStoreSet('placar.theme');
  router(); // redesenha para trocar escudos/logos pela versão do tema
});

let liveNow = [];
function applyLive(list) {
  liveNow = list;
  list.forEach((p) => { regMatch(p); lastScores.set(p.partida_id, `${p.placar_mandante ?? 0}-${p.placar_visitante ?? 0}`); });
  memo.set('/ao-vivo', { exp: Date.now() + 15000, promise: Promise.resolve(list) });
  if (view.onLive) view.onLive(list);
}
async function pollLive() {
  if (streamOn && liveNow) return liveNow;
  try { const live = await fresh('/ao-vivo'); live.forEach(regMatch); checkGoals(live); liveNow = live; return live; } catch { return null; }
}

// Transmissão ao vivo (Server-Sent Events). Se não conectar, volta a consultar a cada 30 s.
let stream = null, streamFails = 0;
function connectStream() {
  if (!('EventSource' in window) || stream) return;
  stream = new EventSource('/api/stream');
  stream.addEventListener('open', () => {
    streamOn = true; streamFails = 0;
    if (document.querySelector('#app .err-retry')) router(); // servidor voltou: recarrega a tela que deu erro
  });
  stream.addEventListener('snapshot', (e) => applyLive(JSON.parse(e.data)));
  stream.addEventListener('update', (e) => applyLive(JSON.parse(e.data)));
  stream.addEventListener('gol', (e) => { const d = JSON.parse(e.data); goalNotice(d.partida, d.time, d.autor); });
  stream.addEventListener('outros', (e) => { // NBA e F1 ao vivo
    otherLive = JSON.parse(e.data);
    document.querySelectorAll('.sportbar a').forEach((a) => {
      const k = (a.getAttribute('href') || '').slice(2);
      const on = (k === 'nba' && (otherLive.nba || []).length) || (k === 'f1' && otherLive.f1);
      const dot = a.querySelector('.live-dot');
      if (on && !dot) a.insertAdjacentHTML('beforeend', '<span class="live-dot"></span>'); else if (!on && dot) dot.remove();
    });
    if (view.onOther) view.onOther(otherLive);
  });
  stream.addEventListener('periodo', (e) => {
    const d = JSON.parse(e.data);
    if (involvesFav(d.partida) || location.hash.includes(`/partida/${d.partida.partida_id}`)) {
      toast(`<b>${esc(d.texto)}</b><br><span class="small">${esc(d.partida.time_mandante.nome_popular)} ${d.partida.placar_mandante ?? 0} x ${d.partida.placar_visitante ?? 0} ${esc(d.partida.time_visitante.nome_popular)}</span>`);
    }
  });
  stream.addEventListener('error', () => {
    streamOn = false;
    if (++streamFails >= 3) { stream.close(); stream = null; setTimeout(connectStream, 60000); } // tenta de novo em 1 min
  });
}
connectStream();
setInterval(() => { if (!document.hidden && !streamOn) pollLive().then((l) => l && view.onLive && view.onLive(l)); }, LIVE_POLL_MS);

// Minuto correndo entre uma atualização e outra
function liveTag(p) {
  const base = p.cronometro != null && ['primeiro-tempo', 'segundo-tempo', 'primeiro-tempo-prorrogacao', 'segundo-tempo-prorrogacao'].includes(p.periodo) && !/\+/.test(p.cronometro_label || '');
  return base ? `<span class="lmin" data-min="${+p.cronometro}" data-per="${esc(p.periodo)}" data-at="${Date.now()}">${esc(liveLabel(p))}</span>` : esc(liveLabel(p));
}
const PERIOD_END = { 'primeiro-tempo': 45, 'segundo-tempo': 90, 'primeiro-tempo-prorrogacao': 105, 'segundo-tempo-prorrogacao': 120 };
setInterval(() => {
  document.querySelectorAll('.lmin').forEach((el) => {
    const m = +el.dataset.min + Math.floor((Date.now() - +el.dataset.at) / 60000);
    const end = PERIOD_END[el.dataset.per] || 90;
    el.textContent = m > end ? `${end}+${m - end}'` : `${m}'`;
  });
}, 10000);


/* ============ Dados derivados ============ */
function flattenTable(t) {
  if (Array.isArray(t)) return t.length ? [{ title: '', rows: t }] : [];
  const out = [];
  Object.entries(t || {}).forEach(([fase, v]) => {
    if (Array.isArray(v)) out.push({ title: titleize(fase), rows: v });
    else Object.entries(v || {}).forEach(([g, rows]) => Array.isArray(rows) && out.push({ title: titleize(g), rows }));
  });
  return out;
}
function faseMatches(f) {
  const out = [];
  const walk = (v) => { if (!v) return; if (Array.isArray(v)) v.forEach(walk); else if (v.partida_id) out.push(v); else if (typeof v === 'object') Object.values(v).forEach(walk); };
  walk(f.partidas);
  (f.chaves || []).forEach((c) => { walk(c.partida_ida); walk(c.partida_volta); });
  return out;
}
// GET /campeonatos/{id}/rodadas: a ESPN devolve uma lista; a API Futebol (Série B) agrupa por fase
// ({"fase-unica": [...]}). As duas viram uma lista só, em ordem de rodada.
const roundsList = (r) => (Array.isArray(r) ? r : Object.values(r || {}).flat().filter((x) => x && x.rodada != null))
  .sort((a, b) => a.rodada - b.rodada);
const isLeague = (c) => !!c.rodada_atual || (c.fase_atual && c.fase_atual.tipo === 'pontos-corridos');
const byWeek = (c) => c.agrupamento === 'semana';
function tieResult(c) {
  const legs = [c.partida_ida, c.partida_volta].filter(Boolean);
  if (!legs.length) return null;
  const A = legs[0].time_mandante, B = legs[0].time_visitante;
  let a = 0, b = 0, played = 0;
  legs.forEach((p) => {
    if (p.placar_mandante == null) return;
    played++;
    if (+p.time_mandante.time_id === +A.time_id) { a += p.placar_mandante; b += p.placar_visitante; } else { a += p.placar_visitante; b += p.placar_mandante; }
  });
  const last = legs[legs.length - 1];
  let winner = null;
  if (legs.every((p) => p.status === 'finalizado')) {
    if (a !== b) winner = a > b ? A : B;
    else { const w = winnerSide(last); if (w) winner = w === 'h' ? last.time_mandante : last.time_visitante; }
  }
  const pen = penScore(last);
  let penA = null, penB = null;
  if (pen) [penA, penB] = +last.time_mandante.time_id === +A.time_id ? pen : [pen[1], pen[0]];
  return { A, B, a, b, played, winner, legs, penA, penB };
}
function progressText(c) {
  if (c.jogos_total) return `${c.jogos_disputados} de ${c.jogos_total} jogos disputados`;
  if (c.rodada_atual && isLeague(c)) return c.rodada_atual.nome;
  return '';
}

/* ============ Componentes ============ */
function matchRow(p, { showDate = false, comp = null } = {}) {
  regMatch(p);
  const w = winnerSide(p), live = isLive(p), pen = penScore(p), d = parseDate(p);
  const cls = (s) => (w ? (w === s ? 'win' : 'lose') : '');
  let st, sc;
  if (live) { st = `<div class="st live">${liveTag(p)}</div>`; sc = `<div class="sc live">${p.placar_mandante ?? 0} - ${p.placar_visitante ?? 0}</div>`; }
  else if (p.status === 'finalizado') {
    st = `<div class="st">${showDate ? fmtShort(d) : 'Fim'}</div>`;
    sc = `<div class="sc">${p.placar_mandante} - ${p.placar_visitante}${pen ? `<span class="pen">pên. ${pen[0]}-${pen[1]}</span>` : ''}</div>`;
  } else if (STATUS_NAME[p.status]) {
    st = `<div class="st">${p.status === 'pre-jogo' ? esc(fmtTime(p)) : showDate ? fmtShort(d) : ''}</div>`; sc = `<div class="sc time">${STATUS_NAME[p.status]}</div>`;
  } else { st = `<div class="st">${showDate ? fmtShort(d) : ''}</div>`; sc = `<div class="sc time">${esc(fmtTime(p))}</div>`; }
  return `<a class="match" href="#/partida/${p.partida_id}" data-match="${p.partida_id}">
    ${st}
    <div class="t h ${cls('h')}"><span>${esc(p.time_mandante.nome_popular)}</span>${crest(p.time_mandante, 20)}</div>
    ${sc}
    <div class="t ${cls('a')}">${crest(p.time_visitante, 20)}<span>${esc(p.time_visitante.nome_popular)}</span></div>
    <div class="cmp">${comp ? compLogo(comp, 16) : ''}</div>
  </a>`;
}
function matchesByDate(list, opts = {}) {
  const sorted = [...list].sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0));
  const groups = new Map();
  sorted.forEach((p) => { const k = fmtDay(parseDate(p)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  return [...groups].map(([day, ps]) => `<div class="date-sep">${esc(day)}</div>${ps.map((p) => matchRow(p, opts)).join('')}`).join('');
}
const ZONES = {
  libertadores: ['Libertadores', 'var(--z-lib)'], 'pre-libertadores': ['Pré-Libertadores', 'var(--z-prelib)'], 'sul-americana': ['Sul-Americana', 'var(--z-sula)'],
  rebaixamento: ['Rebaixamento', 'var(--z-rel)'], classificados: ['Classificados', 'var(--z-cls)'], acesso: ['Acesso', 'var(--z-cls)'],
  champions: ['Champions League', 'var(--z-lib)'], 'pre-champions': ['Qualificatória da Champions', 'var(--z-prelib)'], europa: ['Europa League', 'var(--z-sula)'],
  conference: ['Conference League', 'var(--z-conf)'], 'playoff-rebaixamento': ['Playoff de rebaixamento', 'var(--z-prel)'],
  oitavas: ['Oitavas (direto)', 'var(--z-cls)'], playoffs: ['Playoffs', 'var(--z-prelib)'], eliminado: ['Eliminado', 'var(--z-rel)'],
};
const REGIONS = [['nacional', 'Brasil'], ['continental', 'América do Sul'], ['europa', 'Europa']];
const COUNTRY = { England: 'Inglaterra', Spain: 'Espanha', Italy: 'Itália', Germany: 'Alemanha', France: 'França', Portugal: 'Portugal', Netherlands: 'Holanda', Europe: 'Europa' };
const regionLabel = (c) => (c.regiao === 'europa' ? COUNTRY[c.pais] || 'Europa' : c.regiao === 'continental' ? 'América do Sul' : 'Brasil');
const formDots = (f) => `<span class="form">${(f || []).map((x) => `<i class="${esc(x)}">${{ v: 'V', e: 'E', d: 'D' }[x] || ''}</i>`).join('')}</span>`;
function standingsTable(rows, campId, { highlight = [], compact = false } = {}) {
  rows.forEach((r) => regTeam(r.time));
  const favs = getFavs();
  const zones = [...new Set(rows.map((r) => r.faixa_classificacao).filter((z) => ZONES[z]))];
  const gd = (v) => `<span class="${v > 0 ? 'gd-pos' : v < 0 ? 'gd-neg' : ''}">${v > 0 ? '+' : ''}${v}</span>`;
  return `<div class="table-wrap"><table class="tbl">
    <thead><tr><th>#</th><th class="l">Time</th><th>J</th>${compact ? '' : '<th class="hide-sm">V</th><th class="hide-sm">E</th><th class="hide-sm">D</th><th class="hide-sm">Gols</th>'}<th>SG</th><th>P</th>${compact ? '' : '<th class="hide-sm l">Últimos</th>'}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${highlight.includes(+r.time.time_id) || (!highlight.length && favs[r.time.time_id]) ? 'hl' : ''}">
      <td class="pos" style="--z:${(ZONES[r.faixa_classificacao] || [])[1] || 'transparent'}">${r.posicao}</td>
      <td class="team l"><a href="#/time/${r.time.time_id}?c=${campId}">${crest(r.time, 20)}<span>${esc(r.time.nome_popular)}</span></a></td>
      <td>${r.jogos}</td>
      ${compact ? '' : `<td class="hide-sm">${r.vitorias}</td><td class="hide-sm">${r.empates}</td><td class="hide-sm">${r.derrotas}</td><td class="hide-sm">${r.gols_pro}:${r.gols_contra}</td>`}
      <td>${gd(r.saldo_gols)}</td><td class="pts">${r.pontos}</td>
      ${compact ? '' : `<td class="hide-sm l">${formDots(r.ultimos_jogos)}</td>`}</tr>`).join('')}</tbody>
  </table></div>
  ${zones.length && !compact ? `<div class="legend">${zones.map((z) => `<span style="--c:${ZONES[z][1]}">${ZONES[z][0]}</span>`).join('')}</div>` : ''}`;
}
function rankRows(list, key, unit, start = 0) {
  return list.map((s, i) => {
    regTeam(s.time); regPlayer(s.atleta, { time: s.time });
    return `<a class="rank-row" href="#/jogador/${s.atleta.atleta_id}">
      <span class="n">${start + i + 1}</span>${crest(s.time, 22)}
      <div class="who"><div class="nm">${esc(s.atleta.nome_popular)}</div><div class="small muted">${esc(s.time ? s.time.nome_popular : '')}${s.jogos ? ` · ${s.jogos} jogos` : ''}</div></div>
      <span class="v">${s[key]}<small>${unit}</small></span></a>`;
  }).join('');
}

/* ============ Busca ============ */
const $search = document.getElementById('search-input');
const $suggest = document.getElementById('suggest');
let indexReady = null;
function buildIndex() {
  if (indexReady) return indexReady;
  indexReady = api('/campeonatos', 600000).then((comps) => Promise.all(comps.flatMap((c) => [
    soft(api(`/campeonatos/${c.campeonato_id}/tabela`, 60000)).then((t) => flattenTable(t).forEach((g) => g.rows.forEach((r) => regTeam(r.time)))),
    soft(api(`/campeonatos/${c.campeonato_id}/artilharia`, 300000)).then((l) => (l || []).forEach((s) => { regTeam(s.time); regPlayer(s.atleta, { time: s.time }); })),
  ]))).catch(() => { indexReady = null; });
  return indexReady;
}
function searchAll(q, maxPlayers = 50) {
  const nq = norm(q);
  const teams = [...registry.teams.values()].filter((t) => !nq || norm(t.nome_popular).includes(nq) || norm(t.sigla) === nq)
    .sort((a, b) => a.nome_popular.localeCompare(b.nome_popular));
  const players = nq ? [...registry.players.values()].filter((p) => norm(p.nome_popular).includes(nq)).slice(0, maxPlayers) : [];
  return { teams, players };
}
let suggestIdx = -1;
$search.addEventListener('focus', buildIndex);
$search.addEventListener('input', async () => {
  const q = $search.value.trim();
  if (q.length < 2) { $suggest.hidden = true; return; }
  await buildIndex();
  const { teams, players } = searchAll(q, 6);
  suggestIdx = -1;
  $suggest.innerHTML = [...teams.slice(0, 5).map((t) => `<a href="#/time/${t.time_id}">${crest(t, 20)}<span>${esc(t.nome_popular)}</span><span class="kind">Time</span></a>`),
    ...players.map((p) => `<a href="#/jogador/${p.atleta_id}">${p.time ? crest(p.time, 20) : ''}<span>${esc(p.nome_popular)}</span><span class="kind">Jogador</span></a>`)].join('')
    || '<div class="none">Nada encontrado</div>';
  $suggest.hidden = false;
});
$search.addEventListener('keydown', (e) => {
  const links = [...$suggest.querySelectorAll('a')];
  if ($suggest.hidden || !links.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggestIdx = (suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((l, i) => l.classList.toggle('hl', i === suggestIdx));
  } else if (e.key === 'Enter' && suggestIdx >= 0) { e.preventDefault(); location.hash = links[suggestIdx].getAttribute('href'); }
  else if (e.key === 'Escape') $suggest.hidden = true;
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $suggest.hidden = true; });
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault(); $suggest.hidden = true;
  location.hash = '#/busca/' + encodeURIComponent($search.value.trim());
});

/* ============ Router ============ */
let view = { cleanup: null, onLive: null, onOther: null };
let routeToken = 0;
async function router() {
  const token = ++routeToken;
  const [pathPart, query = ''] = (location.hash.slice(1) || '/').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  if (view.cleanup) view.cleanup();
  view = { cleanup: null, onLive: null, onOther: null };
  $suggest.hidden = true;
  if (parts[0] !== 'busca') $search.value = ''; // a busca anterior não fica presa no campo
  const section ={ campeonato: 'campeonatos', partida: 'home', time: '', jogador: '' }[parts[0]] ?? (parts[0] || 'home');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));
  window.scrollTo(0, 0);
  routeMode(parts).catch(() => {}); // F1, NBA e cada campeonato mudam a cara do site
  const ok = () => token === routeToken;
  try {
    switch (parts[0]) {
      case undefined: return await viewHome(ok, params);
      case 'campeonatos': return await viewCompetitions(ok);
      case 'campeonato': return await viewCompetition(+parts[1], parts[2] || 'tabela', params, ok);
      case 'partida': return await viewMatch(+parts[1], parts[2] || 'resumo', ok);
      case 'time': return await viewTeam(+parts[1], parts[2] || 'visao', params, ok);
      case 'jogador': return await viewPlayer(+parts[1], ok);
      case 'favoritos': return await viewFavorites(ok);
      case 'para-voce': return await viewForYou(ok);
      case 'busca': return await viewSearch(decodeURIComponent(parts[1] || ''), ok);
      case 'noticias': return await viewNews(ok, params);
      case 'minijogos': return await viewGames(ok, parts[1]);
      case 'sobre': return viewAbout();
      case 'comparar': return await viewCompare(ok, params);
      case 'entrar': return await viewAuth('entrar', ok, params);
      case 'cadastro': return await viewAuth('cadastro', ok, params);
      case 'esqueci': return await viewForgot(ok);
      case 'redefinir': return await viewReset(ok, params);
      case 'conta': return await viewAccount(ok, params);
      case 'nba':
        if (parts[1] === 'jogo') return await viewNBAGame(+parts[2], ok, params);
        if (parts[1] === 'time') return await viewNBATeam(+parts[2], ok, params);
        if (parts[1] === 'jogador') return await viewNBAPlayer(+parts[2], ok);
        return await viewNBA(ok, params, parts[1] || 'jogos');
      case 'f1':
        if (parts[1] === 'corrida') return await viewF1Race(+parts[2], ok);
        if (parts[1] === 'piloto') return await viewF1Driver(parts[2], ok);
        if (parts[1] === 'equipe') return await viewF1Team(parts[2], ok);
        return await viewF1(ok, params, parts[1] || 'pilotos');
      default: $app.innerHTML = `<div class="card">${empty('Página não encontrada.')}</div>`;
    }
  } catch (e) {
    if (ok()) $app.innerHTML = errorBox(e);
    console.error(e);
  }
}
window.addEventListener('hashchange', router);

/* ============ Laterais ============ */
function compNav(comps, activeId) {
  const link = (c) => `<a href="#/campeonato/${c.campeonato_id}" class="${c.campeonato_id === activeId ? 'active' : ''}">${compLogo(c, 20)}<span>${esc(c.nome_popular || c.nome)}</span></a>`;
  return `<div class="card"><div class="card-title">Campeonatos</div><div class="nav-list">${REGIONS.map(([r, label]) => {
    const list = comps.filter((c) => (c.regiao || 'nacional') === r);
    return list.length ? `<div class="nav-group">${label}</div>${list.map(link).join('')}` : '';
  }).join('')}</div></div>
    ${favNav()}`;
}
function favNav() {
  const favs = Object.values(getFavs());
  if (!favs.length) return '';
  return `<div class="card"><div class="card-title">Seus times</div><div class="nav-list">${favs.map((t) =>
    `<a href="#/time/${t.time_id}">${crest(t, 20)}<span>${esc(t.nome_popular)}</span></a>`).join('')}</div></div>`;
}
async function tableWidget(c, highlight = []) {
  const [t, sc] = await Promise.all([soft(api(`/campeonatos/${c.campeonato_id}/tabela`, 60000)), soft(api(`/campeonatos/${c.campeonato_id}/artilharia`, 300000))]);
  const groups = flattenTable(t || []);
  let html = '';
  if (groups.length && !groups[0].title) {
    html += `<div class="card"><div class="card-title">${compLogo(c)}${esc(c.nome_popular)}<a class="more" href="#/campeonato/${c.campeonato_id}/tabela">Tabela completa</a></div>
      ${standingsTable(groups[0].rows.slice(0, highlight.length ? 20 : 10), c.campeonato_id, { compact: true, highlight })}</div>`;
  }
  if (sc && sc.length) {
    html += `<div class="card"><div class="card-title">Artilheiros<a class="more" href="#/campeonato/${c.campeonato_id}/artilharia">Ver todos</a></div>${rankRows(sc.slice(0, 5), 'gols', ' gols')}</div>`;
  }
  return html;
}

/* ============ Notícias (GET /noticias) ============ */
function timeAgo(iso) {
  const d = iso ? new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
  if (!d) return '';
  const min = Math.round((Date.now() - d) / 6e4);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}
// A documentação pede citar a fonte e levar o leitor à matéria original
async function newsCard(params, title = 'Notícias', n = 5) {
  const qs = new URLSearchParams({ por_pagina: String(n), ...params }).toString();
  const data = await soft(api(`/noticias?${qs}`, 600000));
  const list = (data && data.noticias) || [];
  if (!list.length) return '';
  return `<div class="card"><div class="card-title">${esc(title)}</div>${list.map((x) => `
    <a class="news" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">
      ${x.imagem ? `<img src="${esc(x.imagem)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div><div class="tt">${esc(x.titulo)}</div><div class="src">${esc(x.provedor ? x.provedor.nome : '')} · ${esc(timeAgo(x.publicado_em))}</div></div>
    </a>`).join('')}</div>`;
}

/* ============ Jogos (início) ============ */
async function loadAgenda(comps) {
  const jobs = comps.map(async (c) => {
    try {
      if (isLeague(c) && c.rodada_atual) {
        const rounds = roundsList(await soft(api(`/campeonatos/${c.campeonato_id}/rodadas`, 600000)));
        const nums = rounds.map((r) => r.rodada);
        const i = nums.indexOf(c.rodada_atual.rodada);
        const want = i >= 0 ? nums.slice(Math.max(0, i - 1), i + 2) : [c.rodada_atual.rodada];
        const rs = await Promise.all(want.map((n) => soft(api(`/campeonatos/${c.campeonato_id}/rodadas/${n}`, 60000))));
        return rs.filter(Boolean).flatMap((r) => r.partidas || []);
      }
      if (c.fase_atual) {
        const ids = [c.fase_atual.fase_id];
        const detail = await soft(api(`/campeonatos/${c.campeonato_id}`, 600000));
        const fases = (detail && detail.fases) || [];
        const i = fases.findIndex((f) => f.fase_id === c.fase_atual.fase_id);
        if (i >= 0 && fases[i + 1]) ids.push(fases[i + 1].fase_id);
        if (i > 0) ids.push(fases[i - 1].fase_id);
        const fs = await Promise.all(ids.map((id) => soft(api(`/campeonatos/${c.campeonato_id}/fases/${id}`, 120000))));
        return fs.filter(Boolean).flatMap(faseMatches);
      }
    } catch { /* campeonato indisponível */ }
    return [];
  });
  const seen = new Set();
  return (await Promise.all(jobs)).flat().filter((p) => !seen.has(p.partida_id) && seen.add(p.partida_id));
}

/* ============ Vitrine "Em destaque" (início) ============ */
// ao vivo primeiro; depois jogos das próximas 36 h e encerrados há menos de 18 h,
// ordenados pela importância do campeonato e pelo gosto da pessoa
function featuredMatches(live, agenda, comps) {
  const now = Date.now();
  const liveIds = new Set(live.map((p) => p.partida_id));
  const rank = (p) => {
    const id = p.campeonato ? p.campeonato.campeonato_id : 0;
    const i = comps.findIndex((c) => c.campeonato_id === id);
    return compRank(id, i < 0 ? 30 : i) - Math.min(matchAffinity(p).s, 40);
  };
  const soon = agenda.filter((p) => {
    if (liveIds.has(p.partida_id) || isLive(p)) return false;
    const d = parseDate(p); if (!d) return false;
    const h = (d - now) / 36e5;
    return (p.status === 'finalizado' && h > -18 && h < 0) || (p.status !== 'finalizado' && h >= -1 && h < 36);
  });
  const up = soon.filter((p) => p.status !== 'finalizado').sort((a, b) => rank(a) - rank(b) || parseDate(a) - parseDate(b));
  const done = soon.filter((p) => p.status === 'finalizado').sort((a, b) => rank(a) - rank(b));
  return [...[...live].sort((a, b) => rank(a) - rank(b)), ...up, ...done].slice(0, 10);
}
function heroCard(p, comps, why = '') {
  regMatch(p);
  const H = p.time_mandante, A = p.time_visitante, live = isLive(p), w = winnerSide(p);
  const [ch, ca] = barColors(H, A);
  const c = comps.find((x) => p.campeonato && x.campeonato_id === p.campeonato.campeonato_id) || p.campeonato || {};
  const d = parseDate(p);
  const delta = d ? Math.round((new Date(dayKey(d) + 'T12:00:00') - new Date(dayKey(new Date()) + 'T12:00:00')) / 864e5) : 0;
  const when = delta === 0 ? 'Hoje' : delta === 1 ? 'Amanhã' : delta === -1 ? 'Ontem' : fmtShort(d);
  const st = live ? `<span class="live-dot"></span>${esc(liveLabel(p))}` : p.status === 'finalizado' ? 'Encerrado' : STATUS_NAME[p.status] || `${when} · ${esc(fmtTime(p))}`;
  const showScore = live || p.status === 'finalizado';
  const row = (t, g, side) => `<div class="hc-row ${w && w !== side ? 'lose' : ''}">${crest(t, 34)}<b>${esc(t.nome_popular)}</b><span class="hc-sc">${showScore ? (g ?? 0) : ''}</span></div>`;
  const pr = p.probabilidades && p.probabilidades.pre;
  const foot = pr && !showScore && pr.casa != null
    ? `<div class="hc-foot"><span>${Math.round(pr.casa)}%</span><span class="hc-bar"><i style="width:${pr.casa}%;background:${ch}"></i><i style="width:${pr.empate}%;background:var(--draw)"></i><i style="width:${pr.fora}%;background:${ca}"></i></span><span>${Math.round(pr.fora)}%</span></div>` : '';
  return `<a class="hc ${live ? 'is-live' : ''}" href="#/partida/${p.partida_id}" style="--hc:${ch};--ac:${ca}">
    <div class="hc-top">${compLogo(c, 16)}<span class="cn">${esc(c.nome_popular || c.nome || '')}</span><span class="hc-st">${st}</span></div>
    ${row(H, p.placar_mandante, 'h')}${row(A, p.placar_visitante, 'a')}${foot}${why ? `<div class="hc-why">✦ ${esc(why)}</div>` : ''}</a>`;
}
function heroStrip(list, comps) {
  if (!list.length) return '';
  const nLive = list.filter(isLive).length;
  return `<section class="hero-strip"><div class="hs-head"><h2>Em destaque</h2><span>${nLive ? `${nLive} ao vivo agora` : 'Os jogos que importam hoje'}</span>
    <div class="hs-nav"><button data-hs="-1" aria-label="Anteriores">${I.left}</button><button data-hs="1" aria-label="Próximos">${I.right}</button></div></div>
    <div class="hs-track" id="hs-track">${list.map((p) => heroCard(p, comps)).join('')}</div></section>`;
}

async function viewHome(ok, params) {
  $app.innerHTML = `<div class="cols"><div class="side side-left">${skel(260)}</div><div class="stack">${skel(48)}${skel(320)}</div><div class="side">${skel(420)}</div></div>`;
  const comps = await api('/campeonatos', 600000);
  const [live, agenda] = await Promise.all([pollLive().then((l) => l || []), loadAgenda(comps)]);
  if (!ok()) return;
  const league = comps.find(isLeague) || comps[0];
  const [table, news] = await Promise.all([league ? tableWidget(league) : '', newsCard({}, 'Últimas notícias')]);
  const right = table + news;
  if (!ok()) return;

  const byDay = new Map();
  agenda.forEach((p) => { const k = dayKey(parseDate(p)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); });
  const today = dayKey(new Date());
  const days = [...new Set([...byDay.keys(), today])].filter((k) => k !== 'tbd').sort();
  let selected = params.get('d') && days.includes(params.get('d')) ? params.get('d') : today;
  let filter = params.get('f') === 'live' ? 'live' : 'all';
  let lastLive = live;
  const compOrder = (id) => { const i = comps.findIndex((c) => c.campeonato_id === id); return compRank(id, i < 0 ? 99 : i); };
  let others = '', hsScroll = 0;
  loadAiDay(ok); // "Seu dia no futebol" (IA): aparece quando ficar pronto
  otherSportsCard().then((h) => { others = h; const el = document.getElementById('other-sports'); if (el && ok()) el.innerHTML = h; }).catch(() => {});

  const render = () => {
    const liveMap = new Map(lastLive.map((p) => [p.partida_id, p]));
    const list = filter === 'live' ? lastLive : (byDay.get(selected) || []).map((p) => liveMap.get(p.partida_id) || p);
    const groups = new Map();
    [...list].sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0)).forEach((p) => {
      const id = p.campeonato ? p.campeonato.campeonato_id : 0;
      if (!groups.has(id)) groups.set(id, { c: comps.find((c) => c.campeonato_id === id) || p.campeonato || {}, ps: [] });
      groups.get(id).ps.push(p);
    });
    const blocks = [...groups.entries()].sort((a, b) => compOrder(a[0]) - compOrder(b[0])).map(([, { c, ps }]) => `
      <a class="league-head" href="#/campeonato/${c.campeonato_id}">${compLogo(c)}<span>${esc(c.nome_popular || c.nome || '')}</span><span class="muted">${esc(regionLabel(c))}</span><span class="go">${I.chev}</span></a>
      ${ps.map((p) => matchRow(p)).join('')}`).join('');
    const dayBtn = (k) => {
      const d = new Date(k + 'T12:00:00');
      const delta = Math.round((d - new Date(today + 'T12:00:00')) / 864e5);
      const w = delta === 0 ? 'Hoje' : delta === -1 ? 'Ontem' : delta === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      return `<a class="day ${k === selected && filter === 'all' ? 'active' : ''} ${k === today ? 'today' : ''} ${byDay.has(k) ? '' : 'empty-day'}" data-day="${k}">
        <div class="w">${esc(w)}</div><div class="d">${d.getDate()} ${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div></a>`;
    };
    const liveMapAll = new Map(lastLive.map((p) => [p.partida_id, p]));
    const fy = Taste.empty() ? forYouCard([]) : ''; // o "Para você" completo tem página própria
    $app.innerHTML = `<div class="cols">
      <aside class="side side-left">${compNav(comps)}</aside>
      <div class="stack">${sportBar('futebol')}${heroStrip(featuredMatches(lastLive, agenda.map((p) => liveMapAll.get(p.partida_id) || p), comps), comps)}<div id="ai-day">${aiDayHtml}</div>${fy}<div class="card">
        <div class="daybar"><button class="arrow" data-scroll="-1" aria-label="Dias anteriores">${I.left}</button><div class="days" id="days">${days.map(dayBtn).join('')}</div><button class="arrow" data-scroll="1" aria-label="Próximos dias">${I.right}</button></div>
        <div class="filters"><button class="pill ${filter === 'all' ? 'active' : ''}" data-f="all">Todos</button><button class="pill ${filter === 'live' ? 'active' : ''}" data-f="live"><span class="live-dot"></span>Ao vivo (${lastLive.length})</button></div>
        ${blocks || empty(filter === 'live' ? 'Nenhum jogo em andamento agora.' : 'Nenhum jogo neste dia.')}
      </div></div>
      <aside class="side"><div id="other-sports">${others}</div>${right}</aside>
    </div>`;
    const $hs = document.getElementById('hs-track');
    if ($hs) { $hs.scrollLeft = hsScroll; $hs.addEventListener('scroll', () => { hsScroll = $hs.scrollLeft; }, { passive: true }); }
    $app.querySelectorAll('[data-hs]').forEach((b) => b.addEventListener('click', () => $hs.scrollBy({ left: +b.dataset.hs * $hs.clientWidth * 0.8, behavior: 'smooth' })));
    const $days = document.getElementById('days');
    const act = $days.querySelector('.active') || $days.querySelector('.today');
    if (act) $days.scrollLeft += act.getBoundingClientRect().left - $days.getBoundingClientRect().left - ($days.clientWidth - act.offsetWidth) / 2;
    $days.querySelectorAll('[data-day]').forEach((a) => a.addEventListener('click', () => {
      selected = a.dataset.day; filter = 'all'; history.replaceState(null, '', `#/?d=${selected}`); render();
    }));
    $app.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => { $days.scrollBy({ left: +b.dataset.scroll * $days.offsetWidth * 0.7, behavior: 'smooth' }); }));
    $app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.f; history.replaceState(null, '', filter === 'live' ? '#/?f=live' : `#/?d=${selected}`); render();
    }));
  };
  render();
  // só redesenha se algum placar/minuto ao vivo mudou (evita recarregar escudos e perder a rolagem)
  const sig = (l) => l.map((p) => `${p.partida_id}:${p.placar_mandante}-${p.placar_visitante}:${p.cronometro_label || p.cronometro}:${p.periodo}`).join('|');
  view.onLive = (l) => { if (ok() && sig(l) !== sig(lastLive)) { lastLive = l; render(); } };
  view.onOther = () => { // NBA/F1 mudou: atualiza só o card lateral
    memo.delete('/esportes/nba/jogos');
    otherSportsCard().then((h) => { others = h; const el = document.getElementById('other-sports'); if (el && ok()) el.innerHTML = h; }).catch(() => {});
  };
}

/* ============ Campeonatos ============ */
async function viewCompetitions(ok) {
  $app.innerHTML = skel(400);
  const comps = await api('/campeonatos', 600000);
  if (!ok()) return;
  $app.innerHTML = `<div class="cols-2"><div class="stack">${REGIONS.map(([r, label]) => {
    const list = comps.filter((c) => (c.regiao || 'nacional') === r);
    return list.length ? `<div class="card"><div class="card-title">${label}</div>
    ${list.map((c) => `<a class="list-row" href="#/campeonato/${c.campeonato_id}">${compLogo(c, 32)}<div><div style="font-weight:600">${esc(c.nome_popular || c.nome)}</div><div class="small muted">${esc(c.edicao_atual ? c.edicao_atual.nome : c.nome)}</div></div>
      <div class="right">${esc(c.fase_atual && !isLeague(c) ? c.fase_atual.nome : progressText(c))}<br><span class="faint">${c.status === 'andamento' ? 'Em andamento' : esc(titleize(c.status))}</span></div></a>`).join('')}</div>` : '';
  }).join('')}
    <div class="card"><div class="card-title">Outros esportes</div>
      <a class="list-row" href="#/nba"><span class="sport-ico">${SPORT_ICON.nba}</span><div><div style="font-weight:600">NBA</div><div class="small muted">Jogos ao vivo, box score, classificação</div></div><div class="right">Basquete</div></a>
      <a class="list-row" href="#/f1"><span class="sport-ico">${SPORT_ICON.f1}</span><div><div style="font-weight:600">Fórmula 1</div><div class="small muted">Calendário, sessão ao vivo, pilotos e construtores</div></div><div class="right">Automobilismo</div></a></div>
  </div><aside class="side">${favNav()}</aside></div>`;
}

async function viewCompetition(id, tab, params, ok) {
  $app.innerHTML = `<div class="stack">${skel(130)}${skel(500)}</div>`;
  const [camp, fasesList] = await Promise.all([api(`/campeonatos/${id}`, 600000), soft(api(`/campeonatos/${id}/fases`, 600000))]);
  if (!ok()) return;
  if (Array.isArray(fasesList) && fasesList.length) camp.fases = fasesList; // GET /campeonatos/{id}/fases
  if (tab === 'tabela') Taste.bump('c', id, 2, { n: camp.nome_popular || camp.nome });
  const league = isLeague(camp);
  const knockout = (camp.fases || []).filter((f) => f.tipo === 'mata-mata');
  const tabs = [['tabela', 'Classificação'], ['jogos', 'Jogos']];
  const hasChances = league && id !== 106; // a Champions tem fase de liga + mata-mata: o modelo não se aplica
  if (hasChances) tabs.push(['chances', 'Chances'], ['simulador', 'Simulador']);
  if (knockout.length) tabs.push(['chaveamento', 'Chaveamento']);
  tabs.push(['artilharia', 'Artilharia'], ['assistencias', 'Assistências'], ['estatisticas', 'Estatísticas']);
  const lgDark = camp.logo_escuro || camp.logo;
  const head = `<div class="card comp-card">
    <div class="page-head comp-head">${lgDark ? `<img class="ph-wm" src="${esc(lgDark)}" alt="" aria-hidden="true">` : ''}
      <div class="ph-logo">${lgDark ? `<img src="${esc(lgDark)}" alt="" onerror="this.style.visibility='hidden'">` : ''}</div>
      <div><div class="eyebrow">${esc(regionLabel(camp) || 'Campeonato')}</div><h1>${esc(camp.nome_popular || camp.nome)}</h1><div class="sub">${esc(camp.edicao_atual ? camp.edicao_atual.nome : camp.nome)}</div>
      <div class="facts">${camp.status === 'andamento' ? '<span>Em andamento</span>' : `<span>${esc(titleize(camp.status))}</span>`}${!league && camp.fase_atual ? `<span>Fase atual: <b>${esc(camp.fase_atual.nome)}</b></span>` : ''}${progressText(camp) ? `<span>${esc(progressText(camp))}</span>` : ''}</div></div>
    </div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/campeonato/${id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
  </div>`;
  $app.innerHTML = `<div class="stack">${head}<div class="cols-2"><div id="tab">${skel(500)}</div><aside class="side" id="aside"></aside></div></div>`;
  const $tab = document.getElementById('tab'), $aside = document.getElementById('aside');
  const news = () => newsCard({ campeonato_id: id }, `Notícias · ${camp.nome_popular || camp.nome}`);
  const sideScorers = async () => {
    const [sc, nw] = await Promise.all([soft(api(`/campeonatos/${id}/artilharia`, 300000)), news()]);
    if (ok()) $aside.innerHTML = (sc && sc.length ? `<div class="card"><div class="card-title">Artilheiros<a class="more" href="#/campeonato/${id}/artilharia">Ver todos</a></div>${rankRows(sc.slice(0, 5), 'gols', ' gols')}</div>` : '') + nw;
  };
  const sideTable = async () => {
    const [t, nw] = await Promise.all([soft(api(`/campeonatos/${id}/tabela`, 60000)), news()]);
    const g = flattenTable(t || []);
    if (ok()) $aside.innerHTML = (g.length && !g[0].title ? `<div class="card"><div class="card-title">Classificação<a class="more" href="#/campeonato/${id}/tabela">Completa</a></div>${standingsTable(g[0].rows.slice(0, 10), id, { compact: true })}</div>` : '') + nw;
  };

  if (tab === 'tabela') {
    const t = await api(`/campeonatos/${id}/tabela`, 60000);
    if (!ok()) return;
    const groups = flattenTable(t);
    $tab.innerHTML = groups.length
      ? `<div class="card">${groups.map((g) => `${g.title ? `<div class="group-name">${esc(g.title)}</div>` : ''}${standingsTable(g.rows, id)}`).join('')}</div>`
      : `<div class="card">${empty(`Sem tabela de pontos nesta fase. Veja o <a href="#/campeonato/${id}/chaveamento" style="color:var(--brand)">chaveamento</a>.`)}</div>`;
    if (groups.length === 1 && !groups[0].title) attachLiveTable($tab, groups[0].rows, id, ok);
    sideScorers();
  } else if (tab === 'chances' && hasChances) {
    await chancesTab(camp, $tab, ok);
    sideScorers();
  } else if (tab === 'simulador' && hasChances) {
    $aside.remove(); // o simulador usa a largura toda (tabela simulada ao lado dos jogos)
    await simulatorTab(camp, $tab, ok);
  } else if (tab === 'artilharia' || tab === 'assistencias') {
    const key = tab === 'artilharia' ? 'gols' : 'assistencias';
    const list = await soft(api(`/campeonatos/${id}/${tab}`, 300000));
    if (!ok()) return;
    $tab.innerHTML = `<div class="card"><div class="card-title">${tab === 'artilharia' ? 'Gols' : 'Assistências'}</div>${list && list.length ? rankRows(list.slice(0, 50), key, '') : empty('Dados ainda não disponíveis para este campeonato.')}</div>`;
    sideTable();
  } else if (tab === 'chaveamento') {
    await renderBracket(camp, knockout, $tab, ok);
    sideScorers();
  } else if (tab === 'estatisticas') {
    await compStats(camp, $tab, ok);
    sideScorers();
  } else if (league) {
    await renderRounds(camp, $tab, +params.get('r') || (camp.rodada_atual && camp.rodada_atual.rodada) || 1, ok);
    sideTable();
  } else {
    await renderPhases(camp, $tab, +params.get('f') || (camp.fase_atual && camp.fase_atual.fase_id), ok);
    sideScorers();
  }
}

async function renderRounds(camp, $tab, n, ok) {
  const id = camp.campeonato_id;
  const [roundsRaw, round] = await Promise.all([api(`/campeonatos/${id}/rodadas`, 600000), api(`/campeonatos/${id}/rodadas/${n}`, 60000)]);
  if (!ok()) return;
  const rounds = roundsList(roundsRaw);
  const go = (r) => `#/campeonato/${id}/jogos?r=${r}`;
  const prev = round.rodada_anterior ? round.rodada_anterior.rodada : null, next = round.proxima_rodada ? round.proxima_rodada.rodada : null;
  $tab.innerHTML = `<div class="card">
    <div class="roundbar">
      <a class="arrow" href="${prev ? go(prev) : '#'}" ${prev ? '' : 'aria-disabled="true" style="opacity:.3;pointer-events:none"'} aria-label="Anterior">${I.left}</a>
      <select id="round-sel" aria-label="${byWeek(camp) ? 'Semana' : 'Rodada'}">${rounds.map((r) => `<option value="${r.rodada}" ${r.rodada === n ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}</select>
      <a class="arrow" href="${next ? go(next) : '#'}" ${next ? '' : 'aria-disabled="true" style="opacity:.3;pointer-events:none"'} aria-label="Próxima">${I.right}</a>
    </div>
    ${(round.partidas || []).length ? matchesByDate(round.partidas) : empty('Sem jogos.')}</div>`;
  document.getElementById('round-sel').addEventListener('change', (e) => { location.hash = go(e.target.value); });
  view.onLive = (live) => { if (ok() && live.some((p) => (round.partidas || []).some((q) => q.partida_id === p.partida_id))) router(); };
}

async function renderPhases(camp, $tab, faseId, ok) {
  const fases = camp.fases || [];
  if (!faseId && fases.length) faseId = fases[fases.length - 1].fase_id;
  const fase = await api(`/campeonatos/${camp.campeonato_id}/fases/${faseId}`, 120000);
  if (!ok()) return;
  const ms = faseMatches(fase);
  $tab.innerHTML = `<div class="card">
    <div class="pills" id="phase-pills">${fases.map((f) => `<a class="pill ${f.fase_id === faseId ? 'active' : ''}" href="#/campeonato/${camp.campeonato_id}/jogos?f=${f.fase_id}">${esc(f.nome)}</a>`).join('')}</div>
    ${ms.length ? matchesByDate(ms, { showDate: false }) : empty('Os jogos desta fase ainda não foram definidos.')}</div>`;
  const a = document.querySelector('#phase-pills .active');
  if (a) a.parentElement.scrollLeft = a.offsetLeft - 16;
}

async function renderBracket(camp, knockout, $tab, ok) {
  const fases = await Promise.all(knockout.map((f) => soft(api(`/campeonatos/${camp.campeonato_id}/fases/${f.fase_id}`, 120000))));
  if (!ok()) return;
  const valid = fases.filter((f) => f && (f.chaves || []).length);
  let start = valid.findIndex((f) => f.chaves.length <= 8);
  if (start < 0) start = Math.max(0, valid.length - 4);
  const cols = valid.slice(start);
  if (!cols.length) { $tab.innerHTML = `<div class="card">${empty('Chaveamento ainda não definido.')}</div>`; return; }
  const tie = (c) => {
    const r = tieResult(c);
    if (!r) return '';
    const row = (t, g, pen) => {
      const adv = r.winner && +r.winner.time_id === +t.time_id, out = r.winner && !adv;
      return `<div class="tie-row ${adv ? 'adv' : ''} ${out ? 'out' : ''}">${crest(t, 18)}<a href="#/time/${t.time_id}?c=${camp.campeonato_id}">${esc(t.nome_popular)}</a><span class="g">${r.played ? g : ''}${pen != null ? ` <span class="faint">(${pen})</span>` : ''}</span></div>`;
    };
    return `<div class="tie">${row(r.A, r.a, r.penA)}${row(r.B, r.b, r.penB)}
      <div class="tie-legs">${r.legs.map((p, i) => `<a href="#/partida/${p.partida_id}">${r.legs.length > 1 ? (i ? 'Volta' : 'Ida') : 'Jogo'} ${p.placar_mandante == null ? fmtShort(parseDate(p)) : `${p.placar_mandante}-${p.placar_visitante}`}</a>`).join('')}</div></div>`;
  };
  $tab.innerHTML = `<div class="card"><div class="bracket">${cols.map((f) => `<div class="bracket-col"><h3>${esc(f.nome)}</h3><div class="ties">${f.chaves.map(tie).join('')}</div></div>`).join('')}</div>
    ${start > 0 ? `<div class="legend">Fases anteriores na aba <a href="#/campeonato/${camp.campeonato_id}/jogos" style="color:var(--brand)">Jogos</a>.</div>` : ''}</div>`;
}

async function compStats(camp, $tab, ok) {
  const id = camp.campeonato_id;
  const t = await soft(api(`/campeonatos/${id}/tabela`, 60000));
  if (!ok()) return;
  const rows = flattenTable(t || []).flatMap((g) => g.rows);
  if (!rows.length) { $tab.innerHTML = `<div class="card">${empty('Estatísticas disponíveis quando houver classificação.')}</div>`; return; }
  const goals = rows.reduce((a, r) => a + r.gols_pro, 0), games = rows.reduce((a, r) => a + r.jogos, 0) / 2;
  const draws = rows.reduce((a, r) => a + r.empates, 0) / 2;
  const list = (title, sorted, val) => `<div class="card"><div class="card-title">${title}</div>${sorted.slice(0, 5).map((r, i) => `
    <a class="rank-row" href="#/time/${r.time.time_id}?c=${id}"><span class="n">${i + 1}</span>${crest(r.time, 22)}<div class="who"><div class="nm">${esc(r.time.nome_popular)}</div></div><span class="v">${val(r)}</span></a>`).join('')}</div>`;
  const by = (f, asc = false) => [...rows].sort((a, b) => (asc ? f(a) - f(b) : f(b) - f(a)));
  $tab.innerHTML = `<div class="stack">
    <div class="card"><div class="kv"><div><b>${goals}</b><span>Gols</span></div><div><b>${games ? (goals / games).toFixed(2) : '–'}</b><span>Gols por jogo</span></div><div><b>${Math.round(games)}</b><span>Jogos</span></div><div><b>${games ? Math.round((draws / games) * 100) : 0}%</b><span>Empates</span></div></div></div>
    <div class="grid-2" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      ${list('Melhor ataque', by((r) => r.gols_pro), (r) => r.gols_pro)}
      ${list('Melhor defesa', by((r) => r.gols_contra, true), (r) => r.gols_contra)}
      ${list('Mais vitórias', by((r) => r.vitorias), (r) => r.vitorias)}
      ${list('Aproveitamento', by((r) => r.aproveitamento), (r) => r.aproveitamento + '%')}
    </div></div>`;
}

/* ============ Partida ============ */
async function viewMatch(id, tab, ok) {
  $app.innerHTML = `<div class="stack">${skel(220)}${skel(400)}</div>`;
  const load = async (force) => {
    const p = await (force ? fresh(`/partidas/${id}`) : api(`/partidas/${id}`, 15000));
    if (!ok()) return null;
    regMatch(p); checkGoals([p]);
    return p;
  };
  const comps = await soft(api('/campeonatos', 600000)) || [];
  let p = await load();
  if (!p) return;
  tasteMatch(p, 1);
  const camp = comps.find((c) => p.campeonato && c.campeonato_id === p.campeonato.campeonato_id) || p.campeonato || {};
  if (ok()) Modes.comp(camp, { intro: false }); // a partida veste as cores do campeonato
  let tableHtml = null, tableRows = null;

  const paint = async () => {
    const live = isLive(p), pen = penScore(p), d = parseDate(p);
    const H = p.time_mandante, A = p.time_visitante;
    const scorers = (side) => ((p.gols || {})[side] || []).slice().sort((x, y) => evMinute(x).key - evMinute(y).key)
      .map((g) => `<div><span class="g">${side === 'visitante' ? I.ball : ''}${g.atleta ? `<a href="#/jogador/${g.atleta.atleta_id}">${esc(g.atleta.nome_popular)}</a>` : '—'} ${esc(evMinute(g).label)}${g.penalti ? ' (pên.)' : ''}${g.gol_contra ? ' (contra)' : ''}${side === 'mandante' ? I.ball : ''}</span></div>`).join('');
    let center;
    if (live) center = `<div class="mh-score">${p.placar_mandante ?? 0} - ${p.placar_visitante ?? 0}</div><div class="mh-status live"><span class="live-dot"></span>${liveTag(p)}</div>`;
    else if (p.status === 'finalizado') center = `<div class="mh-score">${p.placar_mandante} - ${p.placar_visitante}</div>${pen ? `<div class="mh-pen">Pênaltis ${pen[0]} - ${pen[1]}</div>` : ''}<div class="mh-status">Encerrado</div>`;
    else center = `<div class="mh-score time">${esc(fmtTime(p))}</div><div class="mh-status">${esc(p.status === 'agendado' ? (d ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }) : '') : titleize(p.status))}</div>`;
    const sub = [p.fase && !isLeague(camp) ? p.fase.nome : null, p.rodada || null, p.grupo || null].filter(Boolean).join(' · ');
    const hasGoals = p.gols && ((p.gols.mandante || []).length + (p.gols.visitante || []).length);
    // a football-data (plano gratuito) não traz escalações nem estatísticas: só mostra o que existe
    // jogos europeus: a football-data não traz escalações; a ponte com a ESPN traz quando existe o jogo lá
    const onlyFd = p.fonte === 'football-data';
    const tabs = [['resumo', 'Resumo']];
    if (!onlyFd || p.escalacoes) tabs.push(['escalacoes', 'Escalações']);
    if (!onlyFd || p.estatisticas) tabs.push(['estatisticas', 'Estatísticas']);
    if (isLeague(camp)) tabs.push(['tabela', 'Tabela']);

    const [mhc, mac] = barColors(H, A);
    $app.innerHTML = `<div class="cols-2"><div class="stack">
      <div class="card" data-match="${p.partida_id}">
        <div class="mh" style="--hc:${mhc};--ac:${mac}">
          <div class="mh-comp">${compLogo(camp, 16)}<a href="#/campeonato/${camp.campeonato_id}">${esc(camp.nome_popular || camp.nome || '')}</a>${sub ? `<span>· ${esc(sub)}</span>` : ''}</div>
          <div class="mh-grid">
            <a class="mh-team" href="#/time/${H.time_id}?c=${camp.campeonato_id || ''}">${crest(H, 64)}<span>${esc(H.nome_popular)}</span></a>
            <div class="mh-center">${center}</div>
            <a class="mh-team" href="#/time/${A.time_id}?c=${camp.campeonato_id || ''}">${crest(A, 64)}<span>${esc(A.nome_popular)}</span></a>
          </div>
          ${hasGoals ? `<div class="mh-scorers"><div>${scorers('mandante')}</div><div>${scorers('visitante')}</div></div>` : ''}
          <div class="mh-info">${d ? `<span>${esc(fmtDay(d))}, ${esc(fmtTime(p))}</span>` : ''}${p.estadio ? `<span>${esc(p.estadio.nome_popular)}</span>` : ''}</div>
        </div>
        <nav class="tabs">${tabs.map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
      </div>
      <div id="mtab"></div>
    </div><aside class="side" id="maside"></aside></div>`;
    $app.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', () => {
      tab = a.dataset.tab; history.replaceState(null, '', `#/partida/${id}/${tab}`); paint();
    }));
    const $t = document.getElementById('mtab');
    if (tab === 'escalacoes') $t.innerHTML = matchLineups(p);
    else if (tab === 'estatisticas') $t.innerHTML = matchStats(p);
    else if (tab === 'tabela') {
      const t = await soft(api(`/campeonatos/${camp.campeonato_id}/tabela`, 60000));
      const g = flattenTable(t || []);
      $t.innerHTML = g.length ? `<div class="card">${standingsTable(g[0].rows, camp.campeonato_id, { highlight: [+H.time_id, +A.time_id] })}</div>` : `<div class="card">${empty('Sem tabela.')}</div>`;
    } else { $t.innerHTML = matchSummary(p, tableRows); loadAiInsight(p, ok); }

    // lateral: tabela com os dois times destacados
    if (tableHtml === null && isLeague(camp)) {
      const t = await soft(api(`/campeonatos/${camp.campeonato_id}/tabela`, 60000));
      const g = flattenTable(t || []);
      if (g.length === 1 && !g[0].title) {
        tableRows = g[0].rows;
        if (tab === 'resumo' && ok()) { $t.innerHTML = matchSummary(p, tableRows); loadAiInsight(p, ok); } // acrescenta o card de pré-jogo
      }
      tableHtml = g.length && !g[0].title ? `<div class="card"><div class="card-title">Classificação<a class="more" href="#/campeonato/${camp.campeonato_id}/tabela">Completa</a></div>${standingsTable(g[0].rows, camp.campeonato_id, { compact: true, highlight: [+H.time_id, +A.time_id] })}</div>` : '';
    }
    const $s = document.getElementById('maside');
    if ($s) $s.innerHTML = tableHtml || '';
  };
  await paint();
  if (isLive(p)) {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try { const n = await load(true); if (n) { p = n; const y = scrollY; await paint(); scrollTo(0, y); } } catch { /* mantém o último */ }
    }, MATCH_POLL_MS);
    view.cleanup = () => clearInterval(t);
    // gol ou mudança de período pela transmissão ao vivo: atualiza na hora, sem esperar o próximo ciclo
    const sig = (x) => x && `${x.placar_mandante}-${x.placar_visitante}-${x.periodo}-${x.status}`;
    view.onLive = async (l) => {
      const m = l.find((x) => x.partida_id === p.partida_id);
      if (!ok() || (m && sig(m) === sig(p))) return;
      try { const n = await load(true); if (n) { p = n; const y = scrollY; await paint(); scrollTo(0, y); } } catch { /* mantém o último */ }
    };
  }
}

function matchSummary(p, tableRows = null) {
  const ev = [];
  const add = (side, list, type) => (list || []).forEach((e) => ev.push({ side, type, e, m: evMinute(e), slug: e.periodo_slug }));
  ['mandante', 'visitante'].forEach((s) => {
    add(s, (p.gols || {})[s], 'gol');
    add(s, ((p.cartoes || {}).amarelo || {})[s], 'amarelo');
    add(s, ((p.cartoes || {}).vermelho || {})[s], 'vermelho');
    add(s, (p.substituicoes || {})[s], 'sub');
  });
  let html = '';
  if (ev.length) {
    ev.sort((a, b) => a.m.key - b.m.key);
    let h = 0, a = 0;
    ev.forEach((x) => { if (x.type === 'gol') { if (x.side === 'mandante') h++; else a++; x.score = `${h} - ${a}`; } });
    ev.reverse();
    const nm = (at) => at ? `<a href="#/jogador/${at.atleta_id}">${esc(at.nome_popular)}</a>` : '<span class="muted">Comissão técnica</span>';
    const content = ({ type, e, score }) => {
      if (type === 'gol') return [`<span class="ev-ico goal">${I.ball}</span>`, `<div>${nm(e.atleta)} <span class="ev-score">${score}</span>${e.penalti || e.gol_contra ? `<div class="sub2">${e.penalti ? 'Pênalti' : 'Gol contra'}</div>` : ''}</div>`];
      if (type === 'amarelo' || type === 'vermelho') return [`<span class="ev-ico">${cardIcon(type === 'amarelo' ? 'y' : 'r')}</span>`, `<div>${nm(e.atleta)}</div>`];
      return [`<span class="ev-ico in">${I.in}</span>`, `<div>${nm(e.entrou)}<div class="sub2">sai ${e.saiu ? esc(e.saiu.nome_popular) : ''}</div></div>`];
    };
    let lastSlug = null;
    const PN = { 'primeiro-tempo': '1º tempo', 'segundo-tempo': '2º tempo', 'primeiro-tempo-prorrogacao': 'Prorrogação', 'segundo-tempo-prorrogacao': 'Prorrogação', intervalo: 'Intervalo' };
    ev.forEach((x) => {
      if (x.slug !== lastSlug && PN[x.slug] !== PN[lastSlug]) { html += `<div class="period-sep">${esc(PN[x.slug] || '')}</div>`; }
      lastSlug = x.slug;
      const [ico, txt] = content(x);
      html += `<div class="ev-row"><div class="ev-side h">${x.side === 'mandante' ? txt + ico : ''}</div><div class="min">${esc(x.m.label)}</div><div class="ev-side">${x.side === 'visitante' ? ico + txt : ''}</div></div>`;
    });
  }
  const pen = p.disputa_penalti && typeof p.disputa_penalti === 'object' ? p.disputa_penalti : null;
  if (pen && (pen.cobrancas || []).length) {
    const side = (tid) => pen.cobrancas.filter((c) => c.time && +c.time.time_id === +tid);
    const okS = (s) => !/perd|err|defend/.test(String(s));
    const col = (l) => l.map((c) => `<div style="padding:3px 0;color:${okS(c.status) ? 'var(--text)' : 'var(--loss)'}">${okS(c.status) ? '✓' : '✗'} ${esc((c.atleta || {}).nome_popular || '')}</div>`).join('');
    html = `<div class="period-sep">Pênaltis ${pen.placar_penalti_mandante} - ${pen.placar_penalti_visitante}</div>
      <div class="ev-row" style="align-items:start"><div class="ev-side h" style="display:block">${col(side(p.time_mandante.time_id))}</div><div></div><div class="ev-side" style="display:block">${col(side(p.time_visitante.time_id))}</div></div>` + html;
  }
  const events = `<div class="card"><div class="card-title">Lances</div>${html || empty(p.status === 'agendado' ? 'A partida ainda não começou. Os lances aparecem aqui em tempo real.' : 'Nenhum lance registrado.')}</div>`;
  const s = p.estatisticas;
  const keyStats = s && s.mandante && s.visitante ? `<div class="card"><div class="card-title">Estatísticas principais<a class="more" data-goto="estatisticas" href="#/partida/${p.partida_id}/estatisticas">Todas</a></div>${statRows(p, [['Finalizações', 'finalizacao.total'], ['Chutes no gol', 'finalizacao.no_gol'], ['Escanteios', 'escanteios'], ['Faltas', 'faltas']], true)}</div>` : '';
  const pre = p.status !== 'finalizado' && !isLive(p);
  const tv = p.status !== 'finalizado' ? watchCard(p.onde_assistir) : '';
  return `<div class="stack">${isLive(p) ? tv : ''}${aiInsightSlot()}${matchProbCard(p)}${pre ? tv + preGameCard(p, tableRows) : ''}${keyStats}${p.fonte === 'football-data' && !html ? '' : events}${pre ? '' : preGameCard(p, tableRows)}${h2hCard(p)}${matchInfoCard(p)}</div>`;
}

// Confronto direto (football-data: GET /v4/matches/{id}/head2head)
function h2hCard(p) {
  const h = p.confronto;
  if (!h || !h.jogos) return '';
  const t = (x) => Math.max(0, x || 0);
  const total = t(h.vitorias_mandante) + t(h.vitorias_visitante) + t(h.empates) || 1;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  return `<div class="card"><div class="card-title">Confronto direto<span class="more">últimos ${h.jogos} jogos · ${h.gols} gols</span></div>
    <div class="h2h"><div>${crest(p.time_mandante, 28)}<b>${t(h.vitorias_mandante)}</b><span>vitórias</span></div><div><b>${t(h.empates)}</b><span>empates</span></div><div>${crest(p.time_visitante, 28)}<b>${t(h.vitorias_visitante)}</b><span>vitórias</span></div></div>
    <div class="h2h-bar"><i style="width:${(t(h.vitorias_mandante) / total) * 100}%;background:${ch}"></i><i style="width:${(t(h.empates) / total) * 100}%;background:var(--line-strong)"></i><i style="width:${(t(h.vitorias_visitante) / total) * 100}%;background:${ca}"></i></div>
    ${(h.partidas || []).map((m) => matchRow(m, { showDate: true, comp: m.campeonato })).join('')}</div>`;
}
function matchInfoCard(p) {
  const rows = [];
  if (p.placar_intervalo) rows.push(['Intervalo', p.placar_intervalo]);
  (p.arbitragem || []).forEach((r) => rows.push([r.funcao, `${r.nome || '—'}${r.nacionalidade ? ` (${r.nacionalidade})` : ''}`]));
  if (p.estadio) rows.push(['Estádio', p.estadio.nome_popular]);
  if (!rows.length) return '';
  return `<div class="card"><div class="card-title">Informações da partida</div><div class="facts-grid">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`;
}

const PITCH_H = `<svg class="lines h" viewBox="0 0 105 68" preserveAspectRatio="none"><rect x="1" y="1" width="103" height="66"/><line x1="52.5" y1="1" x2="52.5" y2="67"/><circle cx="52.5" cy="34" r="9.15"/><rect x="1" y="13.85" width="16.5" height="40.3"/><rect x="1" y="24.85" width="5.5" height="18.3"/><rect x="87.5" y="13.85" width="16.5" height="40.3"/><rect x="98.5" y="24.85" width="5.5" height="18.3"/><path d="M17.5 26.7a9.15 9.15 0 0 1 0 14.6M87.5 26.7a9.15 9.15 0 0 0 0 14.6"/></svg>`;
const PITCH_V = `<svg class="lines v" viewBox="0 0 68 105" preserveAspectRatio="none"><rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/><circle cx="34" cy="52.5" r="9.15"/><rect x="13.85" y="1" width="40.3" height="16.5"/><rect x="24.85" y="1" width="18.3" height="5.5"/><rect x="13.85" y="87.5" width="40.3" height="16.5"/><rect x="24.85" y="98.5" width="18.3" height="5.5"/><path d="M26.7 17.5a9.15 9.15 0 0 0 14.6 0M26.7 87.5a9.15 9.15 0 0 1 14.6 0"/></svg>`;

function matchLineups(p) {
  const E = p.escalacoes;
  if (!E || (!(E.mandante || {}).titulares && !(E.visitante || {}).titulares)) return `<div class="card">${empty('As escalações ainda não foram divulgadas. Normalmente saem cerca de 1 hora antes do jogo.')}</div>`;
  const events = (side) => {
    const m = new Map();
    const bump = (id, k) => { if (!id) return; const o = m.get(id) || {}; o[k] = (o[k] || 0) + 1; m.set(id, o); };
    ((p.gols || {})[side] || []).forEach((g) => !g.gol_contra && bump((g.atleta || {}).atleta_id, 'g'));
    (((p.cartoes || {}).amarelo || {})[side] || []).forEach((c) => bump((c.atleta || {}).atleta_id, 'y'));
    (((p.cartoes || {}).vermelho || {})[side] || []).forEach((c) => bump((c.atleta || {}).atleta_id, 'r'));
    ((p.substituicoes || {})[side] || []).forEach((s) => { bump((s.saiu || {}).atleta_id, 'out'); bump((s.entrou || {}).atleta_id, 'in'); });
    return m;
  };
  const players = (side, team) => {
    const L = E[side];
    if (!L || !L.titulares) return '';
    const ev = events(side);
    const kit = kitColor(team);
    [...L.titulares, ...(L.reservas || [])].forEach((x) => regPlayer(x.atleta, { time: team, camisa: x.camisa, posicao: x.posicao }));
    const st = [...L.titulares].sort((a, b) => a.ordem - b.ordem);
    const shape = String(L.esquema_tatico || '').split('-').map(Number).filter(Boolean);
    let lines;
    if (shape.length && shape.reduce((a, b) => a + b, 0) + 1 === st.length) {
      lines = [[st[0]]]; let i = 1;
      shape.forEach((n) => { lines.push(st.slice(i, i + n)); i += n; });
    } else lines = [[st[0]], st.slice(1, 5), st.slice(5, 8), st.slice(8)];
    const home = side === 'mandante', outfield = lines.length - 1;
    return lines.map((ln, li) => {
      const along = li === 0 ? 5 : 14 + (outfield > 1 ? ((li - 1) / (outfield - 1)) * 25 : 14);
      return ln.map((x, j) => {
        const across = ((j + 1) / (ln.length + 1)) * 100;
        const fx = home ? along : 100 - along, fy = home ? 100 - across : across; // ordem começa pelo lado direito do time
        const e = ev.get(x.atleta.atleta_id) || {};
        const badges = `${(I.ball).repeat(e.g || 0)}${e.y ? cardIcon('y') : ''}${e.r ? cardIcon('r') : ''}`;
        return `<a class="pl" href="#/jogador/${x.atleta.atleta_id}" style="--fx:${fx.toFixed(2)};--fy:${fy.toFixed(2)};--kit:${kit};--ink:${inkFor(kit)}" title="${esc(x.atleta.nome_popular)}${x.posicao && x.posicao.nome ? ' · ' + esc(x.posicao.nome) : ''}">
          <span class="shirt ${li === 0 ? 'gk' : ''}">${esc(x.camisa)}${badges ? `<span class="badges">${badges}</span>` : ''}${e.out ? `<span class="off">${I.out}</span>` : ''}</span>
          <span class="nm">${esc(shortName(x.atleta.nome_popular))}</span></a>`;
      }).join('');
    }).join('');
  };
  const bench = (side, team) => {
    const L = E[side] || {};
    const ev = events(side);
    return `<div><div class="sec-label">${esc(team.nome_popular)} · Reservas</div>
      ${L.tecnico ? `<div class="bench-row"><span class="n">T</span><span>${esc(L.tecnico.nome_popular)}</span><span class="small muted">Técnico</span></div>` : ''}
      ${[...(L.reservas || [])].sort((a, b) => a.ordem - b.ordem).map((x) => `<a class="bench-row" href="#/jogador/${x.atleta.atleta_id}"><span class="n">${esc(x.camisa)}</span><span>${esc(x.atleta.nome_popular)} ${(ev.get(x.atleta.atleta_id) || {}).in ? `<span class="in">${I.in}entrou</span>` : ''}</span><span class="small faint">${esc((x.posicao && x.posicao.sigla) || '')}</span></a>`).join('') || '<div class="bench-row"><span></span><span class="muted">—</span></div>'}</div>`;
  };
  const H = p.time_mandante, A = p.time_visitante;
  return `<div class="card">
    <div class="lu-head"><div class="t">${crest(H, 22)}${esc(H.nome_popular)}</div><div class="fm">${esc((E.mandante || {}).esquema_tatico || '')}${(E.visitante || {}).esquema_tatico ? ' · ' + esc(E.visitante.esquema_tatico) : ''}</div><div class="t r">${esc(A.nome_popular)}${crest(A, 22)}</div></div>
    <div class="pitch">${PITCH_H}${PITCH_V}${players('mandante', H)}${players('visitante', A)}</div>
    <div class="benches">${bench('mandante', H)}${bench('visitante', A)}</div></div>`;
}
// "Giorgian de Arrascaeta" -> "Arrascaeta" no campo; nomes curtos ficam como estão
function shortName(n) {
  const parts = String(n || '').trim().split(/\s+/);
  if (parts.length <= 2 && n.length <= 14) return n;
  return parts.length > 1 ? parts[parts.length - 1] : n;
}

function statRows(p, rows, compact = false) {
  const s = p.estatisticas;
  const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
  const num = (v) => parseFloat(String(v ?? 0).replace('%', '')) || 0;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  const lowerBetter = new Set(['faltas', 'passes.errados', 'impedimentos', 'cartoes_amarelos', 'cartoes_vermelhos']);
  return `<div style="--ch:${ch};--ca:${ca};padding:${compact ? '4px' : '0'} 0">${rows.map(([label, path]) => {
    if (!path) return `<div class="sec-label">${esc(label)}</div>`;
    const a = get(s.mandante, path), b = get(s.visitante, path);
    if (a == null && b == null) return '';
    const na = num(a), nb = num(b), tot = na + nb || 1;
    const lb = lowerBetter.has(path), leadA = lb ? na < nb : na > nb, leadB = lb ? nb < na : nb > na;
    return `<div class="stat"><div class="stat-top"><span>${leadA ? `<b>${esc(a ?? 0)}</b>` : esc(a ?? 0)}</span><span>${label}</span><span>${leadB ? `<b>${esc(b ?? 0)}</b>` : esc(b ?? 0)}</span></div>
      <div class="stat-bars"><div><i class="h ${leadA ? 'lead' : ''}" style="width:${(na / tot) * 100}%"></i></div><div><i class="a ${leadB ? 'lead' : ''}" style="width:${(nb / tot) * 100}%"></i></div></div></div>`;
  }).join('')}</div>`;
}

function matchStats(p) {
  const s = p.estatisticas;
  if (!s || !s.mandante || !s.visitante) return `<div class="card">${empty('As estatísticas aparecem depois que a partida começa.')}</div>`;
  const pa = parseFloat(s.mandante.posse_de_bola) || 0, pb = parseFloat(s.visitante.posse_de_bola) || 0;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  const poss = pa + pb ? `<div class="stat-top" style="padding:12px 16px 0;grid-template-columns:1fr auto 1fr"><span>${crest(p.time_mandante, 18)}</span><span>Posse de bola</span><span style="justify-self:end">${crest(p.time_visitante, 18)}</span></div>
    <div class="poss"><div style="width:${pa}%;background:${ch};color:${inkFor(ch)}">${pa}%</div><div style="width:${pb}%;background:${ca};color:${inkFor(ca)}">${pb}%</div></div>` : '';
  return `<div class="card">${poss}${statRows(p, [
    ['Ataque'], ['Finalizações', 'finalizacao.total'], ['Chutes no gol', 'finalizacao.no_gol'], ['Chutes para fora', 'finalizacao.pra_fora'], ['Chutes bloqueados', 'finalizacao.bloqueado'], ['Bolas na trave', 'finalizacao.na_trave'], ['Escanteios', 'escanteios'], ['Impedimentos', 'impedimentos'],
    ['Passes'], ['Passes', 'passes.total'], ['Passes certos', 'passes.completos'], ['Precisão de passes', 'passes.precisao'], ['Cruzamentos', 'cruzamentos.total'], ['Lançamentos', 'lancamentos.total'],
    ['Defesa'], ['Desarmes', 'desarmes'], ['Interceptações', 'interceptacoes'], ['Cortes', 'cortes'], ['Defesas do goleiro', 'defensivo.defesas'],
    ['Disciplina'], ['Faltas', 'faltas'], ['Cartões amarelos', 'cartoes_amarelos'], ['Cartões vermelhos', 'cartoes_vermelhos'],
  ])}</div>`;
}

/* ============ Time ============ */
// ficha do clube (estádio, fundação, técnico, cores, site) quando a fonte informa
function teamFacts(t) {
  const f = [];
  if (t.estadio) f.push(`<span>${esc(t.estadio)}</span>`);
  if (t.fundacao) f.push(`<span>Fundado em <b>${esc(t.fundacao)}</b></span>`);
  if (t.tecnico && t.tecnico.nome) f.push(`<span>Técnico: <b>${esc(t.tecnico.nome)}</b></span>`);
  if (t.cores) f.push(`<span>${esc(t.cores)}</span>`);
  if (t.site) f.push(`<a href="${esc(t.site)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Site oficial</a>`);
  return f.length ? `<div class="facts">${f.join('')}</div>` : '';
}
async function teamMatches(id, compIds, comps) {
  const lists = await Promise.all(compIds.map(async (cid) => {
    const c = await soft(api(`/campeonatos/${cid}`, 600000));
    if (!c) return [];
    const fases = isLeague(c) ? [c.fase_atual].filter(Boolean) : (c.fases || []);
    const fs = await Promise.all(fases.map((f) => soft(api(`/campeonatos/${cid}/fases/${f.fase_id}`, 120000))));
    return fs.filter(Boolean).flatMap(faseMatches).map((p) => ({ ...p, _comp: comps.find((x) => x.campeonato_id === cid) || c }));
  }));
  const seen = new Set();
  return lists.flat().filter((p) => (+p.time_mandante.time_id === id || +p.time_visitante.time_id === id) && !seen.has(p.partida_id) && seen.add(p.partida_id))
    .sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0));
}

async function viewTeam(id, tab, params, ok) {
  $app.innerHTML = `<div class="stack">${skel(130)}${skel(400)}</div>`;
  const comps = await api('/campeonatos', 600000);
  const [info, tc] = await Promise.all([soft(api(`/times/${id}`, 3600000)), soft(api(`/times/${id}/campeonatos`, 3600000))]);
  if (!ok()) return;
  const detail = info && +info.time_id === id ? info : null;
  const myComps = tc && +tc.time.time_id === id ? tc.campeonatos.map((c) => +c.campeonato_id).filter((cid) => comps.some((c) => c.campeonato_id === cid)) : [];
  // liga nacional (pontos corridos) do time tem prioridade sobre copas e Champions
  const leagueComp = comps.find((c) => myComps.includes(c.campeonato_id) && c.tipo === 'Pontos Corridos')
    || comps.find((c) => myComps.includes(c.campeonato_id) && isLeague(c)) || comps.find((c) => c.campeonato_id === +params.get('c')) || comps.find(isLeague);
  const table = leagueComp ? await soft(api(`/campeonatos/${leagueComp.campeonato_id}/tabela`, 60000)) : null;
  if (!ok()) return;
  let row = null;
  flattenTable(table || []).forEach((g) => g.rows.forEach((r) => { regTeam(r.time); if (+r.time.time_id === id) row = r; }));
  const team = { ...(registry.teams.get(id) || {}), ...(row ? row.time : {}), ...(tc && +tc.time.time_id === id ? tc.time : {}), ...(detail || {}) };
  if (!team.nome_popular) { $app.innerHTML = `<div class="card">${empty('Time não encontrado.')}</div>`; return; }
  if (tab === 'visao') Taste.bump('t', id, 3, teamMeta(team)); // abrir a página do time pesa mais que ver um jogo
  const fav = isFav(id);
  const tabs = [['visao', 'Visão geral'], ['jogos', 'Jogos'], ['elenco', 'Elenco'], ['titulos', 'Títulos'], ['clube', 'Clube']];
  $app.innerHTML = `<div class="stack">
    <div class="card">
      <div class="page-head">${crest(team, 56, 'logo')}
        <div><h1>${esc(team.nome_popular)}</h1>
          <div class="sub">${row && leagueComp ? `${row.posicao}º no ${esc(leagueComp.nome_popular)} · ${row.pontos} pontos` : esc(team.nome || '')}</div>
          ${teamFacts(team)}</div>
        <div class="actions"><button class="btn ${fav ? 'on' : ''}" id="fav-btn">${I.star}<span>${fav ? 'Seguindo' : 'Seguir'}</span></button></div>
      </div>
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/time/${id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
    </div>
    <div id="ttab">${skel(400)}</div></div>`;
  document.getElementById('fav-btn').addEventListener('click', (e) => {
    const on = toggleFav(team);
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.querySelector('span').textContent = on ? 'Seguindo' : 'Seguir';
  });
  const $t = document.getElementById('ttab');

  if (tab === 'elenco' || tab === 'titulos' || tab === 'clube') {
    return teamExtraTab(tab, id, team, $t, ok); // extras.js (Transfermarkt + elenco da fonte)
  }

  // GET /times/{id}/partidas/proximas | anteriores | ao-vivo (agrupadas por campeonato)
  const [nextG, prevG, liveT] = await Promise.all([
    soft(api(`/times/${id}/partidas/proximas`, 600000)), soft(api(`/times/${id}/partidas/anteriores`, 600000)), soft(api(`/times/${id}/partidas/ao-vivo`, 30000)),
  ]);
  if (!ok()) return;
  const withComp = (p) => ({ ...p, _comp: comps.find((c) => p.campeonato && c.campeonato_id === p.campeonato.campeonato_id) || p.campeonato });
  const flat = (g) => Object.values(g || {}).flat().map(withComp);
  let played, upcoming;
  if (nextG || prevG) {
    const liveIds = new Set((liveT || []).map((p) => p.partida_id));
    upcoming = [...(liveT || []).map(withComp), ...flat(nextG).filter((p) => !liveIds.has(p.partida_id))]
      .sort((a, b) => (isLive(b) - isLive(a)) || ((parseDate(a) || 9e15) - (parseDate(b) || 9e15)));
    played = flat(prevG).filter((p) => p.status === 'finalizado').sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0));
  } else { // reserva: percorre as fases dos campeonatos do time
    const matches = await teamMatches(id, myComps.length ? myComps : leagueComp ? [leagueComp.campeonato_id] : [], comps);
    if (!ok()) return;
    played = matches.filter((p) => p.status === 'finalizado');
    upcoming = matches.filter((p) => !['finalizado', 'cancelado'].includes(p.status));
  }

  if (tab === 'jogos') {
    $t.innerHTML = `<div class="cols-2"><div class="stack">
      <div class="card"><div class="card-title">Próximos jogos</div>${upcoming.length ? upcoming.map((p) => matchRow(p, { showDate: true, comp: p._comp })).join('') : empty('Nenhum jogo agendado.')}</div>
      <div class="card"><div class="card-title">Resultados</div>${played.length ? [...played].reverse().map((p) => matchRow(p, { showDate: true, comp: p._comp })).join('') : empty('Nenhum jogo disputado.')}</div>
    </div><aside class="side">${favNav()}</aside></div>`;
    return;
  }

  // visão geral
  const next = upcoming.find(isLive) || upcoming[0];
  const last5 = played.slice(-5);
  const [scAll, newsHtml] = await Promise.all([
    leagueComp ? soft(api(`/campeonatos/${leagueComp.campeonato_id}/artilharia`, 300000)) : null,
    newsCard({ time_id: String(id) }, `Notícias do ${team.nome_popular}`),
  ]);
  const sc = (scAll || []).filter((s) => s.time && +s.time.time_id === id);
  if (!ok()) return;
  let tableCard = '';
  if (row && leagueComp) {
    const rows = flattenTable(table)[0].rows;
    tableCard = `<div class="card"><div class="card-title">${compLogo(leagueComp)}${esc(leagueComp.nome_popular)}<a class="more" href="#/campeonato/${leagueComp.campeonato_id}/tabela">Tabela completa</a></div>${standingsTable(rows, leagueComp.campeonato_id, { compact: true, highlight: [id] })}</div>`;
  }
  const nd = next && parseDate(next);
  $t.innerHTML = `<div class="cols-2"><div class="stack">
    ${next ? `<div class="card"><div class="card-title">${isLive(next) ? '<span class="live-dot"></span> Jogando agora' : 'Próximo jogo'}<span class="more">${next._comp ? esc(next._comp.nome_popular) : ''}</span></div>
      <a class="next" href="#/partida/${next.partida_id}">
        <div class="tm">${crest(next.time_mandante, 44)}${esc(next.time_mandante.nome_popular)}</div>
        <div>${isLive(next) ? `<div class="when" style="color:var(--live)">${next.placar_mandante ?? 0} - ${next.placar_visitante ?? 0}</div><div class="meta">${esc(liveLabel(next))}</div>`
          : `<div class="when">${esc(fmtTime(next))}</div><div class="meta">${nd ? esc(nd.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })) : ''}</div>`}
          ${next.estadio ? `<div class="meta">${esc(next.estadio.nome_popular)}</div>` : ''}</div>
        <div class="tm">${crest(next.time_visitante, 44)}${esc(next.time_visitante.nome_popular)}</div></a></div>` : ''}
    ${last5.length ? `<div class="card"><div class="card-title">Últimos resultados<a class="more" href="#/time/${id}/jogos">Todos os jogos</a></div>
      <div class="results">${last5.map((p) => { const r = resultFor(p, id); const opp = +p.time_mandante.time_id === id ? p.time_visitante : p.time_mandante; return `<a href="#/partida/${p.partida_id}" title="${esc(p.time_mandante.nome_popular)} ${p.placar_mandante} x ${p.placar_visitante} ${esc(p.time_visitante.nome_popular)}">${crest(opp, 22)}<span class="r ${r}">${{ v: 'V', e: 'E', d: 'D' }[r]}</span><span class="s">${p.placar_mandante}-${p.placar_visitante}</span></a>`; }).join('')}</div></div>` : ''}
    ${row ? `<div class="card"><div class="card-title">Desempenho no ${esc(leagueComp.nome_popular)}</div><div class="kv">
      ${[['Pontos', row.pontos], ['Jogos', row.jogos], ['Vitórias', row.vitorias], ['Empates', row.empates], ['Derrotas', row.derrotas], ['Gols pró', row.gols_pro], ['Gols contra', row.gols_contra], ['Aproveitamento', row.aproveitamento + '%']].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div></div>` : ''}
    ${sc.length ? `<div class="card"><div class="card-title">Artilheiros do time</div>${rankRows(sc.slice(0, 6), 'gols', ' gols')}</div>` : ''}
  </div><aside class="side" id="team-aside">${tableCard}${newsHtml}</aside></div>`;
  teamTitlesTeaser(team, id, ok); // principais títulos chegam depois (Transfermarkt)
}

/* ============ Jogador ============ */
async function viewPlayer(id, ok) {
  $app.innerHTML = `<div class="stack">${skel(130)}${skel(240)}</div>`;
  const comps = await api('/campeonatos', 600000);
  const [info, goals, assists] = await Promise.all([
    soft(api(`/atletas/${id}`, 3600000)),
    Promise.all(comps.map((c) => soft(api(`/campeonatos/${c.campeonato_id}/artilharia`, 300000)))),
    Promise.all(comps.map((c) => soft(api(`/campeonatos/${c.campeonato_id}/assistencias`, 300000)))),
  ]);
  if (!ok()) return;
  const season = comps.map((c, i) => {
    const g = (goals[i] || []).find((s) => +s.atleta.atleta_id === id);
    const a = (assists[i] || []).find((s) => +s.atleta.atleta_id === id);
    if (g) regPlayer(g.atleta, { time: g.time });
    return g || a ? { c, g: g ? g.gols : 0, a: a ? a.assistencias : 0, j: (g || a).jogos, rank: g ? goals[i].indexOf(g) + 1 : null, time: (g || a).time } : null;
  }).filter(Boolean);
  const detail = info && +info.atleta_id === id ? info : null;
  const known = registry.players.get(id) || {};
  const pl = { ...known, ...(detail || {}) };
  if (!pl.nome_popular) { $app.innerHTML = `<div class="card">${empty('Jogador não encontrado.')}</div>`; return; }
  const team = (detail && detail.time) || known.time || (season[0] && season[0].time);
  const initials = pl.nome_popular.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const pos = pl.posicao && pl.posicao.nome;
  const newsHtml = team ? await newsCard({ time_id: String(team.time_id) }, `Notícias do ${team.nome_popular}`) : '';
  if (!ok()) return;
  $app.innerHTML = `<div class="cols-2"><div class="stack">
    <div class="card"><div class="page-head">
      <div class="avatar">${pl.foto ? `<img src="${esc(pl.foto)}" alt="">` : esc(initials)}</div>
      <div><h1>${esc(pl.nome_popular)}</h1>
        <div class="sub">${team ? `<a href="#/time/${team.time_id}" style="display:inline-flex;gap:6px;align-items:center">${crest(team, 16)}${esc(team.nome_popular)}</a>` : ''}${pos ? ` · ${esc(pos)}` : ''}</div>
        <div class="facts">${pl.camisa ? `<span>Camisa <b>${esc(pl.camisa)}</b></span>` : ''}${pl.idade ? `<span><b>${pl.idade}</b> anos</span>` : ''}${pl.nacionalidade ? `<span style="display:inline-flex;gap:6px;align-items:center">${pl.bandeira ? `<img class="flag" src="${esc(pl.bandeira)}" alt="">` : ''}${esc(pl.nacionalidade)}</span>` : ''}${pl.altura ? `<span>${esc(pl.altura)}</span>` : ''}</div>
      </div><a class="btn cmp-btn" href="#/comparar?a=${id}">Comparar</a></div></div>
    <div class="card"><div class="card-title">Temporada ${esc((comps[0] && comps[0].edicao_atual && comps[0].edicao_atual.temporada) || '')}</div>
      ${season.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th class="l">Campeonato</th><th>Jogos</th><th>Gols</th><th>Assist.</th></tr></thead><tbody>
        ${season.map((s) => `<tr><td class="team l"><a href="#/campeonato/${s.c.campeonato_id}/artilharia">${compLogo(s.c, 18)}<span>${esc(s.c.nome_popular)}</span></a></td><td>${s.j ?? '–'}</td><td class="pts">${s.g}</td><td>${s.a}</td></tr>`).join('')}
      </tbody></table></div>` : empty('Sem gols ou assistências registrados nos campeonatos acompanhados.')}</div>
    <div class="stack" id="tm"></div>
  </div><aside class="side">${newsHtml}${favNav()}</aside></div>`;
  loadPlayerTM(pl, team, ok); // perfil completo (Transfermarkt) chega depois, sem travar a página
}

/* ============ Favoritos ============ */
async function viewFavorites(ok) {
  const favs = Object.values(getFavs());
  if (!favs.length) { $app.innerHTML = `<div class="card"><div class="card-title">Favoritos</div>${empty('Você ainda não segue nenhum time. Abra a página de um time e toque em Seguir.')}</div>`; return; }
  const live = (await pollLive()) || [];
  if (!ok()) return;
  const render = (live) => {
    const ids = new Set(favs.map((f) => +f.time_id));
    const lm = live.filter((p) => ids.has(+p.time_mandante.time_id) || ids.has(+p.time_visitante.time_id));
    $app.innerHTML = `<div class="cols-2"><div class="stack">
      ${lm.length ? `<div class="card"><div class="card-title"><span class="live-dot"></span> Jogando agora</div>${lm.map((p) => matchRow(p)).join('')}</div>` : ''}
      <div class="card"><div class="card-title">Times que você segue</div>${favs.map((t) => `<a class="list-row" href="#/time/${t.time_id}">${crest(t, 28)}<span style="font-weight:500">${esc(t.nome_popular)}</span><span class="right">${I.chev}</span></a>`).join('')}</div>
    </div><aside class="side"></aside></div>`;
  };
  render(live);
  view.onLive = (l) => ok() && render(l);
}

/* ============ Busca ============ */
async function viewSearch(q, ok) {
  $search.value = q;
  $app.innerHTML = skel(300);
  await buildIndex();
  if (!ok()) return;
  const { teams, players } = searchAll(q);
  $app.innerHTML = `<div class="cols-2"><div class="stack">
    <div class="card"><div class="card-title">Times ${q ? `para “${esc(q)}”` : ''}<span class="more">${teams.length}</span></div>${teams.slice(0, 80).map((t) => `<a class="list-row" href="#/time/${t.time_id}">${crest(t, 24)}<span style="font-weight:500">${esc(t.nome_popular)}</span><span class="right">${esc(t.sigla || '')}</span></a>`).join('') || empty('Nenhum time encontrado.')}</div>
    ${q ? `<div class="card"><div class="card-title">Jogadores<span class="more">${players.length}</span></div>${players.map((p) => `<a class="list-row" href="#/jogador/${p.atleta_id}">${p.time ? crest(p.time, 22) : ''}<div><div style="font-weight:500">${esc(p.nome_popular)}</div><div class="small muted">${esc((p.time && p.time.nome_popular) || '')}</div></div></a>`).join('') || empty('Nenhum jogador encontrado.')}</div>` : ''}
  </div><aside class="side">${favNav()}</aside></div>`;
}

/* ============ Sobre e fontes ============ */
function viewAbout() {
  const src = [
    ['API Futebol', 'https://www.api-futebol.com.br', 'Dados oficiais dos campeonatos do plano contratado e notícias.'],
    ['football-data.org', 'https://www.football-data.org', 'Champions League e principais ligas europeias.'],
    ['ESPN', 'https://www.espn.com.br', 'Placar ao vivo, escalações, estatísticas e notícias (fonte pública, não oficial).'],
    ['Transfermarkt', 'https://www.transfermarkt.com.br', 'Valor de mercado, transferências, elencos e títulos.'],
  ];
  $app.innerHTML = `<div class="cols-2"><div class="stack">
    <div><h1 class="h1">Sobre o Placar</h1><div class="muted small">Placares ao vivo, tabelas, escalações, notícias e estatísticas do futebol brasileiro e europeu.</div></div>
    <div class="card"><div class="card-title">Fontes dos dados</div>${src.map(([n, u, d]) => `<a class="list-row" href="${u}" target="_blank" rel="noopener noreferrer"><div><div style="font-weight:600">${n}</div><div class="small muted">${d}</div></div><span class="right">${I.chev}</span></a>`).join('')}</div>
    <div class="card"><div class="card-title">Aviso</div><div class="card-body small muted">O Placar não é afiliado a clubes, federações ou às fontes acima. Marcas, escudos e imagens pertencem aos seus donos. Os dados podem ter atraso ou conter erros; confira sempre as fontes oficiais.</div></div>
    <div class="card"><div class="card-title">Privacidade</div><div class="card-body small muted">O Placar não usa cookies nem rastreamento. Times favoritos, palpites, recordes dos minijogos e preferência de tema ficam salvos apenas neste navegador. As notícias abrem o site do portal de origem.</div></div>
  </div><aside class="side">${favNav()}</aside></div>`;
}

/* ============ App instalável (PWA) e modo offline ============ */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* sem PWA: o site segue normal */ }));
}
function connectionNotice() {
  let el = document.getElementById('offline');
  if (navigator.onLine) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline';
    el.className = 'offline';
    el.textContent = 'Sem conexão. Mostrando os últimos dados salvos.';
    document.body.appendChild(el);
  }
}
window.addEventListener('online', () => { connectionNotice(); router(); });
window.addEventListener('offline', connectionNotice);
connectionNotice();
renderFooter();

router();