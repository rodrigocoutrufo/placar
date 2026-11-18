import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useApi, fetchCached, soft } from '../lib/api.js';
import { store, getFavs, useStoreVersion } from '../lib/store.js';
import { ZONES, flattenTable, parseISO, fmtShort, barColors, winnerSide, penScore, parseDate, norm } from '../lib/format.js';
import { Panel, Head, Skel, Wait, Empty, ErrorBox, Stagger, Item, Crest, CountUp, LiveDot, LiveMinute, Icon, ease } from '../components/ui.jsx';

const pct = (v) => (v == null ? '–' : v >= 99.95 ? '100%' : v > 0 && v < 0.1 ? '<0,1%' : `${v.toFixed(1).replace('.', ',')}%`);

/* ---------- tabela animada (posições trocam de lugar com animação) ---------- */
export function MovingTable({ rows, campId, live = false }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>#</th><th className="l">Time</th><th>J</th><th>SG</th><th>P</th>{live && <th className="l">Agora</th>}</tr></thead>
        <tbody>
          <LayoutGroup>
            {rows.map((r) => {
              const z = ZONES[r.faixa_classificacao];
              const p = r._live;
              return (
                <motion.tr key={r.time.time_id} layout transition={{ type: 'spring', stiffness: 380, damping: 34 }} className={p ? 'is-playing' : ''}>
                  <td className="pos" style={{ '--z': z ? z[1] : 'transparent' }}>{r.posicao}{r.variacao_posicao > 0 ? <span className="mv up">▲{r.variacao_posicao}</span> : r.variacao_posicao < 0 ? <span className="mv down">▼{-r.variacao_posicao}</span> : null}</td>
                  <td className="team l"><Link to={`/time/${r.time.time_id}?c=${campId}`}><Crest t={r.time} size={22} /><span>{r.time.nome_popular}</span></Link></td>
                  <td>{r.jogos}</td><td>{r.saldo_gols > 0 ? '+' : ''}{r.saldo_gols}</td><td className="pts"><b>{r.pontos}</b></td>
                  {live && <td className="l">{p && <Link className="now" to={`/partida/${p.partida_id}`}><LiveDot />{p.time_mandante.sigla} {p.placar_mandante ?? 0}-{p.placar_visitante ?? 0} {p.time_visitante.sigla} <small className="muted"><LiveMinute p={p} /></small></Link>}</td>}
                </motion.tr>
              );
            })}
          </LayoutGroup>
        </tbody>
      </table>
    </div>
  );
}

// como a tabela fica se os jogos em andamento terminarem agora
export function liveStandings(rows, live) {
  const byId = new Map(rows.map((r) => [r.time.time_id, r]));
  const byName = new Map(rows.map((r) => [norm(r.time.nome_popular), r]));
  const find = (t) => byId.get(t.time_id) || byName.get(norm(t.nome_popular));
  const games = live.filter((p) => find(p.time_mandante) && find(p.time_visitante));
  if (!games.length) return null;
  return applyResults(rows, games.map((p) => ({ h: find(p.time_mandante).time.time_id, a: find(p.time_visitante).time.time_id, gh: p.placar_mandante || 0, ga: p.placar_visitante || 0, p })));
}
function applyResults(rows, results) {
  const copy = rows.map((r) => ({ ...r, _old: r.posicao, _live: null }));
  const idx = new Map(copy.map((r) => [r.time.time_id, r]));
  results.forEach(({ h, a, gh, ga, p }) => {
    const H = idx.get(h), A = idx.get(a);
    if (!H || !A) return;
    [[H, gh, ga], [A, ga, gh]].forEach(([r, f, c]) => {
      r.jogos += 1; r.gols_pro += f; r.gols_contra += c; r.saldo_gols += f - c;
      if (f > c) { r.pontos += 3; r.vitorias += 1; } else if (f === c) { r.pontos += 1; r.empates += 1; } else r.derrotas += 1;
    });
    if (p) { H._live = p; A._live = p; }
  });
  copy.sort((x, y) => y.pontos - x.pontos || y.vitorias - x.vitorias || y.saldo_gols - x.saldo_gols || y.gols_pro - x.gols_pro);
  const zones = new Map(rows.map((r) => [r.posicao, r.faixa_classificacao]));
  copy.forEach((r, i) => { r.posicao = i + 1; r.faixa_classificacao = zones.get(i + 1); r.variacao_posicao = r._old - r.posicao; });
  return copy;
}

/* ---------- Chances ---------- */
export function Chances({ id }) {
  const tq = useApi(`/campeonatos/${id}/chances`, { ttl: 600_000 });
  const { data: d, error } = tq;
  if (error && !tq.data) return <ErrorBox error={error} retry={() => tq.refetch()} />;
  if (!d) return <Panel><p className="pad muted small">Simulando milhares de campeonatos com os jogos que faltam…</p><div className="pad"><Skel h={380} /></div></Panel>;
  const zones = d.zonas.filter((z) => ZONES[z.chave]);
  const favs = getFavs();
  const early = d.times.some((x) => x.jogos < 12);
  const heat = (v, bad) => ({ '--h': Math.min(1, (v || 0) / 100), '--hc': bad ? 'var(--loss)' : 'var(--hl)' });
  return (
    <div className="col">
      <Panel className="intro-note">
        <b>{d.simulacoes.toLocaleString('pt-BR')} campeonatos simulados</b>
        <span>com os {d.jogos_restantes} jogos que faltam. O modelo usa gols marcados e sofridos na temporada e o mando de campo{early ? '; com poucas rodadas, as chances ainda mudam bastante' : ''}. Atualizado às {parseISO(d.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</span>
      </Panel>
      <Panel className="flush">
        <div className="tbl-wrap"><table className="tbl chances">
          <thead><tr><th>#</th><th className="l">Time</th><th>P</th><th title="Pontos esperados">Final</th><th>Título</th>{zones.map((z) => <th key={z.chave} title={`${ZONES[z.chave][0]} (${z.de}º–${z.ate}º)`}><i className="zdot" style={{ background: ZONES[z.chave][1] }} />{ZONES[z.chave][0]}</th>)}<th className="hs l">Posição final</th></tr></thead>
          <motion.tbody variants={{ show: { transition: { staggerChildren: 0.025 } } }} initial="hidden" animate="show">
            {d.times.map((x) => (
              <motion.tr key={x.time.time_id} className={favs[x.time.time_id] ? 'hl' : ''} variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }}>
                <td className="muted">{x.posicao_atual}</td>
                <td className="team l"><Link to={`/time/${x.time.time_id}?c=${id}`}><Crest t={x.time} size={22} /><span>{x.time.nome_popular}</span></Link></td>
                <td>{x.pontos}</td><td className="pts"><b>{Math.round(x.pontos_esperados)}</b></td>
                <td className="heat" style={heat(x.titulo)}>{pct(x.titulo)}</td>
                {zones.map((z) => <td key={z.chave} className="heat" style={heat(x.zonas[z.chave], z.chave === 'rebaixamento' || z.chave === 'eliminado')}>{pct(x.zonas[z.chave])}</td>)}
                <td className="hs l"><span className="dist">{x.distribuicao.map((v, i) => <motion.i key={i} title={`${i + 1}º: ${pct(v)}`} style={{ background: (ZONES[(d.zonas.find((z) => i + 1 >= z.de && i + 1 <= z.ate) || {}).chave] || [])[1] || 'var(--faint)' }} initial={{ height: 0 }} animate={{ height: `${Math.max(2, Math.min(100, v * 2.2))}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.01 }} />)}</span></td>
              </motion.tr>
            ))}
          </motion.tbody>
        </table></div>
      </Panel>
      <Panel><Head>Próximos jogos · probabilidade de vitória</Head><Stagger>{d.jogos.slice(0, 12).map((m) => <ProbRow key={m.partida_id} m={m} />)}</Stagger></Panel>
    </div>
  );
}
function ProbRow({ m }) {
  const p = m.probabilidades, d = parseISO(m.data);
  const [ch, ca] = barColors(m.time_mandante, m.time_visitante);
  return (
    <Item><Link className="prow" to={`/partida/${m.partida_id}`}>
      <small className="muted">{d ? fmtShort(d) : ''}</small>
      <span className="t h"><b>{m.time_mandante.nome_popular}</b><Crest t={m.time_mandante} size={20} /></span>
      <span className="pv"><b>{Math.round(p.casa)}%</b><span className="pbar"><i style={{ width: `${p.casa}%`, background: ch }} /><i style={{ width: `${p.empate}%`, background: 'var(--draw)' }} /><i style={{ width: `${p.fora}%`, background: ca }} /></span><b>{Math.round(p.fora)}%</b></span>
      <span className="t"><Crest t={m.time_visitante} size={20} /><b>{m.time_visitante.nome_popular}</b></span>
    </Link></Item>
  );
}

/* ---------- Simulador ---------- */
export function Simulator({ id }) {
  useStoreVersion();
  const simQ = useApi(`/campeonatos/${id}/chances`, { ttl: 600_000 });
  const { data: d, error } = simQ;
  const key = `placar.sim.${id}`;
  const sim = store.get(key, {});
  const [gi, setGi] = useState(null);
  const games = useMemo(() => (d ? d.jogos.filter((m) => m.status !== 'andamento') : []), [d]);
  const groups = useMemo(() => {
    const out = [];
    const gk = (m) => (m.rodada ? `${m.rodada}ª rodada` : (() => { const x = parseISO(m.data); if (!x) return 'A definir'; const s = new Date(x); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return `Semana de ${fmtShort(s)}`; })());
    games.forEach((m) => { const k = gk(m); let g = out.find((x) => x.k === k); if (!g) { g = { k, ms: [] }; out.push(g); } g.ms.push(m); });
    return out;
  }, [games]);
  if (error && !d) return <ErrorBox error={error} retry={() => simQ.refetch()} />;
  if (!d) return <Skel h={500} />;
  const soon = Date.now() - 864e5;
  const idx = gi ?? Math.max(0, groups.findIndex((g) => g.ms.some((m) => (parseISO(m.data) || 0) >= soon)));
  const g = groups[idx];
  const save = (next) => store.set(key, next);
  const setScore = (pid, h, a) => { const next = { ...store.get(key, {}) }; if (h == null && a == null) delete next[pid]; else next[pid] = { h, a }; save(next); };
  const results = Object.entries(sim).map(([pid, s]) => { const m = games.find((x) => String(x.partida_id) === pid); return m && s.h != null && s.a != null ? { h: m.time_mandante.time_id, a: m.time_visitante.time_id, gh: s.h, ga: s.a } : null; }).filter(Boolean);
  const table = applyResults(d.tabela, results);
  const filled = results.length;
  const auto = () => { const next = { ...store.get(key, {}) }; games.forEach((m) => { if (next[m.partida_id]) return; const p = m.probabilidades; next[m.partida_id] = p.casa >= p.empate && p.casa >= p.fora ? { h: 1, a: 0 } : p.fora >= p.empate ? { h: 0, a: 1 } : { h: 1, a: 1 }; }); save(next); };
  return (
    <div className="sim">
      <div className="col">
        <Panel className="intro-note">
          <b>Simulador</b><span>Preencha os placares dos jogos que faltam e veja a tabela se mexer na hora. Fica salvo neste aparelho (e na conta).</span>
          <div className="sim-actions"><button className="btn" onClick={auto}>Resultado mais provável em tudo</button><button className="btn" onClick={() => save({})}>Limpar</button><small className="muted">{filled} de {games.length} jogos simulados</small></div>
        </Panel>
        {g ? (
          <Panel className="flush">
            <div className="roundbar">
              <button className="ibtn" disabled={idx <= 0} onClick={() => setGi(idx - 1)}>{Icon.left}</button>
              <AnimatePresence mode="wait"><motion.b key={g.k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>{g.k}</motion.b></AnimatePresence>
              <button className="ibtn" disabled={idx >= groups.length - 1} onClick={() => setGi(idx + 1)}>{Icon.right}</button>
            </div>
            <Stagger key={g.k}>{g.ms.map((m) => {
              const s = sim[m.partida_id] || {}, p = m.probabilidades;
              const val = (v) => (v == null ? '' : v);
              const parse = (v) => (v === '' ? null : Math.max(0, Math.min(15, +v)));
              return (
                <Item key={m.partida_id} className={`sim-row ${s.h != null ? 'set' : ''}`}>
                  <span className="t h"><b>{m.time_mandante.nome_popular}</b><Crest t={m.time_mandante} size={22} /></span>
                  <span className="score-in">
                    <input type="number" min="0" max="15" value={val(s.h)} onChange={(e) => setScore(m.partida_id, parse(e.target.value), s.a ?? (e.target.value === '' ? null : 0))} aria-label={`Gols ${m.time_mandante.nome_popular}`} />
                    <i>×</i>
                    <input type="number" min="0" max="15" value={val(s.a)} onChange={(e) => setScore(m.partida_id, s.h ?? (e.target.value === '' ? null : 0), parse(e.target.value))} aria-label={`Gols ${m.time_visitante.nome_popular}`} />
                  </span>
                  <span className="t"><Crest t={m.time_visitante} size={22} /><b>{m.time_visitante.nome_popular}</b></span>
                  <span className="quick">
                    <button title={`Mandante vence (${Math.round(p.casa)}%)`} onClick={() => setScore(m.partida_id, 1, 0)}>1</button>
                    <button title={`Empate (${Math.round(p.empate)}%)`} onClick={() => setScore(m.partida_id, 1, 1)}>X</button>
                    <button title={`Visitante vence (${Math.round(p.fora)}%)`} onClick={() => setScore(m.partida_id, 0, 1)}>2</button>
                  </span>
                </Item>
              );
            })}</Stagger>
          </Panel>
        ) : <Panel><Empty>Não há jogos restantes para simular.</Empty></Panel>}
      </div>
      <Panel className="flush sim-table"><Head>Tabela simulada</Head><MovingTable rows={table} campId={id} /></Panel>
    </div>
  );
}

/* ---------- Chaveamento ---------- */
function tieResult(c) {
  const legs = [c.partida_ida, c.partida_volta].filter(Boolean);
  if (!legs.length) return null;
  const A = legs[0].time_mandante, B = legs[0].time_visitante;
  let a = 0, b = 0, played = 0;
  legs.forEach((p) => { if (p.placar_mandante == null) return; played++; if (+p.time_mandante.time_id === +A.time_id) { a += p.placar_mandante; b += p.placar_visitante; } else { a += p.placar_visitante; b += p.placar_mandante; } });
  const last = legs[legs.length - 1];
  let winner = null;
  if (legs.every((p) => p.status === 'finalizado')) { if (a !== b) winner = a > b ? A : B; else { const w = winnerSide(last); if (w) winner = w === 'h' ? last.time_mandante : last.time_visitante; } }
  const pen = penScore(last);
  let penA = null, penB = null;
  if (pen) [penA, penB] = +last.time_mandante.time_id === +A.time_id ? pen : [pen[1], pen[0]];
  return { A, B, a, b, played, winner, legs, penA, penB };
}
export function Bracket({ c }) {
  const knockout = (c.fases || []).filter((f) => f.tipo === 'mata-mata');
  const q = useQuery({ queryKey: ['bracket', c.campeonato_id], throwOnError: false, queryFn: () => Promise.all(knockout.map((f) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/fases/${f.fase_id}`, 120_000)))), staleTime: 120_000 });
  if (!q.data) return <Wait q={q} h={500} />;
  const valid = q.data.filter((f) => f && (f.chaves || []).length);
  let start = valid.findIndex((f) => f.chaves.length <= 8);
  if (start < 0) start = Math.max(0, valid.length - 4);
  const cols = valid.slice(start);
  if (!cols.length) return <Panel><Empty>Chaveamento ainda não definido.</Empty></Panel>;
  return (
    <Panel className="flush">
      <div className="bracket">
        {cols.map((f, ci) => (
          <motion.div key={f.nome} className="b-col" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ci * 0.12, duration: 0.5, ease }}>
            <h3>{f.nome}</h3>
            <div className="b-ties">{f.chaves.map((ch, i) => {
              const r = tieResult(ch);
              if (!r) return null;
              const row = (t, g, pen) => { const adv = r.winner && +r.winner.time_id === +t.time_id; return (
                <div className={`b-row ${adv ? 'adv' : ''} ${r.winner && !adv ? 'out' : ''}`}><Crest t={t} size={20} /><Link to={`/time/${t.time_id}?c=${c.campeonato_id}`}>{t.nome_popular}</Link><b>{r.played ? g : ''}{pen != null && <small> ({pen})</small>}</b></div>
              ); };
              return (
                <div key={i} className="b-tie">{row(r.A, r.a, r.penA)}{row(r.B, r.b, r.penB)}
                  <div className="b-legs">{r.legs.map((p, k) => <Link key={p.partida_id} to={`/partida/${p.partida_id}`}>{r.legs.length > 1 ? (k ? 'Volta' : 'Ida') : 'Jogo'} {p.placar_mandante == null ? fmtShort(parseDate(p)) : `${p.placar_mandante}-${p.placar_visitante}`}</Link>)}</div>
                </div>
              );
            })}</div>
          </motion.div>
        ))}
      </div>
      {start > 0 && <div className="legend">Fases anteriores na aba <Link to={`/campeonato/${c.campeonato_id}/jogos`} style={{ color: 'var(--hl)' }}>Jogos</Link>.</div>}
    </Panel>
  );
}

/* ---------- Estatísticas do campeonato ---------- */
export function CompStats({ id }) {
  const sq = useApi(`/campeonatos/${id}/tabela`, { ttl: 60_000 });
  const { data } = sq;
  if (!data) return <Wait q={sq} h={500} />;
  const rows = flattenTable(data).flatMap((g) => g.rows);
  if (!rows.length) return <Panel><Empty>Estatísticas disponíveis quando houver classificação.</Empty></Panel>;
  const goals = rows.reduce((a, r) => a + r.gols_pro, 0), games = rows.reduce((a, r) => a + r.jogos, 0) / 2, draws = rows.reduce((a, r) => a + r.empates, 0) / 2;
  const by = (f, asc = false) => [...rows].sort((a, b) => (asc ? f(a) - f(b) : f(b) - f(a)));
  const list = (title, sorted, val) => {
    const max = Math.max(1, ...sorted.slice(0, 5).map(val));
    return (
      <Panel key={title}><Head>{title}</Head>
        <Stagger>{sorted.slice(0, 5).map((r, i) => (
          <Item key={r.time.time_id}><Link className="rank-row" to={`/time/${r.time.time_id}?c=${id}`}><span className="n">{i + 1}</span><Crest t={r.time} size={24} /><span className="who"><b>{r.time.nome_popular}</b></span>
            <span className="rbar"><motion.i initial={{ width: 0 }} animate={{ width: `${(val(r) / max) * 100}%` }} transition={{ duration: 0.9, ease, delay: i * 0.05 }} /></span><span className="v"><CountUp value={val(r)} /></span></Link></Item>
        ))}</Stagger></Panel>
    );
  };
  return (
    <div className="col">
      <Panel><div className="kpi-grid big">
        <div><b><CountUp value={goals} /></b><span>Gols</span></div><div><b><CountUp value={games ? goals / games : 0} decimals={2} /></b><span>Gols por jogo</span></div>
        <div><b><CountUp value={Math.round(games)} /></b><span>Jogos</span></div><div><b><CountUp value={games ? Math.round((draws / games) * 100) : 0} />%</b><span>Empates</span></div></div></Panel>
      <div className="grid-2">
        {list('Melhor ataque', by((r) => r.gols_pro), (r) => r.gols_pro)}
        {list('Melhor defesa', by((r) => r.gols_contra, true), (r) => r.gols_contra)}
        {list('Mais vitórias', by((r) => r.vitorias), (r) => r.vitorias)}
        {list('Aproveitamento', by((r) => r.aproveitamento), (r) => r.aproveitamento)}
      </div>
    </div>
  );
}
