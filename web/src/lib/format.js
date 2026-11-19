// Datas, status das partidas, cores dos clubes e dados derivados (mesmas regras do app clássico).

export const parseISO = (iso) => (iso ? new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null);
export const parseDate = (p) => (p ? parseISO(p.data_realizacao_iso) : null);
export const dayKey = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'tbd');
export const fmtDay = (d) => (d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Data a definir');
export const fmtShort = (d) => (d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
export const fmtTime = (p) => (p && p.hora_realizacao) || '–';
export const fmtDT = (iso, o = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => {
  const d = parseISO(iso);
  return d ? d.toLocaleString('pt-BR', o).replace(/\./g, '') : '';
};
export function timeAgo(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  const min = Math.round((Date.now() - d) / 6e4);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}
export function relDay(d) {
  if (!d) return '';
  const a = new Date(dayKey(d) + 'T12:00:00'), b = new Date(dayKey(new Date()) + 'T12:00:00');
  const n = Math.round((a - b) / 864e5);
  return n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : n === -1 ? 'Ontem' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
}

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const titleize = (s) => String(s || '').split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/* ---------- status ---------- */
export const isLive = (p) => !!p && (p.status === 'andamento' || p.status === 'ao-vivo');
export const STATUS_NAME = { adiado: 'Adiado', cancelado: 'Cancelado', suspenso: 'Suspenso', suspensa: 'Suspensa', 'pre-jogo': 'Pré-jogo' };
export const PERIOD_END = { 'primeiro-tempo': 45, 'segundo-tempo': 90, 'primeiro-tempo-prorrogacao': 105, 'segundo-tempo-prorrogacao': 120 };
export function liveLabel(p) {
  if (p.periodo === 'intervalo' || p.periodo === 'intervalo-prorrogacao') return 'Intervalo';
  if (p.periodo === 'disputa-penalti' || p.periodo === 'disputa-penaltis') return 'Pênaltis';
  if (p.cronometro_label) return p.cronometro_label;
  return p.cronometro != null ? `${p.cronometro}'` : 'Ao vivo';
}
export const penScore = (p) => { const d = p.disputa_penalti; return d && typeof d === 'object' ? [d.placar_penalti_mandante, d.placar_penalti_visitante] : null; };
export function winnerSide(p) {
  if (p.status !== 'finalizado' || p.placar_mandante == null) return null;
  if (p.placar_mandante !== p.placar_visitante) return p.placar_mandante > p.placar_visitante ? 'h' : 'a';
  const pen = penScore(p);
  return pen ? (pen[0] > pen[1] ? 'h' : 'a') : null;
}
const PERIOD_BASE = { 'primeiro-tempo': [0, 45], intervalo: [45, 0], 'segundo-tempo': [45, 45], 'primeiro-tempo-prorrogacao': [90, 15], 'segundo-tempo-prorrogacao': [105, 15] };
export function evMinute(e) {
  if (e.minuto_label != null) return { label: e.minuto_label || '–', key: e.ordem_seg || 0 };
  const slug = e.periodo_slug;
  const [base, len] = PERIOD_BASE[slug] || [0, 45];
  if (slug === 'intervalo' || !e.minuto) return { label: slug === 'intervalo' ? 'Int' : '–', key: base * 60 + 1 };
  const [m, s] = String(e.minuto).split(':').map(Number);
  const n = Math.floor(m) + 1;
  return { label: n > len ? `${base + len}+${n - len}'` : `${base + n}'`, key: base * 60 + m * 60 + (s || 0) };
}

/* ---------- campeonatos ---------- */
export const isLeague = (c) => !!c && (!!c.rodada_atual || (c.fase_atual && c.fase_atual.tipo === 'pontos-corridos'));
export const roundsList = (r) => (Array.isArray(r) ? r : Object.values(r || {}).flat().filter((x) => x && x.rodada != null)).sort((a, b) => a.rodada - b.rodada);
export function flattenTable(t) {
  if (Array.isArray(t)) return t.length ? [{ title: '', rows: t }] : [];
  const out = [];
  Object.entries(t || {}).forEach(([fase, v]) => {
    if (Array.isArray(v)) out.push({ title: titleize(fase), rows: v });
    else Object.entries(v || {}).forEach(([g, rows]) => Array.isArray(rows) && out.push({ title: titleize(g), rows }));
  });
  return out;
}
export function faseMatches(f) {
  const out = [];
  const walk = (v) => { if (!v) return; if (Array.isArray(v)) v.forEach(walk); else if (v.partida_id) out.push(v); else if (typeof v === 'object') Object.values(v).forEach(walk); };
  walk(f.partidas);
  (f.chaves || []).forEach((c) => { walk(c.partida_ida); walk(c.partida_volta); });
  return out;
}
export const COUNTRY = { England: 'Inglaterra', Spain: 'Espanha', Italy: 'Itália', Germany: 'Alemanha', France: 'França', Portugal: 'Portugal', Netherlands: 'Holanda', Europe: 'Europa' };
const REGION_NAME = { nacional: 'Brasil', continental: 'América do Sul', europa: 'Europa', americas: 'América do Norte', mundo: 'Ásia', selecoes: 'Seleções' };
// país da liga (football-data manda em inglês; as ligas extras da ESPN já vêm em português) ou a região
export const regionLabel = (c) => COUNTRY[c.pais] || c.pais || REGION_NAME[c.regiao] || 'Brasil';
export const REGIONS = Object.entries(REGION_NAME);
export const ZONES = {
  libertadores: ['Libertadores', '#1d6ff2'], 'pre-libertadores': ['Pré-Libertadores', '#5aa3ff'], 'sul-americana': ['Sul-Americana', '#f59e0b'],
  rebaixamento: ['Rebaixamento', '#e5484d'], classificados: ['Classificados', '#12a150'], acesso: ['Acesso', '#12a150'],
  champions: ['Champions League', '#1d6ff2'], 'pre-champions': ['Qualificatória da Champions', '#5aa3ff'], europa: ['Europa League', '#f59e0b'],
  conference: ['Conference League', '#14b8a6'], 'playoff-rebaixamento': ['Playoff de rebaixamento', '#f97316'],
  oitavas: ['Oitavas (direto)', '#12a150'], playoffs: ['Playoffs', '#5aa3ff'], eliminado: ['Eliminado', '#e5484d'],
};

/* ---------- cores dos clubes ---------- */
const CLUB_COLORS = {
  FLA: '#c4161c', PAL: '#006437', COR: '#111111', SAO: '#d0021b', SAN: '#111111', VAS: '#111111', FLU: '#7a0026', BOT: '#111111',
  GRE: '#0d80bf', INT: '#e30613', CAM: '#111111', CRU: '#0033a0', BAH: '#0a4ea2', FOR: '#0c4da2', CEA: '#111111', CAP: '#c8102e',
  BGT: '#d0021b', RBB: '#d0021b', VIT: '#d0021b', JUV: '#00843d', SPT: '#d0021b', MIR: '#e6c200', CHA: '#00843d', CFC: '#00543d', REM: '#0033a0',
};
export function teamColor(t) {
  if (!t) return '#3d6b4f';
  if (t.cor) return t.cor;
  if (CLUB_COLORS[t.sigla]) return CLUB_COLORS[t.sigla];
  let h = 0; for (const c of String(t.nome_popular || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 38%)`;
}
export function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
export const inkFor = (c) => (luminance(c) > 0.6 ? '#111' : '#fff');
export function kitColor(t) {
  const c = teamColor(t), l = luminance(c);
  if ((l < 0.12 || l > 0.9) && t && t.cor_secundaria && Math.abs(luminance(t.cor_secundaria) - 0.5) < Math.abs(l - 0.5)) return t.cor_secundaria;
  return c;
}
export function barColors(h, a) {
  let ch = kitColor(h), ca = kitColor(a);
  if (luminance(ch) < 0.12) ch = '#6b7280';
  if (luminance(ca) < 0.12) ca = '#6b7280';
  if (ch === ca) ca = '#9ca3af';
  return [ch, ca];
}
export const hexA = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(127,127,127,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
export function shortName(n) {
  const parts = String(n || '').trim().split(/\s+/);
  if (parts.length <= 2 && String(n).length <= 14) return n;
  return parts.length > 1 ? parts[parts.length - 1] : n;
}
