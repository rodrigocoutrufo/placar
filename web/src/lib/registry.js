import { useEffect, useState } from 'react';
// Índice de times e jogadores (para a busca e para páginas de jogador sem ficha na fonte).
import { fetchCached, soft } from './api.js';
import { flattenTable, norm } from './format.js';

export const registry = { teams: new Map(), players: new Map() };
export function regTeam(t) { if (t && t.time_id) registry.teams.set(+t.time_id, { ...registry.teams.get(+t.time_id), ...t }); }
export function regPlayer(a, extra = {}) {
  if (!a || !a.atleta_id) return;
  const prev = registry.players.get(+a.atleta_id) || {};
  registry.players.set(+a.atleta_id, { ...prev, ...extra, ...a, nome_popular: (a.nome_popular || prev.nome_popular || '').trim(), time: extra.time || prev.time });
}

let ready = null;
export function buildIndex() {
  if (ready) return ready;
  ready = fetchCached('/campeonatos', 600_000).then((comps) => Promise.all(comps.flatMap((c) => [
    soft(fetchCached(`/campeonatos/${c.campeonato_id}/tabela`, 60_000)).then((t) => flattenTable(t || []).forEach((g) => g.rows.forEach((r) => regTeam(r.time)))),
    soft(fetchCached(`/campeonatos/${c.campeonato_id}/artilharia`, 300_000)).then((l) => (l || []).forEach((s) => { regTeam(s.time); regPlayer(s.atleta, { time: s.time }); })),
  ]))).catch(() => { ready = null; });
  return ready;
}
export function searchAll(q, maxPlayers = 50) {
  const nq = norm(q);
  const teams = [...registry.teams.values()].filter((t) => !nq || norm(t.nome_popular).includes(nq) || norm(t.sigla) === nq)
    .sort((a, b) => a.nome_popular.localeCompare(b.nome_popular));
  const players = nq ? [...registry.players.values()].filter((p) => norm(p.nome_popular).includes(nq)).slice(0, maxPlayers) : [];
  return { teams, players };
}
export const mvNumber = (v) => {
  const m = /([\d.,]+)\s*(mil|mi|bi)/i.exec(v || '');
  if (!m) return 0;
  return parseFloat(m[1].replace(',', '.')) * ({ bi: 1e9, mi: 1e6, mil: 1e3 }[m[2].toLowerCase()] || 1);
};

// sugestões enquanto digita (busca do cabeçalho)
export function useSuggest(q) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (q.length >= 2 && !ready) buildIndex().then(() => setReady(true)); }, [q, ready]);
  if (q.length < 2 || !ready) return null;
  const { teams, players } = searchAll(q, 6);
  return [...teams.slice(0, 5).map((t) => ({ k: `t${t.time_id}`, to: `/time/${t.time_id}`, t, label: t.nome_popular, kind: 'Time' })),
    ...players.map((p) => ({ k: `p${p.atleta_id}`, to: `/jogador/${p.atleta_id}`, t: p.time, label: p.nome_popular, kind: 'Jogador' }))];
}