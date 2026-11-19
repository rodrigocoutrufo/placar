// Consultas compostas (várias chamadas à API) usadas por mais de uma tela.
import { useQuery } from '@tanstack/react-query';
import { get, failHard } from './api.js';
import { parseDate, isLive } from './format.js';
import { matchAffinity, Taste } from './store.js';

// jogos da rodada anterior, atual e próxima de cada campeonato: o servidor monta tudo numa chamada só
// (antes eram ~5 chamadas por campeonato; com 40 campeonatos passava do limite de requisições)
export const loadAgenda = () => get('/agenda');

export function useComps() {
  return useQuery({ queryKey: ['/campeonatos'], queryFn: () => get('/campeonatos'), staleTime: 600_000, throwOnError: failHard });
}
export function useAgenda(comps) {
  return useQuery({ queryKey: ['agenda'], queryFn: loadAgenda, enabled: !!comps, staleTime: 60_000 });
}

export const compRank = (id, base) => base - Math.min(40, Taste.score('c', id) * 3);

// destaques: ao vivo, depois próximas 36 h e encerrados há menos de 18 h, pela importância e pelo gosto
export function featured(live, agenda, comps, n = 10) {
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
  return [...[...live].sort((a, b) => rank(a) - rank(b)), ...up, ...done].slice(0, n);
}
export const compOf = (comps, p) => (comps || []).find((c) => p.campeonato && c.campeonato_id === p.campeonato.campeonato_id) || p.campeonato || {};
