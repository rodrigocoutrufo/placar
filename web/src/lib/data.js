// Consultas compostas (várias chamadas à API) usadas por mais de uma tela.
import { useQuery } from '@tanstack/react-query';
import { fetchCached, soft, get, failHard } from './api.js';
import { isLeague, roundsList, faseMatches, parseDate, isLive } from './format.js';
import { matchAffinity, Taste } from './store.js';

// jogos da rodada anterior, atual e próxima de cada campeonato (mesma lógica do app clássico)
export async function loadAgenda(comps) {
  const jobs = comps.map(async (c) => {
    try {
      if (isLeague(c) && c.rodada_atual) {
        const rounds = roundsList(await soft(fetchCached(`/campeonatos/${c.campeonato_id}/rodadas`, 600_000)));
        const nums = rounds.map((r) => r.rodada);
        const i = nums.indexOf(c.rodada_atual.rodada);
        const want = i >= 0 ? nums.slice(Math.max(0, i - 1), i + 2) : [c.rodada_atual.rodada];
        const rs = await Promise.all(want.map((n) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/rodadas/${n}`, 60_000))));
        return rs.filter(Boolean).flatMap((r) => r.partidas || []);
      }
      if (c.fase_atual) {
        const ids = [c.fase_atual.fase_id];
        const detail = await soft(fetchCached(`/campeonatos/${c.campeonato_id}`, 600_000));
        const fases = (detail && detail.fases) || [];
        const i = fases.findIndex((f) => f.fase_id === c.fase_atual.fase_id);
        if (i >= 0 && fases[i + 1]) ids.push(fases[i + 1].fase_id);
        if (i > 0) ids.push(fases[i - 1].fase_id);
        const fs = await Promise.all(ids.map((id) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/fases/${id}`, 120_000))));
        return fs.filter(Boolean).flatMap(faseMatches);
      }
    } catch { /* campeonato indisponível */ }
    return [];
  });
  const seen = new Set();
  return (await Promise.all(jobs)).flat().filter((p) => !seen.has(p.partida_id) && seen.add(p.partida_id));
}

export function useComps() {
  return useQuery({ queryKey: ['/campeonatos'], queryFn: () => get('/campeonatos'), staleTime: 600_000, throwOnError: failHard });
}
export function useAgenda(comps) {
  return useQuery({ queryKey: ['agenda', (comps || []).length], queryFn: () => loadAgenda(comps), enabled: !!comps, staleTime: 60_000 });
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
