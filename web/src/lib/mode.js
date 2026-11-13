// "Modo" da tela: F1, NBA e cada campeonato vestem o site inteiro (cores, textura, selo no topo) e abrem com vinheta.
import { useEffect, useSyncExternalStore } from 'react';
import { compTheme, compLogoDark, SPORT, LOGO } from './themes.js';

let cur = { key: '', kind: null, theme: null, info: {}, intro: null };
const subs = new Set();
const sub = (f) => { subs.add(f); return () => subs.delete(f); };
export const useModeState = () => useSyncExternalStore(sub, () => cur);

function apply(next) {
  const root = document.documentElement;
  if (!next.kind) {
    delete root.dataset.mode; delete root.dataset.pat;
    ['--m1', '--m2', '--acc', '--accL', '--acc-ink'].forEach((v) => root.style.removeProperty(v));
  } else {
    const t = next.theme;
    root.dataset.mode = next.kind; root.dataset.pat = t.pat;
    root.style.setProperty('--m1', t.m1); root.style.setProperty('--m2', t.m2);
    root.style.setProperty('--acc', t.acc); root.style.setProperty('--accL', t.accL); root.style.setProperty('--acc-ink', t.ink);
  }
}
function set(next, withIntro) {
  if (next.key === cur.key) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden; // aba em segundo plano: sem vinheta
  cur = { ...next, intro: withIntro && next.kind && !reduced ? { kind: next.kind, info: next.info, id: Date.now() } : null };
  apply(cur);
  subs.forEach((f) => f());
}
export const endIntro = () => { if (cur.intro) { cur = { ...cur, intro: null }; subs.forEach((f) => f()); } };

export const Mode = {
  clear: () => set({ key: '', kind: null, theme: null, info: {} }, false),
  sport: (k, intro = true) => set({ key: k, kind: k, theme: SPORT[k], info: { name: k === 'nba' ? 'NBA' : 'Fórmula 1', logo: LOGO[k], href: `/${k}` } }, intro),
  comp: (c, intro = true) => c && c.campeonato_id && set({
    key: `c${c.campeonato_id}`, kind: 'comp', theme: compTheme(c),
    info: { name: c.nome_popular || c.nome, logo: compLogoDark(c), sub: c.edicao_atual ? c.edicao_atual.nome : '', href: `/campeonato/${c.campeonato_id}` },
  }, intro),
};
// atalho para as telas: aplica o modo ao montar
export function useMode(fn, deps) { useEffect(() => { fn(); }, deps); } // eslint-disable-line react-hooks/exhaustive-deps
