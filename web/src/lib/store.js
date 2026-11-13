// Preferências no aparelho (mesmas chaves do app clássico: tudo continua valendo) + sincronização com a conta.
import { useSyncExternalStore } from 'react';
import { norm } from './format.js';

const subs = new Set();
const emit = () => subs.forEach((f) => f());
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponível */ } version++; emit(); scheduleSync(); },
};
let version = 0;
export const useStoreVersion = () => useSyncExternalStore(subscribe, () => version);

/* ---------- favoritos ---------- */
export const getFavs = () => store.get('placar.favs', {});
export const favByName = (name) => Object.values(getFavs()).find((x) => norm(x.nome_popular) === norm(name));
export const isFav = (t) => !!t && (!!getFavs()[t.time_id] || !!favByName(t.nome_popular));
export function toggleFav(t) {
  const f = getFavs();
  const same = Object.values(f).filter((x) => +x.time_id === +t.time_id || norm(x.nome_popular) === norm(t.nome_popular));
  if (same.length) same.forEach((x) => delete f[x.time_id]);
  else f[t.time_id] = { time_id: t.time_id, nome_popular: t.nome_popular, sigla: t.sigla, escudo: t.escudo, cor: t.cor };
  store.set('placar.favs', f);
  return !same.length;
}

/* ---------- gosto ("Para você") ---------- */
const KEY = 'placar.gostos', HALF = 21 * 864e5;
const dec = (x) => (x ? x.s * Math.pow(0.5, (Date.now() - x.at) / HALF) : 0);
export const Taste = {
  data() { return store.get(KEY, null) || { t: {}, c: {}, e: {} }; },
  bump(kind, id, w = 1, meta = null) {
    if (id == null || id === '') return;
    const d = this.data();
    const bag = d[kind] || (d[kind] = {});
    const x = bag[id];
    bag[id] = { s: Math.min(200, dec(x) + w), at: Date.now(), ...(meta ? { m: meta } : x && x.m ? { m: x.m } : {}) };
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* cheio */ }
    scheduleSync();
  },
  score(kind, id) { return dec((this.data()[kind] || {})[id]); },
  team(t) { return this.score('t', t.time_id) + (isFav(t) ? 25 : 0); },
  // interesse de verdade: abrir a página do time (3), vários jogos do mesmo time ou seguir. Abrir um jogo só (1) não basta.
  top(kind, n = 8, min = 3) {
    const bag = this.data()[kind] || {};
    return Object.entries(bag).map(([id, x]) => ({ id, s: dec(x), m: x.m || {} })).filter((x) => x.s >= min).sort((a, b) => b.s - a.s).slice(0, n);
  },
  reset() { store.set(KEY, { t: {}, c: {}, e: {} }); },
  empty() { return !this.top('t', 1).length && !this.top('c', 1).length && !Object.keys(getFavs()).length; },
};
export function tasteMatch(p, w = 1) {
  const meta = (t) => ({ n: t.nome_popular, e: t.escudo || t.escudo_escuro || null });
  Taste.bump('t', p.time_mandante.time_id, w, meta(p.time_mandante));
  Taste.bump('t', p.time_visitante.time_id, w, meta(p.time_visitante));
  if (p.campeonato) Taste.bump('c', p.campeonato.campeonato_id, w, { n: p.campeonato.nome_popular || p.campeonato.nome });
}
export function matchAffinity(p) {
  const th = Taste.team(p.time_mandante), ta = Taste.team(p.time_visitante);
  const tc = Taste.score('c', p.campeonato && p.campeonato.campeonato_id);
  const best = th >= ta ? p.time_mandante : p.time_visitante;
  let why = '';
  if (isFav(best)) why = `Você segue o ${best.nome_popular}`;
  else if (Math.max(th, ta) >= 3) why = `Você acompanha o ${best.nome_popular}`;
  else if (tc >= 4) why = `Você acompanha ${(p.campeonato && (p.campeonato.nome_popular || p.campeonato.nome)) || 'este campeonato'}`;
  return { s: Math.max(th, ta) * 2 + Math.min(th, ta) * 0.5 + tc * 0.8, why };
}

/* ---------- tema ---------- */
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('placar.theme', next); } catch { /* */ }
  version++; emit(); scheduleSync();
}

/* ---------- sincronização com a conta (mesmo formato do app clássico) ---------- */
const SYNC_RX = /^placar\.(favs|palpites|alerts|theme|gostos|craque\.[\w.-]+|sim\.\d+|pen[\w.-]*|game\.[\w.-]+)$/;
export const account = { user: null, syncedAt: null };
let syncTimer = null;
function localData() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!SYNC_RX.test(k)) continue;
      const v = localStorage.getItem(k);
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    }
  } catch { /* */ }
  return out;
}
function scheduleSync(now = false) {
  if (!account.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    fetch('/api/conta/dados', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'placar' }, body: JSON.stringify({ dados: localData() }) }).catch(() => {});
  }, now ? 0 : 1500);
}
// junta o que está salvo na conta com o que está neste aparelho (une favoritos, palpites...) e envia de volta
export async function syncPull() {
  if (!account.user) return false;
  let d;
  try { d = await (await fetch('/api/conta/dados', { credentials: 'same-origin', headers: { 'X-Requested-With': 'placar' } })).json(); } catch { return false; }
  const server = (d && d.dados) || {}, local = localData();
  let changed = false;
  Object.entries(server).forEach(([k, sv]) => {
    if (!SYNC_RX.test(k)) return;
    const lv = local[k];
    let v = lv;
    if (lv === undefined) v = sv;
    else if (sv && lv && typeof sv === 'object' && typeof lv === 'object' && !Array.isArray(sv)) v = { ...sv, ...lv };
    if (JSON.stringify(v) !== JSON.stringify(lv)) {
      changed = true;
      try { localStorage.setItem(k, typeof v === 'string' && k === 'placar.theme' ? v : JSON.stringify(v)); } catch { /* */ }
    }
  });
  const t = localStorage.getItem('placar.theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  account.syncedAt = d && d.atualizado_em;
  version++; emit(); scheduleSync(true);
  return changed;
}
export function setUser(u) {
  const was = account.user && account.user.id;
  account.user = u || null;
  version++; emit();
  if (u && u.id !== was) syncPull();
}
export async function loadAccount() {
  try {
    const r = await fetch('/api/auth/eu', { credentials: 'same-origin', headers: { 'X-Requested-With': 'placar' } });
    const d = await r.json();
    account.user = d.usuario || null;
  } catch { account.user = null; }
  account.loaded = true;
  version++; emit();
  if (account.user) syncPull();
  return account.user;
}
