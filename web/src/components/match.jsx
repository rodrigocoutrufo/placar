import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Crest, CompLogo, Digit, LiveMinute, LiveDot, Tilt, Form, Item, Stagger, CountUp, ease } from './ui.jsx';
import { isLive, winnerSide, penScore, parseDate, fmtTime, fmtShort, relDay, STATUS_NAME, barColors, ZONES } from '../lib/format.js';
import { compTheme } from '../lib/themes.js';
import { getFavs } from '../lib/store.js';

// pisca quando o placar muda (gol)
function useGoalFlash(p) {
  const key = `${p.placar_mandante ?? ''}-${p.placar_visitante ?? ''}`;
  const prev = useRef(key);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== key && isLive(p)) { setFlash(true); const t = setTimeout(() => setFlash(false), 2600); prev.current = key; return () => clearTimeout(t); }
    prev.current = key;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return flash;
}

/* ---------- linha de jogo ---------- */
export function MatchRow({ p, showDate = false, comp = null }) {
  const w = winnerSide(p), live = isLive(p), pen = penScore(p), d = parseDate(p);
  const flash = useGoalFlash(p);
  const cls = (s) => (w ? (w === s ? 'win' : 'lose') : '');
  let st, sc;
  if (live) {
    st = <span className="st live"><LiveDot /><LiveMinute p={p} /></span>;
    sc = <span className="sc live"><Digit v={p.placar_mandante ?? 0} /><i>–</i><Digit v={p.placar_visitante ?? 0} /></span>;
  } else if (p.status === 'finalizado') {
    st = <span className="st">{showDate ? fmtShort(d) : 'Fim'}</span>;
    sc = <span className="sc done">{p.placar_mandante}<i>–</i>{p.placar_visitante}{pen && <em className="pen">pên. {pen[0]}–{pen[1]}</em>}</span>;
  } else if (STATUS_NAME[p.status]) {
    st = <span className="st">{showDate ? fmtShort(d) : ''}</span>;
    sc = <span className="sc time">{STATUS_NAME[p.status]}</span>;
  } else {
    st = <span className="st">{showDate ? relDay(d) : ''}</span>;
    sc = <span className="sc time">{fmtTime(p)}</span>;
  }
  return (
    <Item>
      <Link to={`/partida/${p.partida_id}`} className={`mrow ${live ? 'is-live' : ''} ${flash ? 'flash' : ''}`}>
        {st}
        <span className={`t h ${cls('h')}`}><b>{p.time_mandante.nome_popular}</b><Crest t={p.time_mandante} size={22} /></span>
        {sc}
        <span className={`t a ${cls('a')}`}><Crest t={p.time_visitante} size={22} /><b>{p.time_visitante.nome_popular}</b></span>
        <span className="cmp">{comp && <CompLogo c={comp} size={16} />}</span>
      </Link>
    </Item>
  );
}

// jogos agrupados por campeonato, cada bloco com a cor do campeonato
export function CompBlocks({ groups }) {
  return (
    <Stagger className="cblocks">
      {groups.map(({ c, ps }) => {
        const th = compTheme(c);
        return (
          <Item key={c.campeonato_id || c.nome} className="cblock" style={{ '--cacc': th.acc, '--cm1': th.m1, '--cm2': th.m2 }}>
            <Link to={`/campeonato/${c.campeonato_id}`} className="cblock-head">
              <span className="cb-logo"><CompLogo c={c} size={22} dark /></span>
              <b>{c.nome_popular || c.nome}</b>
              <span className="cb-n">{ps.length} {ps.length === 1 ? 'jogo' : 'jogos'}</span>
            </Link>
            <Stagger>{ps.map((p) => <MatchRow key={p.partida_id} p={p} />)}</Stagger>
          </Item>
        );
      })}
    </Stagger>
  );
}

/* ---------- cartão grande de jogo (destaques / ao vivo) ---------- */
export function ScoreCard({ p, comp, why }) {
  const H = p.time_mandante, A = p.time_visitante, live = isLive(p), w = winnerSide(p);
  const [ch, ca] = barColors(H, A);
  const d = parseDate(p);
  const showScore = live || p.status === 'finalizado';
  const flash = useGoalFlash(p);
  const row = (t, g, side) => (
    <div className={`sc-row ${w && w !== side ? 'lose' : ''}`}>
      <Crest t={t} size={36} /><b>{t.nome_popular}</b>
      <span className="sc-g">{showScore ? <Digit v={g ?? 0} /> : ''}</span>
    </div>
  );
  return (
    <Tilt className={`scard ${live ? 'is-live' : ''} ${flash ? 'flash' : ''}`} style={{ '--hc': ch, '--ac': ca }}>
      <Link to={`/partida/${p.partida_id}`} className="scard-in">
        <span className="scard-slab h" /><span className="scard-slab a" />
        <div className="sc-top">
          {comp && <CompLogo c={comp} size={16} />}<span className="cn">{(comp && (comp.nome_popular || comp.nome)) || ''}</span>
          <span className={`sc-st ${live ? 'live' : ''}`}>
            {live ? <><LiveDot /><LiveMinute p={p} /></> : p.status === 'finalizado' ? 'Encerrado' : STATUS_NAME[p.status] || `${relDay(d)} · ${fmtTime(p)}`}
          </span>
        </div>
        {row(H, p.placar_mandante, 'h')}
        {row(A, p.placar_visitante, 'a')}
        {why && <div className="sc-why">{why}</div>}
        <span className="scard-glare" />
      </Link>
    </Tilt>
  );
}

// faixa que arrasta para os lados
export function Rail({ children, className = '' }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(0, el.scrollWidth - el.parentElement.clientWidth)));
    ro.observe(el); ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div className={`rail ${className}`}>
      <motion.div ref={ref} className="rail-track" drag={w > 0 ? 'x' : false} dragConstraints={{ left: -w, right: 0 }} dragElastic={0.08}
        initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease }}>
        {children}
      </motion.div>
    </div>
  );
}

/* ---------- tabela de classificação ---------- */
export function Standings({ rows, campId, compact = false, highlight = [] }) {
  const favs = getFavs();
  const zones = [...new Set(rows.map((r) => r.faixa_classificacao).filter((z) => ZONES[z]))];
  const maxPts = Math.max(1, ...rows.map((r) => r.pontos || 0));
  return (
    <div className="tbl-wrap">
      <table className={`tbl ${compact ? 'compact' : ''}`}>
        <thead><tr><th>#</th><th className="l">Time</th><th>J</th>{!compact && <><th className="hs">V</th><th className="hs">E</th><th className="hs">D</th><th className="hs">Gols</th></>}<th>SG</th><th>P</th>{!compact && <th className="hs l">Últimos</th>}</tr></thead>
        <motion.tbody variants={{ show: { transition: { staggerChildren: 0.025 } } }} initial="hidden" animate="show">
          {rows.map((r) => {
            const z = ZONES[r.faixa_classificacao];
            const hl = highlight.includes(+r.time.time_id) || (!highlight.length && favs[r.time.time_id]);
            return (
              <motion.tr key={r.time.time_id} className={hl ? 'hl' : ''} variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0, transition: { duration: 0.35, ease } } }}>
                <td className="pos" style={{ '--z': z ? z[1] : 'transparent' }}>{r.posicao}</td>
                <td className="team l"><Link to={`/time/${r.time.time_id}?c=${campId}`}><Crest t={r.time} size={22} /><span>{r.time.nome_popular}</span></Link></td>
                <td>{r.jogos}</td>
                {!compact && <><td className="hs">{r.vitorias}</td><td className="hs">{r.empates}</td><td className="hs">{r.derrotas}</td><td className="hs">{r.gols_pro}:{r.gols_contra}</td></>}
                <td className={r.saldo_gols > 0 ? 'pos-gd' : r.saldo_gols < 0 ? 'neg-gd' : ''}>{r.saldo_gols > 0 ? '+' : ''}{r.saldo_gols}</td>
                <td className="pts"><span className="pts-bar" style={{ '--w': `${(r.pontos / maxPts) * 100}%` }} /><b>{r.pontos}</b></td>
                {!compact && <td className="hs l"><Form f={r.ultimos_jogos} /></td>}
              </motion.tr>
            );
          })}
        </motion.tbody>
      </table>
      {zones.length > 0 && !compact && <div className="legend">{zones.map((z) => <span key={z} style={{ '--c': ZONES[z][1] }}>{ZONES[z][0]}</span>)}</div>}
    </div>
  );
}

/* ---------- ranking (artilharia, assistências) ---------- */
export function RankList({ list, k, unit = '' }) {
  const max = Math.max(1, ...list.map((s) => s[k] || 0));
  return (
    <Stagger className="rank">
      {list.map((s, i) => (
        <Item key={s.atleta.atleta_id}>
          <Link className="rank-row" to={`/jogador/${s.atleta.atleta_id}`}>
            <span className="n">{i + 1}</span>
            <Crest t={s.time} size={26} />
            <span className="who"><b>{s.atleta.nome_popular}</b><small>{s.time ? s.time.nome_popular : ''}{s.jogos ? ` · ${s.jogos} jogos` : ''}</small></span>
            <span className="rbar"><motion.i initial={{ width: 0 }} animate={{ width: `${(s[k] / max) * 100}%` }} transition={{ duration: 0.9, ease, delay: 0.1 + i * 0.03 }} /></span>
            <span className="v"><CountUp value={s[k]} />{unit && <small>{unit}</small>}</span>
          </Link>
        </Item>
      ))}
    </Stagger>
  );
}
