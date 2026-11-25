// F1: aba "Temporada" (corrida pelo título, simulador, líderes e duelos internos) e a página de comparar pilotos.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Reveal, ease } from '../components/ui.jsx';

const flag = (src, w = 18) => (src ? <img className="flag" src={src} alt="" width={w} /> : null);
const cor = (p) => (p && p.equipe && p.equipe.cor) || '#888';
const fmt = (v) => (v == null ? '–' : Number.isInteger(v) ? v : String(v).replace('.', ','));

/* ---------- gráfico de várias linhas (pontos acumulados) ---------- */
// companheiros de equipe têm a mesma cor: o segundo da equipe vem tracejado
export function MultiLine({ series, labels, height = 300 }) {
  const [hover, setHover] = useState(null);
  const n = labels.length;
  if (n < 2 || !series.length) return null;
  const W = 720, H = height, PL = 40, PR = 96, PT = 14, PB = 28;
  const max = Math.max(1, ...series.map((s) => s.pontos[s.pontos.length - 1] || 0));
  const x = (i) => PL + (i / (n - 1)) * (W - PL - PR);
  const y = (v) => H - PB - (v / max) * (H - PT - PB);
  const seen = new Set();
  const lines = series.map((s) => { const dash = seen.has(s.cor); seen.add(s.cor); return { ...s, dash }; });
  // rótulos no fim das linhas sem se sobrepor
  const ends = lines.map((s, i) => ({ i, y: y(s.pontos[n - 1] || 0) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  const endY = Object.fromEntries(ends.map((e) => [e.i, e.y]));
  return (
    <div className="ml-wrap">
      <svg className="mv-chart ml" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pontos acumulados por etapa" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={PL} x2={W - PR} y1={y(max * f)} y2={y(max * f)} className="g" /><text x={PL - 6} y={y(max * f) + 4} textAnchor="end">{Math.round(max * f)}</text></g>)}
        {labels.map((l, i) => (i % Math.ceil(n / 12) === 0 || i === n - 1 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{l.rodada}</text> : null))}
        {hover != null && <line className="ml-cursor" x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} />}
        {lines.map((s, si) => (
          <g key={s.id} className={hover != null ? 'dim' : ''}>
            <motion.path d={s.pontos.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill="none" stroke={s.cor} strokeWidth={si < 3 ? 2.8 : 2}
              strokeDasharray={s.dash ? '6 4' : undefined} strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease, delay: si * 0.05 }} />
            <text x={W - PR + 8} y={endY[si] + 4} className="ml-lbl" style={{ fill: s.cor }}>{s.nome} {Math.round(s.pontos[n - 1] || 0)}</text>
          </g>
        ))}
        {/* faixas invisíveis para o cursor */}
        {labels.map((_, i) => <rect key={i} x={x(i) - (W - PL - PR) / (n - 1) / 2} y={PT} width={(W - PL - PR) / (n - 1)} height={H - PT - PB} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      </svg>
      {hover != null && (
        <div className="ml-tip">
          <b>Etapa {labels[hover].rodada} · {labels[hover].gp}</b>
          {[...lines].sort((a, b) => b.pontos[hover] - a.pontos[hover]).map((s) => <span key={s.id}><i style={{ background: s.cor }} />{s.nome}<em>{Math.round(s.pontos[hover])}</em></span>)}
        </div>
      )}
    </div>
  );
}

/* ---------- aba Temporada ---------- */
export function F1SeasonTab() {
  const { data: d, error } = useApi('/esportes/f1/temporada', { ttl: 600_000 });
  const [who, setWho] = useState('pilotos');
  if (error) return <Panel><Empty>Não foi possível carregar a temporada agora.</Empty></Panel>;
  if (!d) return <><Skel h={360} /><Skel h={300} /></>;
  const series = who === 'pilotos'
    ? d.evolucao.pilotos.map((s) => ({ id: s.piloto.id, nome: s.piloto.sobrenome, cor: cor(s.piloto), pontos: s.pontos }))
    : d.evolucao.equipes.slice(0, 8).map((s) => ({ id: s.equipe.id, nome: s.equipe.nome.replace(/ F1 Team$/, ''), cor: s.equipe.cor, pontos: s.pontos }));
  return (
    <div className="f1s">
      <Panel>
        <Head right={<div className="seg mini">{[['pilotos', 'Pilotos'], ['equipes', 'Equipes']].map(([k, l]) => <button key={k} type="button" className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>)}</div>}
          sub="pontos acumulados, etapa a etapa">Corrida pelo título</Head>
        <MultiLine series={series} labels={d.rodadas} />
      </Panel>
      <Simulator s={d.simulador} />
      <Reveal><Panel><Head sub={`${d.temporada}`}>Líderes da temporada</Head>
        <div className="ldr-grid">{d.lideres.filter((l) => l.id !== 'pontos').map((l) => (
          <div key={l.id} className="ldr">
            <h4>{l.nome}</h4>
            {l.lista.map((x, i) => (
              <Link key={x.piloto.id} to={`/f1/piloto/${x.piloto.id}`} className={`ldr-row ${i === 0 ? 'top' : ''}`} style={{ '--tc': cor(x.piloto) }}>
                <span className="p">{i + 1}</span>{i === 0 && x.piloto.foto_oficial ? <img className="ldr-face" src={x.piloto.foto_oficial} alt="" /> : <i className="tcb" />}
                <b>{x.piloto.sobrenome}</b><em>{fmt(x.valor)}</em>
              </Link>
            ))}
          </div>
        ))}</div></Panel></Reveal>
      <Reveal><Panel><Head right={<Link className="hd-link" to="/f1/comparar">Comparar pilotos →</Link>} sub="corrida · classificação">Duelos internos</Head>
        <Stagger className="tm-duels">{d.duelos.map((x) => <Item key={x.equipe.id}><TeamDuel x={x} /></Item>)}</Stagger>
      </Panel></Reveal>
    </div>
  );
}

function Split({ label, a, b, color }) {
  const t = a + b || 1;
  return (
    <div className="spl">
      <div className="spl-top"><b>{fmt(a)}</b><span>{label}</span><b>{fmt(b)}</b></div>
      <div className="spl-bar"><motion.i style={{ background: color }} initial={{ width: 0 }} whileInView={{ width: `${(a / t) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8, ease }} /><motion.i initial={{ width: 0 }} whileInView={{ width: `${(b / t) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8, ease }} /></div>
    </div>
  );
}

function TeamDuel({ x }) {
  const c = x.equipe.cor;
  return (
    <Link className="tm-duel" to={`/f1/comparar/${x.a.id}/${x.b.id}`} style={{ '--tc': c }}>
      <div className="tm-duel-h"><span><i className="tcb" style={{ background: c }} />{x.equipe.nome.replace(/ F1 Team$/, '')}</span><small>{x.rodadas} etapas juntos</small></div>
      <div className="tm-duel-n"><b>{x.a.sobrenome}</b><span>×</span><b>{x.b.sobrenome}</b></div>
      <Split label="Corrida" a={x.corrida[0]} b={x.corrida[1]} color={c} />
      <Split label="Classificação" a={x.classificacao[0]} b={x.classificacao[1]} color={c} />
    </Link>
  );
}

/* ---------- simulador do campeonato ---------- */
// A pessoa escolhe a posição de cada piloto nas etapas que faltam e vê a tabela final.
function Simulator({ s }) {
  const [picks, setPicks] = useState({}); // { "rodada:tipo": { piloto: posição } }
  const cols = useMemo(() => s.restantes.flatMap((r) => [...(r.sprint ? [{ k: `${r.rodada}:s`, r, sprint: true }] : []), { k: `${r.rodada}:c`, r, sprint: false }]), [s]);
  if (!cols.length || s.pilotos.length < 2) return null;
  const pts = (col, pos) => (pos ? (col.sprint ? s.pontos_sprint : s.pontos_corrida)[pos - 1] || 0 : 0);
  const pick = (col, id, pos) => setPicks((prev) => {
    const cur = { ...(prev[col.k] || {}) };
    for (const [o, p] of Object.entries(cur)) if (p === pos && o !== id) delete cur[o]; // uma posição por piloto
    if (pos) cur[id] = pos; else delete cur[id];
    return { ...prev, [col.k]: cur };
  });
  const table = s.pilotos.map((p, i) => {
    const extra = cols.reduce((a, c) => a + pts(c, (picks[c.k] || {})[p.piloto.id]), 0);
    const wins = cols.reduce((a, c) => a + (!c.sprint && (picks[c.k] || {})[p.piloto.id] === 1 ? 1 : 0), 0);
    return { ...p, antes: i + 1, extra, final: p.pontos + extra, vit: p.vitorias + wins };
  }).sort((a, b) => b.final - a.final || b.vit - a.vit || a.antes - b.antes);
  const any = Object.values(picks).some((o) => Object.keys(o).length);
  return (
    <Reveal><Panel className="fsim">
      <Head sub={s.decidido ? 'título decidido · simule as outras posições' : 'escolha as posições das etapas que faltam'} right={any ? <button type="button" className="hd-link" onClick={() => setPicks({})}>Limpar</button> : null}>Simulador do campeonato</Head>
      <div className="fsim-grid">
        <div className="tbl-wrap"><table className="tbl fsim-tbl">
          <thead><tr><th className="l">Piloto</th><th>Pts</th>{cols.map((c) => <th key={c.k} title={c.r.gp}>{c.r.gp.replace(/^GP (do|da|de) /, '')}{c.sprint ? <small> sprint</small> : ''}</th>)}</tr></thead>
          <tbody>{s.pilotos.map((p) => (
            <tr key={p.piloto.id}>
              <td className="l"><span className="fsim-n" style={{ '--tc': cor(p.piloto) }}><i className="tcb" />{p.piloto.sobrenome}</span></td>
              <td><b>{p.pontos}</b></td>
              {cols.map((c) => {
                const v = (picks[c.k] || {})[p.piloto.id] || 0;
                const max = c.sprint ? s.pontos_sprint.length : s.pontos_corrida.length;
                return (
                  <td key={c.k}>
                    <select className={`fsim-sel ${v ? 'on' : ''} ${v === 1 ? 'p1' : ''}`} value={v} onChange={(e) => pick(c, p.piloto.id, +e.target.value)} aria-label={`${p.piloto.sobrenome} em ${c.r.gp}${c.sprint ? ' (sprint)' : ''}`}>
                      <option value={0}>–</option>
                      {Array.from({ length: max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}º · {(c.sprint ? s.pontos_sprint : s.pontos_corrida)[i]} pts</option>)}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table></div>
        <div className="fsim-res">
          <h4>Tabela final</h4>
          <Stagger>{table.map((p, i) => {
            const mv = p.antes - (i + 1);
            return (
              <motion.div layout key={p.piloto.id} className={`fsim-row ${i === 0 ? "lead" : ""}`} style={{ '--tc': cor(p.piloto) }} transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
                <span className="p">{i + 1}</span><i className="tcb" /><b>{p.piloto.sobrenome}{!p.pode_mudar && <small className="fsim-lock" title="Ninguém mais alcança nem é alcançado"> garantido</small>}</b>
                {mv ? <span className={`mv ${mv > 0 ? 'up' : 'down'}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</span> : null}
                <em>{p.final}{p.extra ? <small> +{p.extra}</small> : null}</em>
              </motion.div>
            );
          })}</Stagger>
          <small className="muted">Empate em pontos: vence quem tem mais vitórias.</small>
        </div>
      </div>
    </Panel></Reveal>
  );
}

/* ---------- comparar dois pilotos ---------- */
const ROWS = [['pontos', 'Pontos'], ['vitorias', 'Vitórias'], ['podios', 'Pódios'], ['poles', 'Poles'], ['voltas_rapidas', 'Voltas mais rápidas'],
  ['q3', 'Vezes no Q3'], ['media_quali', 'Média na classificação', true], ['media_chegada', 'Média de chegada', true], ['melhor', 'Melhor resultado', true],
  ['ganhos', 'Posições ganhas'], ['abandonos', 'Abandonos', true]];

export function F1Compare() {
  const { a, b } = useParams();
  const nav = useNavigate();
  const list = useApi('/esportes/f1/temporada', { ttl: 600_000 });
  const ok = a && b && a !== b;
  const { data: c, error } = useApi(ok ? `/esportes/f1/comparar/${a}/${b}` : null, { ttl: 600_000, enabled: !!ok, keep: true });
  const pilots = (list.data && list.data.pilotos) || [];
  const set = (side, v) => { const x = side === 'a' ? [v, b] : [a, v]; nav(`/f1/comparar/${x[0] || pilots[0]?.id}/${x[1] || pilots[1]?.id}`, { replace: true }); };
  const pickA = a || (pilots[0] || {}).id, pickB = b || (pilots.find((p) => p.id !== pickA) || {}).id;
  const sel = (side, v) => (
    <select className="cmp-sel" value={v || ''} onChange={(e) => set(side, e.target.value)} aria-label={side === 'a' ? 'Primeiro piloto' : 'Segundo piloto'}>
      {pilots.map((p) => <option key={p.id} value={p.id} disabled={p.id === (side === 'a' ? pickB : pickA)}>{p.nome}{p.equipe ? ` · ${p.equipe.nome.replace(/ F1 Team$/, '')}` : ''}</option>)}
    </select>
  );
  useEffect(() => { if (!ok && pickA && pickB && pickA !== pickB) nav(`/f1/comparar/${pickA}/${pickB}`, { replace: true }); }, [ok, pickA, pickB]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>Comparar pilotos</motion.h1>
      <div className="cmp-pick">{sel('a', pickA)}<span>×</span>{sel('b', pickB)}</div>
      {error ? <Panel><Empty>Não foi possível comparar esses pilotos.</Empty></Panel> : !c ? <Skel h={420} /> : <CompareBody c={c} />}
    </>
  );
}

function CompareBody({ c }) {
  const A = c.a, B = c.b, ca = cor(A.piloto), cb0 = cor(B.piloto);
  const cb = ca === cb0 ? '#9aa4b1' : cb0; // companheiros: o segundo em cinza
  const card = (x, col) => (
    <Link className="cmp-card" to={`/f1/piloto/${x.piloto.id}`} style={{ '--tc': col }}>
      {x.piloto.foto_oficial ? <img src={x.piloto.foto_oficial} alt="" /> : <span className="cmp-ph" />}
      <span><small>{flag(x.piloto.bandeira)} {(x.piloto.equipe || {}).nome}</small><b>{x.piloto.nome}</b></span>
    </Link>
  );
  return (
    <div className="f1s">
      <div className="cmp-cards">{card(A, ca)}<span className="cmp-x">×</span>{card(B, cb)}</div>
      <div className="grid-2">
        <Panel><Head sub={`${c.duelo.rodadas} etapas em comum`}>Frente a frente</Head>
          <div className="pad">
            <Split label="Chegou à frente" a={c.duelo.corrida[0]} b={c.duelo.corrida[1]} color={ca} />
            <Split label="Classificou à frente" a={c.duelo.classificacao[0]} b={c.duelo.classificacao[1]} color={ca} />
            <Split label="Pontos nas etapas em comum" a={c.duelo.pontos[0]} b={c.duelo.pontos[1]} color={ca} />
          </div>
        </Panel>
        <Panel><Head>Números da temporada</Head>
          <div className="cmp-rows">{ROWS.map(([k, l, low]) => {
            const va = A[k], vb = B[k];
            const win = va == null || vb == null || va === vb ? 0 : (low ? va < vb : va > vb) ? 1 : 2;
            return <div key={k} className="cmp-row"><b className={win === 1 ? 'w' : ''} style={{ '--tc': ca }}>{fmt(va)}</b><span>{l}</span><b className={win === 2 ? 'w' : ''} style={{ '--tc': cb }}>{fmt(vb)}</b></div>;
          })}</div>
        </Panel>
      </div>
      <Panel><Head sub="pontos acumulados">Na temporada</Head>
        <MultiLine labels={c.etapas.map((e) => ({ rodada: e.rodada, gp: e.gp }))} height={260}
          series={[{ id: 'a', nome: A.piloto.sobrenome, cor: ca, pontos: c.evolucao.a }, { id: 'b', nome: B.piloto.sobrenome, cor: cb, pontos: c.evolucao.b }]
            .map((s) => ({ ...s, pontos: c.etapas.map((e) => s.pontos[c.evolucao.rodadas.indexOf(e.rodada)]) }))} />
      </Panel>
      <Panel className="flush"><Head>Etapa a etapa</Head>
        <div className="tbl-wrap"><table className="tbl cmp-tbl">
          <thead><tr><th className="l">Etapa</th><th title="Posição na classificação">{A.piloto.sigla} class.</th><th>{A.piloto.sigla}</th><th>{B.piloto.sigla}</th><th title="Posição na classificação">{B.piloto.sigla} class.</th></tr></thead>
          <tbody>{c.etapas.map((e) => {
            const pa = e.a && e.a.pos, pb = e.b && e.b.pos;
            const wa = e.a && e.b && (pa || 99) < (pb || 99), wb = e.a && e.b && (pb || 99) < (pa || 99);
            return (
              <tr key={e.rodada}>
                <td className="l"><Link to={`/f1/corrida/${e.rodada}`}>{e.rodada}. {e.gp.replace(/^GP (do|da|de) /, '')}</Link></td>
                <td className="small muted">{(e.a && e.a.quali) || '–'}</td>
                <td className={wa ? 'cmp-w' : ''} style={{ '--tc': ca }}><b>{e.a ? (pa || 'AB') : '–'}</b></td>
                <td className={wb ? 'cmp-w' : ''} style={{ '--tc': cb }}><b>{e.b ? (pb || 'AB') : '–'}</b></td>
                <td className="small muted">{(e.b && e.b.quali) || '–'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
