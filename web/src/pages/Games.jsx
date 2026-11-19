import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchCached, post, soft, useApi } from '../lib/api.js';
import { useComps, useAgenda } from '../lib/data.js';
import { useLive } from '../lib/live.js';
import { account, store, useStoreVersion } from '../lib/store.js';
import { dayKey, parseDate, fmtDay, fmtShort, fmtTime, flattenTable, norm } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Crest, CompLogo, CountUp, Tilt, Icon, isDark, ScrollRow, ease } from '../components/ui.jsx';
import Penalties from './Penalty.jsx';

export const best = (k) => store.get(`placar.game.${k}`, 0);
const setBest = (k, v) => { if (v > best(k)) store.set(`placar.game.${k}`, v); };
export const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
const todayKey = () => dayKey(new Date());

const GAMES = [
  ['palpites', 'Bolão', 'Palpite o placar dos jogos da semana. Placar exato vale 3 pontos; acertar o vencedor ou o empate, 1.', '#0b8a43', '2 × 1'],
  ['craque', 'Craque do dia', 'Um artilheiro novo por dia. A cada chute você descobre se acertou liga, time, posição, idade, país e gols.', '#1f4fd8', '?'],
  ['penaltis', 'Disputa de pênaltis', 'Escolha seu time e o adversário. Você cobra e defende: cinco para cada lado e, se empatar, alternadas.', '#c4006a', '⚽'],
  ['escudos', 'Quiz de escudos', 'Dez escudos, dez segundos cada. O escudo começa desfocado; quanto mais rápido acertar, mais pontos.', '#cf540a', '🛡'],
];

const getPal = () => store.get('placar.palpites', {});
function palScore(p, m) {
  if (!m || m.status !== 'finalizado' || m.placar_mandante == null) return null;
  if (p.h === m.placar_mandante && p.a === m.placar_visitante) return 3;
  return Math.sign(p.h - p.a) === Math.sign(m.placar_mandante - m.placar_visitante) ? 1 : 0;
}
function palStats() {
  const all = Object.values(getPal()), done = all.filter((p) => p.pts != null);
  return { total: all.length, pontos: done.reduce((a, p) => a + p.pts, 0), exatos: done.filter((p) => p.pts === 3).length, acertos: done.filter((p) => p.pts > 0).length, avaliados: done.length };
}
// com conta: o palpite também vai para o servidor (bolão com amigos; ele fecha o palpite no começo do jogo)
let pending = {}, timer = null;
function sendPick(id, h, a) {
  if (!account.user) return;
  pending[id] = { partida_id: +id, h, a };
  clearTimeout(timer);
  timer = setTimeout(() => { const ps = Object.values(pending); pending = {}; if (ps.length) post('/bolao/palpites', { palpites: ps }).catch(() => {}); }, 800);
}
// uma vez por sessão: manda os palpites de jogos futuros que estavam só neste aparelho
let synced = false;
function syncPicks(byId) {
  if (synced || !account.user) return;
  synced = true;
  const now = Date.now();
  const ps = Object.entries(getPal()).filter(([id]) => { const m = byId.get(+id); return m && m.status === 'agendado' && parseDate(m) > now; })
    .map(([id, p]) => ({ partida_id: +id, h: p.h, a: p.a }));
  for (let i = 0; i < ps.length; i += 80) post('/bolao/palpites', { palpites: ps.slice(i, i + 80) }).catch(() => {});
}
const slim = (m) => ({ h: m.time_mandante.nome_popular, a: m.time_visitante.nome_popular, he: m.time_mandante.escudo, ae: m.time_visitante.escudo, sh: m.placar_mandante, sa: m.placar_visitante, st: m.status, iso: m.data_realizacao_iso, c: m.campeonato && m.campeonato.nome_popular });

export default function Games() {
  const { game } = useParams();
  if (game === 'palpites') return <Bolao />;
  if (game === 'craque') return <Craque />;
  if (game === 'penaltis') return <Penalties />;
  if (game === 'escudos') return <Crests />;
  return <Hub />;
}

function Hub() {
  useStoreVersion();
  const pal = palStats(), cd = store.get('placar.craque.dia', {}), pen = store.get('placar.pen', { v: 0, d: 0 });
  const status = {
    palpites: pal.total ? `${pal.pontos} pontos · ${pal.total} palpites` : 'Nenhum palpite ainda',
    craque: cd.date === todayKey() ? (cd.won ? `Resolvido hoje em ${cd.guesses.length}` : cd.done ? 'Não foi hoje · volte amanhã' : `Em andamento · ${cd.guesses.length}/8`) : 'Desafio de hoje disponível',
    penaltis: pen.v + pen.d ? `${pen.v} vitórias · ${pen.d} derrotas` : 'Nenhuma disputa ainda',
    escudos: best('escudos') ? `Recorde: ${best('escudos')} pontos` : 'Sem recorde ainda',
  };
  const total = pal.pontos + (store.get('placar.craque.stats', {}).vitorias || 0) * 5 + (pen.v || 0) * 3 + Math.round(best('escudos') / 10);
  return (
    <>
      <section className="games-hero">
        <div><motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Minijogos</motion.small>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>Jogue com o futebol de verdade</motion.h1>
          <p>Times, artilheiros e jogos reais da temporada. {account.user ? 'Seu progresso fica salvo na sua conta.' : <><Link to="/entrar">Entre</Link> para salvar seu progresso em qualquer aparelho.</>}</p></div>
        <motion.div className="gh-score" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 15, delay: 0.2 }}><b><CountUp value={total} /></b><span>pontos de torcedor</span></motion.div>
      </section>
      <Stagger className="games-grid">
        {GAMES.map(([id, title, desc, color, art]) => (
          <Item key={id}>
            <Tilt className="game-card" style={{ '--gc': color }}>
              <Link to={`/minijogos/${id}`} className="gc-in">
                <span className="gc-art">{art}</span>
                <b>{title}</b><p>{desc}</p>
                <span className="gc-status">{status[id]}</span>
                <span className="gc-play">Jogar {Icon.right}</span>
                <span className="scard-glare" />
              </Link>
            </Tilt>
          </Item>
        ))}
      </Stagger>
    </>
  );
}

function GameShell({ title, children, side }) {
  return (
    <>
      <div className="game-head"><Link className="ibtn" to="/minijogos" aria-label="Voltar">{Icon.left}</Link><motion.h1 className="page-title" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>{title}</motion.h1></div>
      <div className="grid-main"><div className="col">{children}</div><aside className="col side">{side}</aside></div>
    </>
  );
}

/* ---------- Bolão ---------- */
function Bolao() {
  useStoreVersion();
  const { data: comps } = useComps();
  const { data: agenda } = useAgenda(comps);
  const live = useLive();
  const [filter, setFilter] = useState(0);
  const [saved, setSaved] = useState(null);
  const byId = useMemo(() => new Map([...(agenda || []), ...live].map((m) => [m.partida_id, m])), [agenda, live]);
  useEffect(() => {
    if (!agenda) return;
    const pal = getPal(); let ch = false;
    Object.entries(pal).forEach(([id, p]) => { const m = byId.get(+id); if (m) { p.m = slim(m); const s = palScore(p, m); if (s != null && s !== p.pts) { p.pts = s; ch = true; } } });
    if (ch) store.set('placar.palpites', pal);
    syncPicks(byId);
  }, [agenda, account.user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!agenda) return <GameShell title="Bolão"><Skel h={400} /></GameShell>;
  const pal = getPal(), st = palStats(), now = Date.now();
  const up = agenda.filter((m) => m.status === 'agendado' && parseDate(m) > now && parseDate(m) - now < 8 * 864e5).sort((a, b) => parseDate(a) - parseDate(b));
  const compIds = [...new Set(up.map((m) => m.campeonato && m.campeonato.campeonato_id))];
  const list = up.filter((m) => !filter || (m.campeonato && m.campeonato.campeonato_id === filter)).slice(0, 40);
  const groups = new Map(); list.forEach((m) => { const k = fmtDay(parseDate(m)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
  const history = Object.entries(pal).filter(([, p]) => p.m).sort((a, b) => (b[1].m.iso || '').localeCompare(a[1].m.iso || '')).slice(0, 25);
  const setPal = (m, h, a) => {
    const all = getPal();
    if (h == null || a == null) delete all[m.partida_id]; else all[m.partida_id] = { h, a, m: slim(m) };
    store.set('placar.palpites', all);
    sendPick(m.partida_id, h, a);
    setSaved(m.partida_id); setTimeout(() => setSaved(null), 900);
  };
  const num = (v) => (v === '' ? null : Math.max(0, Math.min(20, +v)));
  return (
    <GameShell title="Bolão" side={(
      <Panel><Head>Seus palpites</Head>{history.length ? <Stagger>{history.map(([id, p]) => (
        <Item key={id}><Link to={`/partida/${id}`} className="pal-h"><span><small className="muted">{p.m.c}</small><b>{p.m.h} <em>{p.h}×{p.a}</em> {p.m.a}</b><small className="muted">{p.m.st === 'finalizado' ? `Resultado: ${p.m.sh} × ${p.m.sa}` : 'Aguardando o jogo'}</small></span>
          <span className={`ppts p${p.pts ?? 'n'}`}>{p.pts == null ? '–' : `+${p.pts}`}</span></Link></Item>))}</Stagger> : <Empty>Seus palpites aparecem aqui.</Empty>}</Panel>
    )}>
      <Link to="/bolao" className="bl-cta"><b>👥 Bolão com amigos</b><span>Crie um grupo, mande o código para a turma e veja quem ganha a semana.</span><em>Abrir →</em></Link>
      <Panel><div className="kpi-grid"><div><b><CountUp value={st.pontos} /></b><span>Pontos</span></div><div><b><CountUp value={st.total} /></b><span>Palpites</span></div><div><b><CountUp value={st.exatos} /></b><span>Placares exatos</span></div><div><b><CountUp value={st.avaliados ? Math.round((st.acertos / st.avaliados) * 100) : 0} />%</b><span>Aproveitamento</span></div></div></Panel>
      <Panel className="flush">
        <ScrollRow><div className="filters chips-row" style={{ padding: '12px 16px' }}>
          <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter(0)}>Todos</button>
          {compIds.map((cid) => { const c = comps.find((x) => x.campeonato_id === cid); return c ? <button key={cid} className={`chip ${filter === cid ? 'on' : ''}`} onClick={() => setFilter(cid)}><CompLogo c={c} size={16} dark={filter === cid ? !isDark() : isDark()} />{c.nome_popular}</button> : null; })}
        </div></ScrollRow>
        {list.length ? [...groups].map(([day, ms]) => (
          <div key={day}><div className="date-sep">{day}</div>
            <Stagger>{ms.map((m) => { const p = pal[m.partida_id] || {}; return (
              <Item key={m.partida_id} className={`pal-row ${p.h != null ? 'has' : ''} ${saved === m.partida_id ? 'saved' : ''}`}>
                <span className="pal-when">{fmtShort(parseDate(m))}<br />{fmtTime(m)}</span>
                <span className="t h"><b>{m.time_mandante.nome_popular}</b><Crest t={m.time_mandante} size={24} /></span>
                <span className="score-in">
                  <input type="number" min="0" max="20" inputMode="numeric" defaultValue={p.h ?? ''} onChange={(e) => setPal(m, num(e.target.value), p.a ?? (e.target.value === '' ? null : 0))} aria-label={`Gols ${m.time_mandante.nome_popular}`} />
                  <i>×</i>
                  <input type="number" min="0" max="20" inputMode="numeric" defaultValue={p.a ?? ''} onChange={(e) => setPal(m, p.h ?? (e.target.value === '' ? null : 0), num(e.target.value))} aria-label={`Gols ${m.time_visitante.nome_popular}`} />
                </span>
                <span className="t"><Crest t={m.time_visitante} size={24} /><b>{m.time_visitante.nome_popular}</b></span>
              </Item>
            ); })}</Stagger></div>
        )) : <Empty>Nenhum jogo nos próximos dias para palpitar.</Empty>}
      </Panel>
    </GameShell>
  );
}

/* ---------- Craque do dia ---------- */
function seeded(seed, n) { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h) % n; }
function Craque() {
  useStoreVersion();
  const { data: pool } = useApi('/minijogos/craques', { ttl: 600_000, critical: true });
  const [mode, setMode] = useState('dia');
  const [free, setFree] = useState(null);
  const [q, setQ] = useState('');
  const sorted = useMemo(() => [...(pool || [])].sort((a, b) => a.nome.localeCompare(b.nome)), [pool]);
  if (!pool) return <GameShell title="Craque do dia"><Skel h={360} /></GameShell>;
  if (pool.length < 10) return <GameShell title="Craque do dia"><Panel><Empty>Carregando os artilheiros da temporada. Tente de novo em instantes.</Empty></Panel></GameShell>;
  const MAX = 8;
  let state;
  if (mode === 'dia') {
    const saved = store.get('placar.craque.dia', {});
    state = saved.date === todayKey() && sorted.some((p) => p.id === saved.id) ? saved : { date: todayKey(), id: sorted[seeded(todayKey(), sorted.length)].id, guesses: [], done: false, won: false };
  } else state = free;
  const target = sorted.find((p) => p.id === state.id);
  const stats = store.get('placar.craque.stats', { jogos: 0, vitorias: 0, seq: 0, melhor: 0 });
  const guesses = state.guesses.map((id) => sorted.find((p) => p.id === id)).filter(Boolean);
  const guess = (id) => {
    if (state.done || state.guesses.includes(id)) return;
    const s = { ...state, guesses: [...state.guesses, id] };
    if (id === target.id || s.guesses.length >= MAX) {
      s.done = true; s.won = id === target.id;
      const st = { ...stats, jogos: stats.jogos + 1 };
      if (s.won) { st.vitorias++; st.seq++; st.melhor = Math.max(st.melhor, st.seq); } else st.seq = 0;
      store.set('placar.craque.stats', st);
    }
    if (mode === 'dia') store.set('placar.craque.dia', s); else setFree(s);
    setQ('');
  };
  const hits = q.length >= 2 ? sorted.filter((p) => norm(p.nome).includes(norm(q)) && !state.guesses.includes(p.id)).slice(0, 8) : [];
  const numCmp = (a, b, near) => (a == null || b == null ? [false, ''] : a === b ? [true, ''] : [Math.abs(a - b) <= near ? 'near' : false, b > a ? '↑' : '↓']);
  const Cell = ({ ok, children, hint, i }) => (
    <motion.div className={`cq-cell ${ok === true ? 'ok' : ok === 'near' ? 'near' : 'no'}`} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: i * 0.12, duration: 0.4 }}>
      <span>{children}</span>{hint && <i>{hint}</i>}
    </motion.div>
  );
  return (
    <GameShell title="Craque do dia" side={(
      <>
        <Panel><div className="kpi-grid"><div><b>{stats.jogos}</b><span>Jogos</span></div><div><b>{stats.jogos ? Math.round((stats.vitorias / stats.jogos) * 100) : 0}%</b><span>Acertos</span></div><div><b>{stats.seq}</b><span>Sequência</span></div><div><b>{stats.melhor}</b><span>Melhor</span></div></div></Panel>
        <Panel className="note">Verde: igual ao craque. Amarelo: perto (idade a até 2 anos, gols a até 3). As setas dizem se o número do craque é maior ou menor. Artilheiros de {[...new Set(pool.map((p) => p.liga))].join(', ')}.</Panel>
      </>
    )}>
      <AnimatePresence>
        {state.done && (
          <motion.div className={`panel cq-result ${state.won ? 'won' : ''}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <small>{state.won ? `Você acertou em ${guesses.length} ${guesses.length === 1 ? 'tentativa' : 'tentativas'}!` : 'Não foi dessa vez. O craque era'}</small>
            <Link className="cq-answer" to={`/jogador/${target.id}`}><Crest t={target.time} size={56} /><span><b>{target.nome}</b><em>{target.time.nome_popular} · {target.liga} · {target.gols} gols</em></span></Link>
            <div className="sim-actions">{mode === 'dia' && <small className="muted">Novo craque amanhã.</small>}<button className="btn btn-primary" onClick={() => { setMode('livre'); setFree({ id: pick(sorted).id, guesses: [], done: false, won: false }); }}>Jogar no modo livre</button></div>
          </motion.div>
        )}
      </AnimatePresence>
      {!state.done && (
        <Panel className="pad">
          <div className="pick big">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) guess(hits[0].id); }} placeholder="Digite o nome de um artilheiro…" autoFocus />
            {hits.length > 0 && <div className="sugg">{hits.map((p) => <button key={p.id} onClick={() => guess(p.id)}><Crest t={p.time} size={20} /><span>{p.nome}</span><small>{p.time.nome_popular}</small></button>)}</div>}
          </div>
          <small className="muted">{mode === 'dia' ? 'Desafio do dia' : 'Modo livre'} · tentativa {guesses.length + 1} de {MAX}</small>
        </Panel>
      )}
      <Panel className="flush">
        <div className="cq-head"><span>Jogador</span><span>Liga</span><span>Time</span><span>Posição</span><span>Idade</span><span>País</span><span>Gols</span></div>
        {guesses.length ? [...guesses].reverse().map((g) => {
          const [ai, ah] = numCmp(g.idade, target.idade, 2), [gi, gh] = numCmp(g.gols, target.gols, 3);
          return (
            <div key={g.id} className="cq-row">
              <div className="cq-name"><Crest t={g.time} size={22} /><b>{g.nome}</b></div>
              <Cell i={0} ok={g.liga === target.liga}>{g.liga}</Cell>
              <Cell i={1} ok={g.time.nome_popular === target.time.nome_popular}><Crest t={g.time} size={20} /></Cell>
              <Cell i={2} ok={g.posicao === target.posicao}>{g.posicao || '?'}</Cell>
              <Cell i={3} ok={ai} hint={ah}>{g.idade ?? '?'}</Cell>
              <Cell i={4} ok={g.nacionalidade === target.nacionalidade}>{g.nacionalidade || '?'}</Cell>
              <Cell i={5} ok={gi} hint={gh}>{g.gols ?? '?'}</Cell>
            </div>
          );
        }) : <Empty>Faça seu primeiro palpite.</Empty>}
      </Panel>
    </GameShell>
  );
}

/* ---------- Quiz de escudos ---------- */
function Crests() {
  const { data: comps } = useComps();
  const [compId, setCompId] = useState(null);
  const leagues = (comps || []).filter((c) => c.tipo === 'Pontos Corridos');
  const chosen = leagues.find((c) => c.campeonato_id === compId);
  const teamsQ = useQuery({
    queryKey: ['quiz-teams', compId || 'all'], enabled: !!comps, staleTime: 600_000,
    queryFn: async () => {
      const lists = await Promise.all((chosen ? [chosen] : leagues).map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/tabela`, 600_000)).then((t) => flattenTable(t || []).flatMap((g) => g.rows.map((r) => r.time)))));
      const seen = new Set();
      return lists.flat().filter((t) => t.escudo && !seen.has(norm(t.nome_popular)) && seen.add(norm(t.nome_popular)));
    },
  });
  const ROUNDS = 10, SECS = 10;
  const [run, setRun] = useState({ n: 0, score: 0, q: null, answered: null, done: false, id: 0 });
  const [el, setEl] = useState(0);
  const t0 = useRef(0);
  const teams = teamsQ.data || [];
  const key = `escudos${chosen ? '-' + chosen.campeonato_id : ''}`;
  const next = (r) => {
    if (r.n >= ROUNDS) { setBest('escudos', r.score); setBest(key, r.score); setRun({ ...r, done: true, q: null }); return; }
    const target = pick(teams);
    const options = shuffle([target, ...shuffle(teams.filter((t) => t !== target)).slice(0, 3)]);
    t0.current = Date.now(); setEl(0);
    setRun({ ...r, n: r.n + 1, q: { target, options }, answered: null });
  };
  const start = () => next({ n: 0, score: 0, q: null, answered: null, done: false, id: Date.now() });
  useEffect(() => { setRun({ n: 0, score: 0, q: null, answered: null, done: false, id: 0 }); }, [compId]);
  useEffect(() => {
    if (!run.q || run.answered != null) return undefined;
    const t = setInterval(() => { const e = (Date.now() - t0.current) / 1000; setEl(e); if (e >= SECS) answer(-1); }, 100);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (i) => {
    if (run.answered != null) return;
    const left = Math.max(0, SECS - (Date.now() - t0.current) / 1000);
    const right = i >= 0 && run.q.options[i] === run.q.target;
    const r = { ...run, answered: i, score: run.score + (right ? 100 + Math.round(left) * 10 : 0) };
    setRun(r);
    setTimeout(() => next(r), 1100);
  };
  const chooser = (
    <ScrollRow><div className="filters chips-row">
      <button className={`chip ${!compId ? 'on' : ''}`} onClick={() => setCompId(null)}>Todas as ligas</button>
      {leagues.map((c) => <button key={c.campeonato_id} className={`chip ${compId === c.campeonato_id ? 'on' : ''}`} onClick={() => setCompId(c.campeonato_id)}><CompLogo c={c} size={16} dark={compId === c.campeonato_id ? !isDark() : isDark()} />{c.nome_popular}</button>)}
    </div></ScrollRow>
  );
  const side = <Panel className="note">O escudo começa desfocado e vai ficando nítido. Acertar vale 100 pontos mais 10 por segundo que sobrar.</Panel>;
  if (!teamsQ.data) return <GameShell title="Quiz de escudos" side={side}>{chooser}<Skel h={360} /></GameShell>;
  if (teams.length < 6) return <GameShell title="Quiz de escudos" side={side}>{chooser}<Panel><Empty>Sem times suficientes nesta liga agora.</Empty></Panel></GameShell>;
  const frac = Math.min(1, el / SECS);
  return (
    <GameShell title="Quiz de escudos" side={side}>
      {chooser}
      {!run.q && !run.done && <Panel className="quiz-start"><b>10 escudos · 10 segundos cada</b><span className="muted">Recorde{chosen ? ` em ${chosen.nome_popular}` : ''}: {best(key)} pontos</span><button className="btn btn-primary" onClick={start}>Começar</button></Panel>}
      {run.done && (
        <motion.div className="panel quiz-start" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <small className="muted">Pontuação final</small><b className="qz-final"><CountUp value={run.score} /></b>
          <span className="muted">Recorde: {best(key)} pontos</span><button className="btn btn-primary" onClick={start}>Jogar de novo</button>
        </motion.div>
      )}
      {run.q && (
        <Panel>
          <Head sub={`${run.score} pontos`}>Escudo {run.n} de {ROUNDS}</Head>
          <div className="qz-timer"><i style={{ width: `${run.answered != null ? 0 : (1 - frac) * 100}%` }} /></div>
          <div className="crest-box">
            <AnimatePresence mode="wait">
              <motion.img key={run.n} src={(isDark() && run.q.target.escudo_escuro) || run.q.target.escudo} alt="Escudo" initial={{ scale: 0.5, opacity: 0, rotate: -15 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 1.3, opacity: 0 }}
                style={{ filter: run.answered != null ? 'none' : `blur(${16 * (1 - frac)}px) grayscale(${1 - frac})` }} />
            </AnimatePresence>
          </div>
          <div className="opts">{run.q.options.map((o, i) => {
            const st = run.answered == null ? '' : o === run.q.target ? 'right' : i === run.answered ? 'wrong' : 'dim';
            return <motion.button key={o.time_id} className={`opt ${st}`} onClick={() => answer(i)} disabled={run.answered != null} whileTap={{ scale: 0.96 }} animate={st === 'wrong' ? { x: [0, -8, 8, -5, 5, 0] } : {}}>{o.nome_popular}</motion.button>;
          })}</div>
        </Panel>
      )}
    </GameShell>
  );
}
