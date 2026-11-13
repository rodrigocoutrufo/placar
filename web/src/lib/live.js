// Tempo real: transmissão do servidor (SSE /api/stream) com volta para consulta periódica se cair.
import { useSyncExternalStore } from 'react';
import { get } from './api.js';

const state = { live: [], other: { nba: [], f1: null }, goals: [], on: false };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

let snapLive = state.live, snapOther = state.other, snapGoals = state.goals;
export const useLive = () => useSyncExternalStore(subscribe, () => snapLive);
export const useOtherLive = () => useSyncExternalStore(subscribe, () => snapOther);
export const useGoals = () => useSyncExternalStore(subscribe, () => snapGoals);

function setLive(list) { state.live = list; snapLive = list; emit(); }
function pushGoal(g) {
  snapGoals = [...snapGoals.slice(-3), { ...g, key: `${g.partida.partida_id}-${Date.now()}` }];
  emit();
  setTimeout(() => { snapGoals = snapGoals.filter((x) => x.key !== g.key && Date.now() - +x.key.split('-').pop() < 6500); emit(); }, 7000);
}
export const dismissGoal = (key) => { snapGoals = snapGoals.filter((x) => x.key !== key); emit(); };

let es = null, fails = 0;
function connect() {
  if (!('EventSource' in window) || es) return;
  es = new EventSource('/api/stream');
  es.addEventListener('open', () => { state.on = true; fails = 0; });
  es.addEventListener('snapshot', (e) => setLive(JSON.parse(e.data)));
  es.addEventListener('update', (e) => setLive(JSON.parse(e.data)));
  es.addEventListener('gol', (e) => pushGoal(JSON.parse(e.data)));
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
