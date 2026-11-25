// Notificações: o que a pessoa acompanha (campeonatos, times, NBA, F1), que tipo de aviso quer e como recebe
// (aviso dentro do site e, se ela permitir, notificação do navegador quando a aba está em segundo plano).
// Fica em "placar.notif" (sincroniza com a conta). Times seguidos (favoritos) avisam por padrão; dá para silenciar.
import { store, getFavs } from './store.js';
import { norm } from './format.js';

const pushIsOn = () => { try { return localStorage.getItem('vyra.push') === '1' && Notification.permission === 'granted'; } catch { return false; } };

const KEY = 'placar.notif';
const DEF = {
  comps: [10], // sem configurar: Brasileirão + times seguidos (com ~40 campeonatos, "tudo" viraria barulho)
  times: [], // times extras, além dos favoritos: [{ time_id, nome_popular, escudo }]
  mudos: [], // favoritos silenciados (ids)
  nbaTodos: false, nbaTimes: [], // NBA: todos os jogos ou só os times escolhidos ([{ id, nome, logo }], ids da ESPN)
  f1: false, // começo e fim de cada sessão (treinos, classificação, corrida)
  f1Pilotos: [], f1Equipes: [], // F1 seguidos: [{ id, nome, cor, foto }] (ids da Jolpica); avisam a posição de cada um
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

/* ---------- multijogo: jogos abertos lado a lado sempre avisam gol e fim ---------- */
const watching = new Set();
export const setWatching = (ids) => { watching.clear(); (ids || []).forEach((i) => watching.add(+i)); };
export const isWatching = (id) => watching.has(+id);

/* ---------- quais eventos avisar ---------- */
const KIND = { 'Começou': 'inicio', 'Intervalo': 'intervalo', 'Fim de jogo': 'fim' };
export function wantsMatch(p, kind) {
  const n = getNotif();
  if (p && watching.has(+p.partida_id) && (kind === 'gol' || kind === 'fim' || n.tipos[kind])) return true;
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
/* ---------- F1: pilotos e equipes seguidos ---------- */
const has = (list, id) => (list || []).some((x) => x && x.id === id);
export const followsF1Driver = (id) => has(getNotif().f1Pilotos, id);
export const followsF1Team = (id) => has(getNotif().f1Equipes, id);
export const followsF1Any = () => { const n = getNotif(); return n.f1Pilotos.length + n.f1Equipes.length > 0; };
export function toggleF1Driver(p) { // p = { id, nome, cor, foto }
  const n = getNotif();
  setNotif({ f1Pilotos: has(n.f1Pilotos, p.id) ? n.f1Pilotos.filter((x) => x.id !== p.id) : [...n.f1Pilotos, { id: p.id, nome: p.nome, cor: p.cor, foto: p.foto }] });
}
export function toggleF1Team(t) { // t = { id, nome, cor }
  const n = getNotif();
  setNotif({ f1Equipes: has(n.f1Equipes, t.id) ? n.f1Equipes.filter((x) => x.id !== t.id) : [...n.f1Equipes, { id: t.id, nome: t.nome, cor: t.cor }] });
}
// piloto da ordem de uma sessão que a pessoa segue (por ele mesmo ou pela equipe)
export const isFollowedF1 = (x) => !!x && (followsF1Driver(x.id) || (!!x.equipe && followsF1Team(typeof x.equipe === 'string' ? x.equipe : x.equipe.id)));
// sessão da F1: avisa quem liga "todas as sessões" ou segue alguém; no fim, diz a posição de quem segue
export function wantsF1(e) {
  const n = getNotif();
  const mine = ((e && e.ordem) || []).filter(isFollowedF1);
  return { on: n.f1 || n.f1Pilotos.length + n.f1Equipes.length > 0, mine };
}

/* ---------- notificação do navegador (aba em segundo plano) ---------- */
export const browserSupport = () => typeof window !== 'undefined' && 'Notification' in window;
export const browserPermission = () => (browserSupport() ? Notification.permission : 'unsupported');
export async function enableBrowser() {
  if (!browserSupport()) return 'unsupported';
  const r = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  setNotif({ navegador: r === 'granted' });
  return r;
}
export function systemNotify(title, body, { icon, tag, url, force = false } = {}) {
  if (browserPermission() !== 'granted') return;
  // com o push ligado, a notificação do sistema vem pelo servidor (também com o site fechado): não duplica
  if (!force && pushIsOn()) return;
  if (!force && (!getNotif().navegador || !document.hidden)) return; // com a aba à vista, basta o aviso do site (force: teste)
  const opts = { body, icon: icon || '/icons/icon-192.png', badge: '/icons/icon-192.png', tag, data: { url: url || '/' } };
  const show = (reg) => (reg ? reg.showNotification(title, opts) : new Notification(title, opts));
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(show).catch(() => show(null));
  else show(null);
}
