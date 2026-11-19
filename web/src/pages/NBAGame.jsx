import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { LOGO } from '../lib/themes.js';
import { fmtDT } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Digit, LiveDot, Watch, Reveal, ease } from '../components/ui.jsx';
import { ShotChart } from '../components/ShotChart.jsx';

const COLS = ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF', '+/-'];
const PT = { MIN: 'Min', PTS: 'Pts', REB: 'Reb', AST: 'Ast', FG: 'Arr.', '3PT': '3 pts', FT: 'LL', STL: 'Rb', BLK: 'Toc', TO: 'Err', PF: 'Flt', '+/-': '+/-' };
const HIDE = new Set(['FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF']);

export default function NBAGame() {
  const { id } = useParams();
  const [tab, setTab] = useState('resumo');
  const [side, setSide] = useState('casa');
  const first = useApi(`/esportes/nba/jogo/${id}`, { ttl: 15_000, critical: true });
  const g0 = first.data;
  const q = useApi(`/esportes/nba/jogo/${id}`, { ttl: 15_000, refetch: g0 && g0.status === 'andamento' ? 15_000 : false });
  const tv = useApi('/transmissoes', { ttl: 3_600_000 });
  const g = q.data || g0;
  if (!g) return <><Skel h={320} /><Skel h={400} /></>;
  const live = g.status === 'andamento';
  const H = g.casa, A = g.fora;
  const w = tv.data && tv.data.campeonatos && tv.data.campeonatos.nba ? { ...tv.data.campeonatos.nba, atualizado_em: tv.data.atualizado_em } : null;
  const periods = Math.max(4, (H.parciais || []).length, (A.parciais || []).length);
  const team = (t, s) => (
    <Link to={`/nba/time/${t.id}`} className={`sb-team ${s}`}>
      <motion.img className="sb-nba-logo" src={t.logo} alt="" initial={{ opacity: 0, scale: 0.5, x: s === 'home' ? -40 : 40 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18 }} />
      <b>{t.nome}</b><small>{t.recorde} · {s === 'home' ? 'visitante' : 'casa'}</small>
    </Link>
  );
  return (
    <>
      <section className={`scoreboard nba-sb ${live ? 'is-live' : ''}`} style={{ '--hc': A.cor || '#334', '--ac': H.cor || '#445' }}>
        <motion.span className="sb-slab h" initial={{ x: '-100%' }} animate={{ x: 0 }} transition={{ duration: 0.7, ease }} />
        <motion.span className="sb-slab a" initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.7, ease }} />
        <div className="sb-top"><Link to="/nba" className="sb-comp"><img src={LOGO.nba} alt="" /><span>NBA{g.titulo ? ` · ${g.titulo}` : ''}</span></Link></div>
        <div className="sb-grid">
          {team(A, 'home')}
          <div className="sb-center">
            {g.status === 'agendado' ? <div className="sb-score time">{g.hora}</div>
              : <div className="sb-score led-font"><Digit v={A.placar ?? 0} /><i>:</i><Digit v={H.placar ?? 0} /></div>}
            <div className={`sb-status ${live ? 'live' : ''}`}>{live && <LiveDot />}{g.status === 'agendado' ? fmtDT(g.data_iso, { weekday: 'short', day: 'numeric', month: 'short' }) : g.periodo}</div>
          </div>
          {team(H, 'away')}
        </div>
        {g.local && <div className="sb-info"><span>{g.local}</span></div>}
      </section>

      {g.status !== 'agendado' && (
        <Panel className="flush linescore">
          <table className="tbl"><thead><tr><th className="l" />{Array.from({ length: periods }, (_, i) => <th key={i}>{i < 4 ? `${i + 1}º` : `P${i - 3}`}</th>)}<th>Total</th></tr></thead>
            <tbody>{[A, H].map((t) => <tr key={t.id}><td className="team l"><img className="crest" src={t.logo} alt="" width="20" height="20" /> <b>{t.sigla}</b></td>{Array.from({ length: periods }, (_, i) => <td key={i}>{t.parciais && t.parciais[i] != null ? t.parciais[i] : '–'}</td>)}<td className="pts"><b>{t.placar ?? '–'}</b></td></tr>)}</tbody></table>
        </Panel>
      )}

      <div className="sticky-tabs">
        <nav className="tabs">{[['resumo', 'Resumo'], ['box', 'Box score'], ['arremessos', 'Arremessos'], ['lances', 'Lances']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{tab === k && <motion.span layoutId="tab-nbag" className="tab-ind" />}</button>
        ))}</nav>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          {tab === 'box' ? (
            <Panel className="flush">
              <div className="seg">{[['casa', H], ['fora', A]].map(([k, t]) => <button key={k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}><img src={t.logo} alt="" width="18" /> {t.curto}{side === k && <motion.span layoutId="seg-nba" className="seg-ind" />}</button>)}</div>
              {g.box && g.box[side] ? <Box b={g.box[side]} title={side === 'casa' ? H.curto : A.curto} /> : <Empty>O box score aparece quando o jogo começa.</Empty>}
            </Panel>
          ) : tab === 'arremessos' ? (
            <Panel><Head sub="cada arremesso de quadra, do lance a lance">{live && <LiveDot />} Mapa de arremessos</Head><ShotChart shots={g.arremessos} home={H} away={A} /></Panel>
          ) : tab === 'lances' ? (
            <Panel>
              <Head sub="mais recentes primeiro">{live && <LiveDot />} Lances</Head>
              <Stagger className="plays">{(g.lances || []).slice(0, 120).map((p, i) => (
                <Item key={i} className={`play ${p.cesta ? 'score' : ''} ${p.lado || ''}`}>
                  <span className="pq">{p.periodo ? `${p.periodo <= 4 ? p.periodo + 'º' : 'P' + (p.periodo - 4)} · ` : ''}{p.relogio}</span>
                  <span className="pt">{p.cesta && p.valor ? <b className="pv">+{p.valor}</b> : null}{p.texto}</span>
                  <span className="ps">{p.placar}</span>
                </Item>
              ))}</Stagger>
              {!(g.lances || []).length && <Empty>Os lances aparecem aqui em tempo real.</Empty>}
            </Panel>
          ) : (
            <div className="grid-main">
              <div className="col">
                <WinChart series={g.chance_vitoria} home={H} away={A} />
                <StatsNBA g={g} />
                {!(g.estatisticas || []).length && !g.chance_vitoria && <Panel><Empty>O jogo ainda não começou. Placar, estatísticas e chance de vitória aparecem aqui ao vivo.</Empty></Panel>}
              </div>
              <aside className="col side">
                {g.status !== 'finalizado' && <Watch w={w} />}
                {(g.lesoes || []).filter((x) => x.jogadores.length).map((x) => (
                  <Panel key={x.time}><Head>Desfalques · {(x.time === 'casa' ? H : A).curto}</Head><div className="pad small">{x.jogadores.map((j) => `${j.nome} (${j.status || ''})`).join(', ')}</div></Panel>
                ))}
              </aside>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function Box({ b, title }) {
  const cols = COLS.filter((c) => b.colunas.includes(c));
  const row = (p) => (
    <tr key={p.id} className={p.nao_jogou ? 'dnp' : ''}>
      <td className="team l"><a href={`#/nba/jogador/${p.id}`} className="bx-p">{p.foto && <img src={p.foto} alt="" />}<span><b>{p.curto || p.nome}</b><small>{p.posicao}{p.camisa ? ` · #${p.camisa}` : ''}</small></span></a></td>
      {p.nao_jogou ? <td colSpan={cols.length} className="l muted small">Não jogou</td> : cols.map((c) => <td key={c} className={`${c === 'PTS' ? 'pts' : ''} ${HIDE.has(c) ? 'hs' : ''}`}>{p.stats[c] ?? ''}</td>)}
    </tr>
  );
  return (
    <div className="tbl-wrap"><table className="tbl box">
      <thead><tr><th className="l">{title}</th>{cols.map((c) => <th key={c} className={HIDE.has(c) ? 'hs' : ''}>{PT[c] || c}</th>)}</tr></thead>
      <tbody>
        <tr className="sub-h"><td colSpan={cols.length + 1}>Titulares</td></tr>{b.titulares.map(row)}
        <tr className="sub-h"><td colSpan={cols.length + 1}>Reservas</td></tr>{b.reservas.map(row)}
        <tr className="tot"><td className="l"><b>Total</b></td>{cols.map((c) => <td key={c} className={HIDE.has(c) ? 'hs' : ''}>{b.totais[c] ?? ''}</td>)}</tr>
      </tbody>
    </table></div>
  );
}

// chance de vitória ao longo do jogo: a linha se desenha
function WinChart({ series, home, away }) {
  if (!series || series.length < 3) return null;
  const W = 600, H = 170, n = series.length - 1;
  const pts = series.map((v, i) => [(i / n) * W, H - (v / 100) * H]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = series[series.length - 1];
  const cH = home.cor || '#ff7a1a', cA = away.cor || '#888';
  return (
    <Reveal>
      <Panel>
        <Head sub={`${home.sigla} ${Math.round(last)}% · ${away.sigla} ${Math.round(100 - last)}%`}>Chance de vitória</Head>
        <svg className="wp" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs><clipPath id="wt"><rect x="0" y="0" width={W} height={H / 2} /></clipPath><clipPath id="wb"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath></defs>
          <motion.path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={cH} clipPath="url(#wt)" initial={{ opacity: 0 }} animate={{ opacity: 0.25 }} transition={{ delay: 1 }} />
          <motion.path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={cA} clipPath="url(#wb)" initial={{ opacity: 0 }} animate={{ opacity: 0.25 }} transition={{ delay: 1 }} />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="mid" />
          {[1, 2, 3].map((q) => <line key={q} x1={(W * q) / 4} x2={(W * q) / 4} y1="0" y2={H} className="q" />)}
          <motion.path d={line} fill="none" stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease }} />
        </svg>
        <div className="wp-legend"><span><img src={home.logo} alt="" width="16" /> {home.curto} acima</span><span>1º · 2º · 3º · 4º quarto</span><span>{away.curto} abaixo <img src={away.logo} alt="" width="16" /></span></div>
      </Panel>
    </Reveal>
  );
}

function StatsNBA({ g }) {
  const list = g.estatisticas || [];
  if (!list.length) return null;
  return (
    <Panel>
      <Head sub={`${g.casa.sigla} · ${g.fora.sigla}`}>Estatísticas</Head>
      <div className="stats" style={{ '--ch': g.casa.cor || '#ff7a1a', '--ca': g.fora.cor || '#888' }}>
        {list.map((s) => {
          const a = parseFloat(s.casa) || 0, b = parseFloat(s.fora) || 0, tot = a + b || 1;
          const lower = /Erros|Faltas/.test(s.nome), la = lower ? a < b : a > b, lb = lower ? b < a : b > a;
          return (
            <div key={s.nome} className="st">
              <div className="st-top"><b className={la ? 'lead' : ''}>{s.casa}</b><span>{s.nome}</span><b className={lb ? 'lead' : ''}>{s.fora}</b></div>
              <div className="st-bars">
                <span><motion.i className={`h ${la ? 'lead' : ''}`} initial={{ width: 0 }} whileInView={{ width: `${(a / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /></span>
                <span><motion.i className={`a ${lb ? 'lead' : ''}`} initial={{ width: 0 }} whileInView={{ width: `${(b / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /></span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
