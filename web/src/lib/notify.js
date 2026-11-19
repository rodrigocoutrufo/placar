// Notificações: o que a pessoa acompanha (campeonatos, times, NBA, F1), que tipo de aviso quer e como recebe
// (aviso dentro do site e, se ela permitir, notificação do navegador quando a aba está em segundo plano).
// Fica em "placar.notif" (sincroniza com a conta). Times seguidos (favoritos) avisam por padrão; dá para silenciar.
import { store, getFavs } from './store.js';
import { norm } from './format.js';

const KEY = 'placar.notif';
const DEF = {
  comps: [10], // sem configurar: Brasileirão + times seguidos (com ~40 campeonatos, "tudo" viraria barulho)
  times: [], // times extras, além dos favoritos: [{ time_id, nome_popular, escudo }]
  mudos: [], // favoritos silenciados (ids)
  nbaTodos: false, nbaTimes: [], // NBA: todos os jogos ou só os times escolhidos ([{ id, nome, logo }], ids da ESPN)
  f1: false, // começo e fim de cada sessão (treinos, classificação, corrida)
  tipos: { gol: true, inicio: true, intervalo: false, fim: true },
  navegador: false,
};
export function getNotif() {
  const v = store.get(KEY, {}) || {};
  return { ...DEF, ...v, tipos: { ...DEF.tipos, ...(v.tipos || {}) } };
}
export const setNotif = (patch) => store.set(KEY, { ...(store.get(KEY, {}) || {}), ...patch });

/* ---------- campeonatos ---------- */
export const followsComp = (id) => getNotif().comps.includes(+id);
export function toggleComp(id) {
  const n = getNotif();
  setNotif({ comps: n.comps.includes(+id) ? n.comps.filter((x) => x !== +id) : [...n.comps, +id] });
}

/* ---------- times (futebol) ---------- */
const same = (a, b) => !!a && !!b && (+a.time_id === +b.time_id || norm(a.nome_popular) === norm(b.nome_popular));
const isFavTeam = (t) => Object.values(getFavs()).some((f) => same(f, t));
export function followsTeam(t) {
  if (!t) return false;
  const n = getNotif();
  if (isFavTeam(t)) return !n.mudos.includes(+t.time_id) && !Object.values(getFavs()).some((f) => same(f, t) && n.mudos.includes(+f.time_id));
  return n.times.some((x) => same(x, t));
}
export function toggleTeam(t) {
  const n = getNotif();
  if (isFavTeam(t)) { // favorito: o sino silencia/reativa
    const ids = Object.values(getFavs()).filter((f) => same(f, t)).map((f) => +f.time_id).concat(+t.time_id);
    const muted = ids.some((i) => n.mudos.includes(i));
    setNotif({ mudos: muted ? n.mudos.filter((i) => !ids.includes(i)) : [...n.mudos, ...ids] });
  } else {
    setNotif({ times: n.times.some((x) => same(x, t)) ? n.times.filter((x) => !same(x, t)) : [...n.times, { time_id: t.time_id, nome_popular: t.nome_popular, escudo: t.escudo }] });
  }
}
export function alertTeams() {
  const n = getNotif();
  return [...Object.values(getFavs()).filter((f) => !n.mudos.includes(+f.time_id)), ...n.times];
}

/* ---------- NBA e F1 ---------- */
const nbaIds = (n) => n.nbaTimes.map((x) => +(x && x.id != null ? x.id : x));
export const followsNbaTeam = (id) => nbaIds(getNotif()).includes(+id);
export function toggleNbaTeam(t) { // t = { id, nome, logo }
  const n = getNotif();
  setNotif({ nbaTimes: nbaIds(n).includes(+t.id) ? n.nbaTimes.filter((x) => +(x.id ?? x) !== +t.id) : [...n.nbaTimes, { id: +t.id, nome: t.nome, logo: t.logo }] });
}

/* ---------- quais eventos avisar ---------- */
const KIND = { 'Começou': 'inicio', 'Intervalo': 'intervalo', 'Fim de jogo': 'fim' };
export function wantsMatch(p, kind) {
  const n = getNotif();
  if (!n.tipos[kind] || !p) return false;
  const cid = p.campeonato && +p.campeonato.campeonato_id;
  return n.comps.includes(cid) || followsTeam(p.time_mandante) || followsTeam(p.time_visitante);
}
export const periodKind = (texto) => KIND[texto] || null;
export function wantsNba(g, kind) {
  const n = getNotif();
  if (!g || (kind !== 'gol' && !n.tipos[kind])) return false;
  return n.nbaTodos || nbaIds(n).includes(+g.casa.id) || nbaIds(n).includes(+g.fora.id);
}
export const wantsF1 = () => getNotif().f1;

/* ---------- notificação do navegador (aba em segundo plano) ---------- */
export const browserSupport = () => typeof window !== 'undefined' && 'Notification' in window;
export const browserPermission = () => (browserSupport() ? Notification.permission : 'unsupported');
export async function enableBrowser() {
  if (!browserSupport()) return 'unsupported';
  const r = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  setNotif({ navegador: r === 'granted' });
  return r;
}
export function systemNotify(title, body, { icon, tag, url } = {}) {
  if (!getNotif().navegador || browserPermission() !== 'granted' || !document.hidden) return; // com a aba à vista, basta o aviso do site
  const opts = { body, icon: icon || '/icons/icon-192.png', badge: '/icons/icon-192.png', tag, data: { url: url || '/' } };
  const show = (reg) => (reg ? reg.showNotification(title, opts) : new Notification(title, opts));
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(show).catch(() => show(null));
  else show(null);
}
