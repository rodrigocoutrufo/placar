// Tempo real: transmissão do servidor (SSE /api/stream) com volta para consulta periódica se cair.
import { useSyncExternalStore } from 'react';
import { get } from './api.js';
import { wantsMatch, periodKind, wantsNba, wantsF1, systemNotify, isWatching } from './notify.js';

const state = { live: [], other: { nba: [], f1: null }, goals: [], on: false };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

let snapLive = state.live, snapOther = state.other, snapGoals = state.goals;
export const useLive = () => useSyncExternalStore(subscribe, () => snapLive);
export const useOtherLive = () => useSyncExternalStore(subscribe, () => snapOther);
export const useGoals = () => useSyncExternalStore(subscribe, () => snapGoals);

function setLive(list) { state.live = list; snapLive = list; emit(); }
// avisos na tela (gol, começo/intervalo/fim, NBA, F1): só do que a pessoa acompanha (ver notify.js)
function pushAlert(a) {
  const key = `${a.id}-${Date.now()}`;
  snapGoals = [...snapGoals.slice(-3), { ...a, key }];
  emit();
  setTimeout(() => { snapGoals = snapGoals.filter((x) => x.key !== key); emit(); }, a.kind === 'gol' ? 7000 : 6000);
}
const score = (p) => `${p.time_mandante.nome_popular} ${p.placar_mandante ?? 0} × ${p.placar_visitante ?? 0} ${p.time_visitante.nome_popular}`;
function onGoal(g) {
  if (!wantsMatch(g.partida, 'gol')) return;
  // no multijogo o próprio quadro do jogo pisca "GOL!"; o aviso do navegador vale do mesmo jeito (aba em segundo plano)
  if (!isWatching(g.partida.partida_id)) pushAlert({ kind: 'gol', id: g.partida.partida_id, ...g });
  const who = g.autor && g.autor.nome ? ` · ${g.autor.minuto ? `${g.autor.minuto} ` : ''}${g.autor.nome}` : '';
  systemNotify(`Gol do ${g.time.nome_popular}!`, score(g.partida) + who, { icon: g.time.escudo, tag: `gol-${g.partida.partida_id}`, url: `/#/partida/${g.partida.partida_id}` });
}
function onPeriod(e) {
  const kind = periodKind(e.texto);
  if (!kind || !wantsMatch(e.partida, kind)) return;
  if (!isWatching(e.partida.partida_id)) pushAlert({ kind: 'periodo', id: e.partida.partida_id, partida: e.partida, texto: e.texto });
  systemNotify(e.texto, score(e.partida), { tag: `per-${e.partida.partida_id}`, url: `/#/partida/${e.partida.partida_id}` });
}
function onNba(e) {
  if (!wantsNba(e.jogo, e.tipo)) return;
  const g = e.jogo, txt = `${g.fora.sigla} ${g.fora.placar ?? 0} × ${g.casa.placar ?? 0} ${g.casa.sigla}`;
  pushAlert({ kind: 'nba', id: g.id, jogo: g, texto: e.texto });
  systemNotify(`NBA · ${e.texto}`, txt, { icon: g.casa.logo, tag: `nba-${g.id}`, url: `/#/nba/jogo/${g.id}` });
}
function onF1(e) {
  if (!wantsF1()) return;
  pushAlert({ kind: 'f1', id: `${e.gp}-${e.sessao}`, ...e });
  const top = (e.top || []).map((x) => `${x.pos}º ${x.nome}`).join(' · ');
  systemNotify(`F1 · ${e.sessao} ${e.texto === 'Começou' ? 'começou' : 'terminou'}`, `${e.gp}${top ? ` — ${top}` : ''}`, { tag: `f1-${e.sessao}`, url: '/#/f1' });
}
export const dismissGoal = (key) => { snapGoals = snapGoals.filter((x) => x.key !== key); emit(); };

// Aviso de teste (painel de notificações): o mesmo caminho de um gol de verdade, com um jogo ao vivo se houver.
// Na tela na hora; do navegador depois de `delay` ms, para dar tempo de trocar de aba ou minimizar.
export function testAlert(delay = 5000) {
  const real = state.live.find((p) => p.time_mandante && p.time_visitante);
  const t = (id, nome, sigla, esc) => ({ time_id: id, nome_popular: nome, sigla, escudo: `https://a.espncdn.com/i/teamlogos/soccer/500/${esc}.png` });
  const p = real ? { ...real, placar_mandante: (real.placar_mandante || 0) + 1 }
    : { partida_id: 0, campeonato: { campeonato_id: 10, nome_popular: 'Brasileirão' }, status: 'andamento',
      time_mandante: t(900000819, 'Flamengo', 'FLA', 819), time_visitante: t(900002029, 'Palmeiras', 'PAL', 2029), placar_mandante: 1, placar_visitante: 0 };
  const g = { partida: p, lado: 'mandante', time: p.time_mandante, autor: { nome: 'Teste do Vyra', minuto: "90'" } };
  pushAlert({ kind: 'gol', id: `teste-${Date.now()}`, ...g });
  setTimeout(() => systemNotify(`Gol do ${g.time.nome_popular}! (teste)`, `${score(p)} · notificação de teste do Vyra`,
    { icon: g.time.escudo, tag: 'teste', url: '/#/', force: true }), delay);
}

let es = null, fails = 0;
function connect() {
  if (!('EventSource' in window) || es) return;
  es = new EventSource('/api/stream');
  es.addEventListener('open', () => { state.on = true; fails = 0; });
  es.addEventListener('snapshot', (e) => setLive(JSON.parse(e.data)));
  es.addEventListener('update', (e) => setLive(JSON.parse(e.data)));
  es.addEventListener('gol', (e) => onGoal(JSON.parse(e.data)));
  es.addEventListener('periodo', (e) => onPeriod(JSON.parse(e.data)));
  es.addEventListener('nba', (e) => onNba(JSON.parse(e.data)));
  es.addEventListener('f1', (e) => onF1(JSON.parse(e.data)));
  es.addEventListener('outros', (e) => { snapOther = JSON.parse(e.data); emit(); });
  es.addEventListener('error', () => {
    state.on = false;
    if (++fails >= 3) { es.close(); es = null; setTimeout(connect, 60000); }
  });
}
export function startLive() {
  connect();
  get('/ao-vivo').then((l) => { if (!state.live.length) setLive(l); }).catch(() => {});
  setInterval(() => { if (!document.hidden && !state.on) get('/ao-vivo').then(setLive).catch(() => {}); }, 30000);
}
