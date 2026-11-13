// Disputa de pênaltis. Cobrando: toque onde quer chutar e pare a barra de força na faixa verde.
// Defendendo: o cobrador corre para a bola e você tem um instante para escolher onde pular.
// A força de cada time vem da posição na tabela; cobradores e goleiros são os do elenco real.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchCached, soft } from '../lib/api.js';
import { useComps } from '../lib/data.js';
import { store, getFavs, useStoreVersion } from '../lib/store.js';
import { flattenTable, kitColor, norm, shortName } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Crest, CountUp, Icon, ease } from '../components/ui.jsx';

const G = { l: 90, r: 310, t: 62, b: 172 }, SPOT = { x: 200, y: 262 }, KEEPER = { x: 200, y: 172 };
const LEVELS = { facil: { read: 0.22, reach: 0.86, mine: 1.22, window: 2400, label: 'Fácil' }, normal: { read: 0.38, reach: 1, mine: 1, window: 1900, label: 'Normal' }, dificil: { read: 0.55, reach: 1.12, mine: 0.86, window: 1450, label: 'Difícil' } };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const penStats = () => store.get('placar.pen', { v: 0, d: 0 });

function Shell({ children, side }) {
  return (
    <>
      <div className="game-head"><Link className="ibtn" to="/minijogos" aria-label="Voltar">{Icon.left}</Link><motion.h1 className="page-title" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>Disputa de pênaltis</motion.h1></div>
      <div className="grid-main"><div className="col">{children}</div><aside className="col side">{side}</aside></div>
    </>
  );
}
function Side() {
  useStoreVersion();
  const s = penStats();
  const conv = s.chutes ? Math.round((s.gols / s.chutes) * 100) : 0, def = s.defTot ? Math.round((s.defesas / s.defTot) * 100) : 0;
  return (
    <>
      <Panel><Head>Seu histórico</Head><div className="kpi-grid"><div><b>{s.v}</b><span>Vitórias</span></div><div><b>{s.d}</b><span>Derrotas</span></div><div><b>{conv}%</b><span>Conversão</span></div><div><b>{def}%</b><span>Defesas</span></div><div><b>{s.melhorSeq || 0}</b><span>Melhor sequência</span></div></div></Panel>
      <Panel><Head>Como jogar</Head><ol className="how">
        <li><b>Mire.</b> Toque no gol onde quer chutar. Cantos são mais difíceis para o goleiro, mas a bola pode ir para fora.</li>
        <li><b>Força.</b> Pare a barra na faixa verde. Forte demais a bola sobe; fraca, o goleiro chega.</li>
        <li><b>Defenda.</b> Quando o adversário correr para a bola, toque onde você vai pular.</li></ol></Panel>
    </>
  );
}

export default function Penalties() {
  const { data: comps } = useComps();
  const leaguesQ = useQuery({
    queryKey: ['pen-leagues'], enabled: !!comps, staleTime: 600_000,
    queryFn: () => Promise.all(comps.filter((c) => c.tipo === 'Pontos Corridos').slice(0, 8).map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/tabela`, 600_000)).then((t) => {
      const rows = flattenTable(t || []).flatMap((g) => g.rows);
      return { c, teams: rows.map((r, i) => ({ ...r.time, forca: rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5 })) };
    }))).then((l) => l.filter((x) => x.teams.length)),
  });
  const [me, setMe] = useState(null);
  const [cpu, setCpu] = useState(null);
  const [level, setLevel] = useState(() => store.get('placar.pen.nivel', 'normal'));
  const [match, setMatch] = useState(null);
  const leagues = leaguesQ.data;
  const all = leagues ? leagues.flatMap((x) => x.teams) : [];
  useEffect(() => {
    if (!leagues || me) return;
    const fav = Object.values(getFavs())[0];
    const m = all.find((t) => fav && +t.time_id === +fav.time_id) || leagues[0].teams[0];
    setMe(m);
    setCpu(leagues[0].teams.find((t) => t.time_id !== m.time_id && t.forca > 0.6) || all.find((t) => t.time_id !== m.time_id));
  }, [leagues]); // eslint-disable-line react-hooks/exhaustive-deps
  const squad = async (t) => {
    const list = +t.time_id >= 800000000 ? await soft(fetchCached(`/times/${t.time_id}/elenco`, 3_600_000)) || [] : [];
    const pos = (x) => norm(((x.posicao || {}).nome || '') + ' ' + ((x.posicao || {}).sigla || ''));
    const gk = list.find((x) => /gol|goalkeeper|\bg\b/.test(pos(x)));
    const order = (x) => (/ata|forward|atac|centroav|ponta/.test(pos(x)) ? 0 : /mei|midfield|vol/.test(pos(x)) ? 1 : /gol|goalkeeper/.test(pos(x)) ? 9 : 2);
    const kickers = shuffle(list.filter((x) => x !== gk)).sort((a, b) => order(a) - order(b)).slice(0, 11).map((x) => shortName(x.atleta.nome_popular));
    return { kickers: kickers.length >= 5 ? kickers : ['Cobrador 1', 'Cobrador 2', 'Cobrador 3', 'Cobrador 4', 'Cobrador 5'], keeper: gk ? shortName(gk.atleta.nome_popular) : 'Goleiro' };
  };
  const [loading, setLoading] = useState(false);
  const start = async () => { setLoading(true); const [a, b] = await Promise.all([squad(me), squad(cpu)]); setLoading(false); setMatch({ id: Date.now(), sqMe: a, sqCpu: b }); };

  if (!leagues || !me) return <Shell side={<Side />}><Skel h={460} /></Shell>;
  if (all.length < 2) return <Shell side={<Side />}><Panel><Empty>Sem times disponíveis agora.</Empty></Panel></Shell>;
  if (match) return <Shell side={<Side />}><Shootout key={match.id} me={me} cpu={cpu} level={level} sqMe={match.sqMe} sqCpu={match.sqCpu} again={start} teams={() => setMatch(null)} /></Shell>;
  const stars = (f) => <span className="pen-stars" title="Força pela posição na tabela">{[0.2, 0.4, 0.6, 0.8, 1].map((s) => <i key={s} className={f >= s - 0.1 ? 'on' : ''}>★</i>)}</span>;
  const select = (sel, onChange) => (
    <select className="pen-sel" value={sel.time_id} onChange={(e) => onChange(all.find((t) => String(t.time_id) === e.target.value))}>
      {leagues.map((l) => <optgroup key={l.c.campeonato_id} label={l.c.nome_popular}>{l.teams.map((t) => <option key={t.time_id} value={t.time_id}>{t.nome_popular}</option>)}</optgroup>)}
    </select>
  );
  return (
    <Shell side={<Side />}>
      <Panel className="pen-setup">
        <div className="pen-teams">
          <div className="pen-pick" style={{ '--kit': kitColor(me) }}><small>Seu time</small><motion.div key={me.time_id} className="pen-crest" initial={{ scale: 0.5, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><Crest t={me} size={96} /></motion.div>{select(me, (t) => { setMe(t); if (t.time_id === cpu.time_id) setCpu(all.find((x) => x.time_id !== t.time_id)); })}{stars(me.forca)}</div>
          <span className="pen-vs">VS</span>
          <div className="pen-pick" style={{ '--kit': kitColor(cpu) }}><small>Adversário</small><motion.div key={cpu.time_id} className="pen-crest" initial={{ scale: 0.5, rotate: 20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><Crest t={cpu} size={96} /></motion.div>{select(cpu, setCpu)}{stars(cpu.forca)}</div>
        </div>
        <div className="seg center">{Object.entries(LEVELS).map(([k, v]) => <button key={k} className={k === level ? 'on' : ''} onClick={() => { setLevel(k); store.set('placar.pen.nivel', k); }}>{v.label}{k === level && <motion.span layoutId="seg-pen" className="seg-ind" />}</button>)}</div>
        <button className="btn btn-primary btn-block" onClick={start} disabled={loading}>{loading ? <span className="spin" /> : 'Ir para a marca do pênalti'}</button>
      </Panel>
    </Shell>
  );
}

function Shootout({ me, cpu, level, sqMe, sqCpu, again, teams }) {
  const L = LEVELS[level];
  const [kick, setKick] = useState({ me: [], cpu: [] });
  const [turn, setTurn] = useState(() => (Math.random() < 0.5 ? 'me' : 'cpu'));
  const [phase, setPhase] = useState('aim'); // aim | power | defend | flight | done
  const [aim, setAim] = useState(null), [hover, setHover] = useState(null), [dive, setDive] = useState(null);
  const [ball, setBall] = useState({ x: SPOT.x, y: SPOT.y, s: 1, ms: 0 });
  const [keeper, setKeeper] = useState({ dx: 0, dy: 0, rot: 0, ms: 0 });
  const [flash, setFlash] = useState(null);
  const [msg, setMsg] = useState(null);
  const [kicking, setKicking] = useState(false);
  const [netHit, setNetHit] = useState(false);
  const power = useRef(0), dir = useRef(1), raf = useRef(0), timer = useRef(0), mark = useRef(null), svg = useRef(null);
  const session = useRef({ gols: 0, chutes: 0, defesas: 0, defTot: 0 });
  const diveRef = useRef(null);
  const first = useRef(turn);

  const decided = (k) => {
    const a = k.me.filter(Boolean).length, b = k.cpu.filter(Boolean).length;
    const ra = Math.max(0, 5 - k.me.length), rb = Math.max(0, 5 - k.cpu.length);
    if (k.me.length <= 5 && k.cpu.length <= 5) {
      if (a + ra < b || b + rb < a) return a > b ? 'me' : 'cpu';
      if (k.me.length === 5 && k.cpu.length === 5 && a !== b) return a > b ? 'me' : 'cpu';
      return null;
    }
    return k.me.length === k.cpu.length && a !== b ? (a > b ? 'me' : 'cpu') : null;
  };
  const winner = decided(kick);
  const kickerName = turn === 'me' ? sqMe.kickers[kick.me.length % sqMe.kickers.length] : sqCpu.kickers[kick.cpu.length % sqCpu.kickers.length];
  const roundN = Math.max(kick.me.length, kick.cpu.length) + (kick[turn].length === Math.max(kick.me.length, kick.cpu.length) ? 1 : 0);

  // começo de cada cobrança
  useEffect(() => {
    if (winner) return undefined;
    setBall({ x: SPOT.x, y: SPOT.y, s: 1, ms: 0 }); setKeeper({ dx: 0, dy: 0, rot: 0, ms: 0 }); setAim(null); setDive(null); diveRef.current = null; setKicking(false); setNetHit(false); setFlash(null);
    if (turn === 'me') { setPhase('aim'); setMsg(<><b>{kickerName}</b> vai bater. <span>Toque no gol onde quer chutar.</span></>); }
    else {
      setPhase('defend'); setMsg(<><b>{kickerName}</b> corre para a bola… <span>Toque onde você vai pular!</span></>);
      timer.current = setTimeout(cpuShoot, L.window);
    }
    return () => { clearTimeout(timer.current); cancelAnimationFrame(raf.current); };
  }, [kick.me.length + kick.cpu.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (e) => { const s = svg.current; const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(s.getScreenCTM().inverse()); };
  const inGoal = (p) => p.x > G.l - 40 && p.x < G.r + 40 && p.y > G.t - 35 && p.y < G.b + 6;
  const reach = (rating, f) => 29 * (1 + 0.2 * rating) * f;
  const outcome = (b, k, R, slow) => {
    const near = Math.abs(b.x - G.l) < 5 || Math.abs(b.x - G.r) < 5 || (Math.abs(b.y - G.t) < 5 && b.x > G.l && b.x < G.r);
    if (near && b.y > G.t - 5) return 'trave';
    if (b.x < G.l || b.x > G.r || b.y < G.t) return 'fora';
    const kk = k || { x: KEEPER.x, y: 130 };
    return Math.hypot(b.x - kk.x, (b.y - kk.y) * 1.15) <= R * (slow ? 1.35 : 1) ? 'defesa' : 'gol';
  };
  const moveKeeper = (to, slow) => { if (!to) return; const dx = to.x - KEEPER.x, dy = Math.min(0, to.y - 125); setKeeper({ dx, dy, rot: Math.max(-80, Math.min(80, dx * 0.75)), ms: slow ? 550 : 380 }); };
  const fly = (to, ms, s = 0.55) => { setBall({ x: to.x, y: to.y, s, ms }); setKicking(true); };
  const finish = (scored, result, mine) => {
    const S = session.current;
    if (mine) { S.chutes++; if (scored) S.gols++; } else { S.defTot++; if (result === 'defesa') S.defesas++; }
    const T = { gol: mine ? ['GOOOL!', 'good'] : ['Gol deles', 'bad'], defesa: mine ? ['Defendeu!', 'bad'] : ['QUE DEFESA!', 'good'], fora: mine ? ['Pra fora!', 'bad'] : ['Pra fora!', 'good'], trave: mine ? ['Na trave!', 'bad'] : ['Na trave!', 'good'] }[result];
    setFlash({ text: T[0], cls: T[1], id: Date.now() });
    if (result === 'gol') setNetHit(true);
    const k = { ...kick, [turn]: [...kick[turn], scored] };
    const w = decided(k);
    if (w) {
      const s = penStats();
      s[w === 'me' ? 'v' : 'd']++;
      s.gols = (s.gols || 0) + S.gols; s.chutes = (s.chutes || 0) + S.chutes; s.defesas = (s.defesas || 0) + S.defesas; s.defTot = (s.defTot || 0) + S.defTot;
      s.seq = w === 'me' ? (s.seq || 0) + 1 : 0; s.melhorSeq = Math.max(s.melhorSeq || 0, s.seq);
      store.set('placar.pen', s);
    }
    setTimeout(() => { setKick(k); setTurn(turn === 'me' ? 'cpu' : 'me'); }, 1700);
  };
  const shoot = (p) => {
    setPhase('flight');
    const dev = Math.abs(p - 67.5), spread = 7 + Math.max(0, dev - 12.5) * 0.9, ang = Math.random() * Math.PI * 2, r = Math.random() * spread;
    const b = { x: aim.x + Math.cos(ang) * r, y: aim.y + Math.sin(ang) * r - (p > 85 ? (p - 85) * 2.4 : 0) };
    const slow = p < 35;
    const reads = Math.random() < L.read + cpu.forca * 0.12;
    const z = pick([[125, 95], [200, 95], [275, 95], [125, 150], [200, 150], [275, 150]]);
    const k = reads ? { x: Math.max(110, Math.min(290, b.x + (Math.random() - 0.5) * 50)), y: Math.max(85, Math.min(160, b.y + (Math.random() - 0.5) * 40)) } : { x: z[0], y: z[1] };
    const res = outcome(b, k, reach(cpu.forca, L.reach), slow);
    const ms = slow ? 620 : 360 + (100 - p) * 1.2;
    setTimeout(() => moveKeeper(k), 90);
    fly(res === 'fora' && b.y < G.t ? { x: b.x, y: b.y - 40 } : b, ms);
    if (res === 'defesa' || res === 'trave') setTimeout(() => fly({ x: b.x + (b.x < 200 ? -70 : 70), y: b.y + 60 }, 380, 0.6), ms + 20);
    setTimeout(() => finish(res === 'gol', res, true), ms + 120);
    setMsg(<><b>{kickerName}</b> bateu!</>);
  };
  function cpuShoot() {
    setPhase('flight');
    const miss = Math.random() < 0.05 + (1 - cpu.forca) * 0.07 + (level === 'facil' ? 0.06 : 0);
    let b;
    if (miss) b = pick([{ x: G.l - 20, y: 100 + Math.random() * 50 }, { x: G.r + 20, y: 100 + Math.random() * 50 }, { x: 140 + Math.random() * 120, y: G.t - 25 }]);
    else if (Math.random() < 0.6) b = { x: pick([G.l + 9 + Math.random() * 38, G.r - 9 - Math.random() * 38]), y: G.t + 9 + Math.random() * 95 };
    else b = { x: 150 + Math.random() * 100, y: G.t + 20 + Math.random() * 85 };
    const strong = Math.random() < 0.35 + cpu.forca * 0.2;
    const res = outcome(b, diveRef.current, reach(me.forca, L.mine) * (strong ? 0.82 : 1), false);
    moveKeeper(diveRef.current || { x: KEEPER.x, y: 130 });
    fly(res === 'fora' && b.y < G.t ? { x: b.x, y: b.y - 30 } : b, 400);
    if (res === 'defesa' || res === 'trave') setTimeout(() => fly({ x: b.x + (b.x < 200 ? -70 : 70), y: b.y + 60 }, 380, 0.6), 420);
    setTimeout(() => finish(res === 'gol', res, false), 520);
  }
  const onDown = (e) => {
    const p = pt(e);
    if (phase === 'aim' && inGoal(p)) {
      setAim({ x: p.x, y: p.y }); setPhase('power');
      setMsg(<><b>Força!</b> <span>Toque de novo para parar a barra na faixa verde.</span></>);
      power.current = 0; dir.current = 1;
      const speed = level === 'dificil' ? 2.3 : level === 'facil' ? 1.4 : 1.8;
      const tick = () => { power.current += dir.current * speed; if (power.current >= 100) { power.current = 100; dir.current = -1; } if (power.current <= 0) { power.current = 0; dir.current = 1; } if (mark.current) mark.current.style.left = `${power.current}%`; raf.current = requestAnimationFrame(tick); };
      raf.current = requestAnimationFrame(tick);
    } else if (phase === 'power') { cancelAnimationFrame(raf.current); shoot(power.current); }
    else if (phase === 'defend' && inGoal(p)) { const d = { x: Math.max(G.l - 10, Math.min(G.r + 10, p.x)), y: Math.max(G.t, Math.min(G.b - 8, p.y)) }; diveRef.current = d; setDive(d); }
  };
  const a = kick.me.filter(Boolean).length, b = kick.cpu.filter(Boolean).length;
  const dots = (arr) => Array.from({ length: Math.max(5, kick.me.length, kick.cpu.length) }, (_, i) => <motion.i key={i} className={arr[i] === true ? 'g' : arr[i] === false ? 'x' : ''} initial={arr[i] != null ? { scale: 0 } : false} animate={{ scale: 1 }}>{arr[i] === true ? '✓' : arr[i] === false ? '✕' : ''}</motion.i>);
  const kk = kitColor(turn === 'me' ? cpu : me), shirt = kitColor(turn === 'me' ? me : cpu);
  const won = winner === 'me';
  return (
    <>
      <Panel className="pen-board">
        <div className="pb-team"><Crest t={me} size={40} /><div><b>{me.nome_popular}</b><span className="pen-dots">{dots(kick.me)}</span></div></div>
        <div className="pb-score"><span><CountUp value={a} duration={0.4} /></span><em>×</em><span><CountUp value={b} duration={0.4} /></span><small>{winner ? 'Fim' : roundN <= 5 ? `Cobrança ${roundN} de 5` : 'Alternadas'}</small></div>
        <div className="pb-team r"><div><b>{cpu.nome_popular}</b><span className="pen-dots">{dots(kick.cpu)}</span></div><Crest t={cpu} size={40} /></div>
      </Panel>
      <Panel className={`pen-field ${phase}`}>
        <div className="pen-stage">
          <svg ref={svg} viewBox="0 0 400 300" className="pen-svg" onPointerDown={onDown} onPointerMove={(e) => { if (phase === 'aim') { const p = pt(e); setHover(inGoal(p) ? p : null); } }}>
            <defs>
              <pattern id="pnet" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M9 0L0 9M0 0l9 9" stroke="rgba(255,255,255,.55)" strokeWidth=".55" /></pattern>
              <pattern id="crowd" width="8" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="rgba(255,255,255,.18)" /><circle cx="6" cy="5" r="1.6" fill="rgba(255,255,255,.1)" /></pattern>
              <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f8f46" /><stop offset="1" stopColor="#1f6b33" /></linearGradient>
              <radialGradient id="light" cx=".5" cy="0" r=".9"><stop offset="0" stopColor="rgba(255,255,255,.25)" /><stop offset="1" stopColor="rgba(255,255,255,0)" /></radialGradient>
            </defs>
            <rect width="400" height="62" fill="#0e1a24" /><rect width="400" height="46" fill="url(#crowd)" />
            <rect y="46" width="400" height="14" fill="#0b0c0e" /><text x="200" y="56.5" textAnchor="middle" className="pen-ad">PLACAR · PLACAR · PLACAR · PLACAR · PLACAR</text>
            <rect y="60" width="400" height="240" fill="url(#grass)" />
            {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} y={60 + i * 40} width="400" height="20" fill="rgba(255,255,255,.035)" />)}
            <rect width="400" height="300" fill="url(#light)" />
            <path d={`M40 ${G.b + 18}H360M86 ${G.b}l-46 18M314 ${G.b}l46 18`} className="pen-line" />
            <path d="M0 236H400" className="pen-line" opacity=".7" /><ellipse cx={SPOT.x} cy={SPOT.y + 3} rx="4" ry="1.6" fill="rgba(255,255,255,.85)" />
            <rect x={G.l + 6} y={G.t + 6} width={G.r - G.l - 12} height={G.b - G.t - 6} fill="rgba(0,0,0,.18)" />
            <motion.rect x={G.l} y={G.t} width={G.r - G.l} height={G.b - G.t} fill="url(#pnet)" animate={netHit ? { scaleY: [1, 1.06, 0.98, 1], originY: 0 } : {}} transition={{ duration: 0.5 }} />
            <path d={`M${G.l} ${G.b}V${G.t}H${G.r}V${G.b}`} className="pen-post" />
            <g className="pen-keeper" style={{ transform: `translate(${keeper.dx}px, ${keeper.dy}px) rotate(${keeper.rot}deg)`, transitionDuration: `${keeper.ms}ms` }}>
              <ellipse cx="200" cy="173" rx="22" ry="4" fill="rgba(0,0,0,.25)" />
              <rect x="190" y="146" width="8" height="26" rx="3" fill="#222" /><rect x="202" y="146" width="8" height="26" rx="3" fill="#222" />
              <rect x="186" y="112" width="28" height="38" rx="9" fill={kk} />
              <rect x="166" y="104" width="22" height="8" rx="4" fill={kk} transform="rotate(-35 177 108)" /><rect x="212" y="104" width="22" height="8" rx="4" fill={kk} transform="rotate(35 223 108)" />
              <circle cx="166" cy="96" r="6" fill="#f4f4f4" stroke="#bbb" /><circle cx="234" cy="96" r="6" fill="#f4f4f4" stroke="#bbb" />
              <circle cx="200" cy="101" r="10" fill="#e7b48f" /><path d="M190 99a10 10 0 0 1 20 0" fill="#3a2a1e" />
            </g>
            {(aim || (phase === 'aim' && hover)) && <g transform={`translate(${(aim || hover).x} ${(aim || hover).y})`} className={`pen-aim ${aim ? 'locked' : ''}`}><circle r="11" fill="none" stroke="#fff" strokeWidth="2" /><path d="M-16 0h8M8 0h8M0 -16v8M0 8v8" stroke="#fff" strokeWidth="2" /></g>}
            {dive && <circle cx={dive.x} cy={dive.y} r="14" fill="rgba(255,255,255,.18)" stroke="#fff" strokeDasharray="4 3" />}
            <ellipse cx={SPOT.x} cy={SPOT.y + 10} rx="12" ry="3.5" fill="rgba(0,0,0,.3)" style={{ transition: `transform ${ball.ms}ms cubic-bezier(.2,.7,.3,1)`, transform: `translate(${ball.x - SPOT.x}px, ${Math.min(G.b + 2, ball.y + 30) - SPOT.y - 10}px) scale(${ball.s < 1 ? 0.5 : 1})` }} />
            <g style={{ transition: `transform ${ball.ms}ms cubic-bezier(.2,.7,.3,1)`, transform: `translate(${ball.x - SPOT.x}px, ${ball.y - SPOT.y}px) scale(${ball.s})`, transformOrigin: `${SPOT.x}px ${SPOT.y}px`, transformBox: 'view-box' }}>
              <circle cx={SPOT.x} cy={SPOT.y} r="11" fill="#fff" stroke="#333" strokeWidth="1" />
              <path d={`M${SPOT.x} ${SPOT.y - 4}l4 3-1.5 4.5h-5L${SPOT.x - 4} ${SPOT.y - 1}z`} fill="#222" />
            </g>
            <g className={`pen-kicker ${phase === 'defend' ? 'run' : ''} ${kicking ? 'kick' : ''}`}>
              <circle cx="232" cy="236" r="7" fill="#e7b48f" /><rect x="224" y="243" width="16" height="22" rx="6" fill={shirt} />
              <rect x="226" y="262" width="5" height="18" rx="2" fill="#222" /><rect x="234" y="262" width="5" height="18" rx="2" fill="#222" />
            </g>
          </svg>
          <AnimatePresence>{flash && <motion.div key={flash.id} className={`pen-flash ${flash.cls}`} initial={{ scale: 2.4, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}>{flash.text}</motion.div>}</AnimatePresence>
          {phase === 'power' && <div className="pen-power"><div className="pp-bar"><i className="pp-green" /><i className="pp-mark" ref={mark} /></div><span>Toque para chutar</span></div>}
          {phase === 'defend' && <div className="pen-timer"><motion.i initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: L.window / 1000, ease: 'linear' }} /></div>}
          <AnimatePresence>
            {winner && (
              <motion.div className={`pen-end ${won ? 'won' : ''}`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.5, ease }}>
                {won && <div className="confetti">{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ '--x': `${Math.random() * 100}%`, '--d': `${(Math.random() * 1.2).toFixed(2)}s`, '--c': ['#19d36b', '#ffd400', '#fff', kitColor(me)][i % 4] }} />)}</div>}
                <b>{won ? `${me.nome_popular} é campeão nos pênaltis!` : `${cpu.nome_popular} venceu nos pênaltis.`}</b>
                <span>{a} × {b} · você converteu {session.current.gols} de {session.current.chutes} e defendeu {session.current.defesas} de {session.current.defTot}</span>
                <div className="sim-actions"><button className="btn btn-primary" onClick={again}>Revanche</button><button className="btn" onClick={teams}>Trocar times</button></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className={`pen-msg ${phase === 'defend' ? 'hot' : ''}`}>{winner ? null : kick.me.length + kick.cpu.length === 0 && phase !== 'power' && phase !== 'flight' ? <>{first.current === 'me' ? <>Sorteio: <b>você começa batendo</b>. </> : <>Sorteio: <b>{cpu.nome_popular}</b> começa. </>}{msg}</> : msg}</div>
      </Panel>
    </>
  );
}
