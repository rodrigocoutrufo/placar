import { useEffect, useState } from 'react';
// Times e jogadores já vistos (para páginas de jogador sem ficha na fonte) e a busca do site.
import { useApi } from './api.js';
import { norm } from './format.js';

export const registry = { teams: new Map(), players: new Map() };
export function regTeam(t) { if (t && t.time_id) registry.teams.set(+t.time_id, { ...registry.teams.get(+t.time_id), ...t }); }
export function regPlayer(a, extra = {}) {
  if (!a || !a.atleta_id) return;
  const prev = registry.players.get(+a.atleta_id) || {};
  registry.players.set(+a.atleta_id, { ...prev, ...extra, ...a, nome_popular: (a.nome_popular || prev.nome_popular || '').trim(), time: extra.time || prev.time });
}

export const mvNumber = (v) => {
  const m = /([\d.,]+)\s*(mil|mi|bi)/i.exec(v || '');
  if (!m) return 0;
  return parseFloat(m[1].replace(',', '.')) * ({ bi: 1e9, mi: 1e6, mil: 1e3 }[m[2].toLowerCase()] || 1);
};

// Busca do site no servidor (/api/busca): campeonatos, times e jogadores de futebol, NBA e F1.
// Espera a pessoa parar de digitar (debounce) e mantém o resultado anterior na tela enquanto busca o novo.
export function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
export function useSearch(q, ms = 250) {
  const dq = useDebounced(norm(q), ms);
  const on = dq.length >= 2;
  const r = useApi(on ? `/busca?q=${encodeURIComponent(dq)}` : null, { ttl: 600_000, enabled: on, keep: true });
  return { data: on ? r.data : null, loading: on && (r.isFetching || dq !== norm(q)), error: r.error };
}

// sugestões enquanto digita (cabeçalho): até 3 campeonatos, 4 times e 5 jogadores
export function useSuggest(q) {
  const { data, loading } = useSearch(q);
  if (norm(q).length < 2) return null;
  if (!data) return loading ? 'loading' : null;
  const kind = { futebol: 'Jogador', nba: 'NBA', f1: 'F1' };
  return [
    ...data.campeonatos.slice(0, 3).map((c) => ({ ...c, k: `c${c.to}`, kind: 'Campeonato' })),
    ...data.times.slice(0, 4).map((t) => ({ ...t, k: `t${t.to}`, kind: t.esporte === 'futebol' ? 'Time' : t.sub })),
    ...data.jogadores.slice(0, 5).map((p) => ({ ...p, k: `p${p.to}`, kind: kind[p.esporte] })),
  ];
}
