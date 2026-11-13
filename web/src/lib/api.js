import { useQuery, QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export async function get(path) {
  let r;
  try { r = await fetch('/api' + path, { credentials: 'same-origin' }); } catch {
    throw new Error('Sem conexão com o servidor do Placar.');
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || `Erro ${r.status}`);
  return body;
}

export async function post(path, data) {
  const r = await fetch('/api' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'placar' },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.message || `Erro ${r.status}`); e.status = r.status; throw e; }
  return body;
}

// useApi('/campeonatos', { ttl: 600_000 })  ->  { data, isLoading, error }
export function useApi(path, { ttl = 30_000, refetch = false, enabled = true } = {}) {
  return useQuery({
    queryKey: [path], queryFn: () => get(path), staleTime: ttl, enabled: enabled && !!path,
    refetchInterval: refetch || false,
  });
}

// pedidos paralelos que podem falhar sem derrubar a tela
export const soft = (p) => p.catch(() => null);
export const fetchCached = (path, ttl = 60_000) => queryClient.fetchQuery({ queryKey: [path], queryFn: () => get(path), staleTime: ttl });
