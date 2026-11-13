import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { useComps } from '../lib/data.js';
import { Mode } from '../lib/mode.js';
import { tasteMatch } from '../lib/store.js';
import { isLive, isLeague, parseDate, fmtDay, fmtTime, penScore, evMinute, barColors, kitColor, inkFor, flattenTable, shortName, titleize, winnerSide } from '../lib/format.js';
import { Panel, Head, Skel, Empty, ErrorBox, Tabs, Stagger, Item, Reveal, Crest, CompLogo, Digit, LiveMinute, LiveDot, Watch, Form, CountUp, Icon, ease } from '../components/ui.jsx';
import { Standings, MatchRow } from '../components/match.jsx';

export default function Match() {
  const { id, tab = 'resumo' } = useParams();
  const live = useLive();
  const lp = live.find((x) => x.partida_id === +id);
  const q = useApi(`/partidas/${id}`, { ttl: 15_000, refetch: lp || false ? 20_000 : false });
  const { data: comps } = useComps();
  const p = q.data;
  const camp = p && ((comps || []).find((c) => p.campeonato && c.campeonato_id === p.campeonato.campeonato_id) || p.campeonato || {});
  useEffect(() => { if (p) tasteMatch(p, 1); }, [p && p.partida_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (camp && camp.campeonato_id) Mode.comp(camp, false); }, [camp && camp.campeonato_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // gol pela transmissão: busca o detalhe na hora
  const sig = lp && `${lp.placar_mandante}-${lp.placar_visitante}-${lp.periodo}-${lp.status}`;
  useEffect(() => { if (sig && p) q.refetch(); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!p) return <><Skel h={340} /><Skel h={500} /></>;
  const m = lp ? { ...p, ...lp, gols: p.gols, escalacoes: p.escalacoes, estatisticas: p.estatisticas } : p;
  const onlyFd = p.fonte === 'football-data';
  const base = `/partida/${id}`;
  const tabs = [['resumo', 'Resumo', base]];
  if (!onlyFd || p.escalacoes) tabs.push(['escalacoes', 'Escalações', `${base}/escalacoes`]);
  if (!onlyFd || p.estatisticas) tabs.push(['estatisticas', 'Estatísticas', `${base}/estatisticas`]);
  if (isLeague(camp)) tabs.push(['tabela', 'Tabela', `${base}/tabela`]);

  return (
    <>
      <Scoreboard p={m} camp={camp} />
      <div className="sticky-tabs"><Tabs items={tabs} active={tab} id="match" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
          {tab === 'escalacoes' ? <Lineups p={m} />
            : tab === 'estatisticas' ? <Stats p={m} />
              : tab === 'tabela' ? <TableTab p={m} camp={camp} />
                : <Summary p={m} camp={camp} />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/* ---------- placar estilo transmissão ---------- */
function Scoreboard({ p, camp }) {
  const H = p.time_mandante, A = p.time_visitante, live = isLive(p), pen = penScore(p), d = parseDate(p), w = winnerSide(p);
  const [ch, ca] = barColors(H, A);
  const sub = [p.fase && !isLeague(camp) ? p.fase.nome : null, p.rodada || null, p.grupo || null].filter(Boolean).join(' · ');
  const scorers = (side) => ((p.gols || {})[side] || []).slice().sort((x, y) => evMinute(x).key - evMinute(y).key);
  const team = (t, side) => (
    <Link to={`/time/${t.time_id}?c=${camp.campeonato_id || ''}`} className={`sb-team ${side} ${w && w !== (side === 'home' ? 'h' : 'a') ? 'lose' : ''}`}>
      <motion.span className="sb-crest" initial={{ opacity: 0, scale: 0.5, x: side === 'home' ? -40 : 40 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}>
        <Crest t={t} size={110} />
      </motion.span>
      <b>{t.nome_popular}</b>
      <ul className="sb-scorers">
        {scorers(side === 'home' ? 'mandante' : 'visitante').map((g, i) => (
          <li key={i}>{g.atleta ? g.atleta.nome_popular : '—'} <em>{evMinute(g).label}{g.penalti ? ' pên.' : ''}{g.gol_contra ? ' contra' : ''}</em></li>
        ))}
      </ul>
    </Link>
  );
  return (
    <section className={`scoreboard ${live ? 'is-live' : ''}`} style={{ '--hc': ch, '--ac': ca }}>
      <motion.span className="sb-slab h" initial={{ x: '-100%' }} animate={{ x: 0 }} transition={{ duration: 0.7, ease }} />
      <motion.span className="sb-slab a" initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.7, ease }} />
      <span className="sb-noise" />
      <div className="sb-top">
        <Link to={`/campeonato/${camp.campeonato_id}`} className="sb-comp"><CompLogo c={camp} size={20} dark /><span>{camp.nome_popular || camp.nome}</span></Link>
        {sub && <span className="sb-sub">{sub}</span>}
      </div>
      <div className="sb-grid">
        {team(H, 'home')}
        <div className="sb-center">
          {live || p.status === 'finalizado' ? (
            <motion.div className="sb-score" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 0.5, ease }}>
              <Digit v={p.placar_mandante ?? 0} /><i>:</i><Digit v={p.placar_visitante ?? 0} />
            </motion.div>
          ) : (
            <div className="sb-score time">{fmtTime(p)}</div>
          )}
          {pen && <div className="sb-pen">Pênaltis {pen[0]} – {pen[1]}</div>}
          <div className={`sb-status ${live ? 'live' : ''}`}>
            {live ? <><LiveDot /><LiveMinute p={p} /></> : p.status === 'finalizado' ? 'Encerrado' : d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }) : titleize(p.status)}
          </div>
        </div>
        {team(A, 'away')}
      </div>
      <div className="sb-info">{d && <span>{fmtDay(d)}, {fmtTime(p)}</span>}{p.estadio && <span>{p.estadio.nome_popular}</span>}</div>
    </section>
  );
}

/* ---------- resumo ---------- */
function Summary({ p, camp }) {
  const live = isLive(p), pre = p.status !== 'finalizado' && !live;
  const { data: t } = useApi(isLeague(camp) ? `/campeonatos/${camp.campeonato_id}/tabela` : '', { ttl: 60_000, enabled: isLeague(camp) });
  const g = flattenTable(t || []);
  const rows = g.length === 1 && !g[0].title ? g[0].rows : null;
  return (
    <div className="grid-main">
      <div className="col">
        <AIInsight p={p} />
        <Prob p={p} />
        <Timeline p={p} />
        {p.estatisticas && p.estatisticas.mandante && (
          <Panel><Head right={<Link className="phead-more" to={`/partida/${p.partida_id}/estatisticas`}>Todas</Link>}>Estatísticas principais</Head>
            <StatRows p={p} rows={[['Finalizações', 'finalizacao.total'], ['Chutes no gol', 'finalizacao.no_gol'], ['Escanteios', 'escanteios'], ['Faltas', 'faltas']]} /></Panel>
        )}
        <H2H p={p} />
      </div>
      <aside className="col side">
        {p.status !== 'finalizado' && <Watch w={p.onde_assistir} />}
        {rows && <PreGame p={p} rows={rows} />}
        <Info p={p} />
        {pre && !rows && null}
      </aside>
    </div>
  );
}

function AIInsight({ p }) {
  const { data: st } = useApi('/ia/status', { ttl: 600_000 });
  const key = `/ia/partida/${p.partida_id}`;
  const q = useApi(st && st.ativo ? key : '', { ttl: 5 * 60_000, enabled: !!(st && st.ativo) });
  if (!st || !st.ativo) return null;
  if (q.isLoading) return <Panel className="ai"><Head sub="analisando os dados do jogo">Análise</Head><div className="pad"><div className="lines"><i /><i /><i /></div></div></Panel>;
  if (!q.data) return null;
  const a = q.data.analise, pal = a.palpite || {};
  const label = { andamento: 'Ao vivo', finalizado: 'Resumo do jogo' }[q.data.status] || 'Prévia';
  return (
    <Reveal>
      <Panel className="ai">
        <Head sub={label}>Análise</Head>
        <div className="pad">
          <h3 className="ai-t">{a.titulo}</h3>
          <p>{a.resumo}</p>
          {(a.pontos || []).length > 0 && <ul className="ai-pts">{a.pontos.map((x, i) => <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }}>{x}</motion.li>)}</ul>}
          <div className="ai-tip"><span className="tag">{q.data.status === 'finalizado' ? 'Final' : 'Palpite'}</span><b>{p.time_mandante.sigla} {pal.mandante ?? '–'} × {pal.visitante ?? '–'} {p.time_visitante.sigla}</b><small>{pal.comentario}</small></div>
          {a.fique_de_olho && <p className="small"><b>Fique de olho:</b> {a.fique_de_olho}</p>}
          <p className="foot">Texto gerado por IA ({st.provedor === 'gemini' ? 'Gemini' : 'Claude'}) só com os dados do Placar. Pode errar.</p>
        </div>
      </Panel>
    </Reveal>
  );
}

function Prob({ p }) {
  const pr = p.probabilidades;
  if (!pr) return null;
  const liveP = pr.ao_vivo && isLive(p);
  const cur = liveP ? pr.ao_vivo : pr.pre;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  const parts = [[cur.casa, ch, p.time_mandante], [cur.empate, 'var(--draw)', null], [cur.fora, ca, p.time_visitante]];
  return (
    <Reveal>
      <Panel>
        <Head sub={pr.confianca === 'baixa' ? 'estimativa com poucos dados' : 'modelo do Placar'}>{liveP ? <><LiveDot /> Probabilidade ao vivo</> : p.status === 'finalizado' ? 'Probabilidade antes do jogo' : 'Probabilidade de vitória'}</Head>
        <div className="prob">
          {parts.map(([v, c, t], i) => (
            <div key={i} className="prob-c">{t ? <Crest t={t} size={30} /> : <span className="x">EMPATE</span>}<b><CountUp value={v} decimals={1} />%</b></div>
          ))}
        </div>
        <div className="prob-bar">{parts.map(([v, c], i) => <motion.i key={i} style={{ background: c }} initial={{ width: 0 }} whileInView={{ width: `${v}%` }} viewport={{ once: true }} transition={{ duration: 1, ease, delay: i * 0.1 }} />)}</div>
      </Panel>
    </Reveal>
  );
}

/* linha do tempo: lances dos dois lados de uma linha central */
function Timeline({ p }) {
  const ev = [];
  const add = (side, list, type) => (list || []).forEach((e) => ev.push({ side, type, e, m: evMinute(e), slug: e.periodo_slug }));
  ['mandante', 'visitante'].forEach((s) => {
    add(s, (p.gols || {})[s], 'gol');
    add(s, ((p.cartoes || {}).amarelo || {})[s], 'amarelo');
    add(s, ((p.cartoes || {}).vermelho || {})[s], 'vermelho');
    add(s, (p.substituicoes || {})[s], 'sub');
  });
  if (!ev.length) return p.fonte === 'football-data' ? null : <Panel><Head>Lances</Head><Empty>{p.status === 'agendado' ? 'A partida ainda não começou. Os lances aparecem aqui em tempo real.' : 'Nenhum lance registrado.'}</Empty></Panel>;
  ev.sort((a, b) => a.m.key - b.m.key);
  let h = 0, a = 0;
  ev.forEach((x) => { if (x.type === 'gol') { if (x.side === 'mandante') h++; else a++; x.score = `${h}–${a}`; } });
  ev.reverse();
  const nm = (at) => (at ? <Link to={`/jogador/${at.atleta_id}`}>{at.nome_popular}</Link> : <span className="muted">Comissão técnica</span>);
  return (
    <Panel>
      <Head>Lances</Head>
      <Stagger className="tl">
        {ev.map((x, i) => (
          <Item key={i} className={`tl-row ${x.side} t-${x.type}`}>
            <div className="tl-side">
              {x.type === 'gol' ? <><span className="tl-ico goal">{Icon.ball}</span><span>{nm(x.e.atleta)} <em className="tl-score">{x.score}</em>{(x.e.penalti || x.e.gol_contra) && <small>{x.e.penalti ? 'Pênalti' : 'Gol contra'}</small>}</span></>
                : x.type === 'sub' ? <><span className="tl-ico sub">{Icon.sub}</span><span>{nm(x.e.entrou)}<small>sai {x.e.saiu ? x.e.saiu.nome_popular : ''}</small></span></>
                  : <><span className="tl-ico">{Icon.card(x.type === 'amarelo' ? 'y' : 'r')}</span><span>{nm(x.e.atleta)}</span></>}
            </div>
            <span className="tl-min">{x.m.label}</span>
          </Item>
        ))}
      </Stagger>
    </Panel>
  );
}

const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
const num = (v) => parseFloat(String(v ?? 0).replace('%', '')) || 0;
const LOWER = new Set(['faltas', 'passes.errados', 'impedimentos', 'cartoes_amarelos', 'cartoes_vermelhos']);
function StatRows({ p, rows }) {
  const s = p.estatisticas;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  return (
    <div className="stats" style={{ '--ch': ch, '--ca': ca }}>
      {rows.map(([label, path]) => {
        if (!path) return <h4 key={label} className="st-sec">{label}</h4>;
        const a = get(s.mandante, path), b = get(s.visitante, path);
        if (a == null && b == null) return null;
        const na = num(a), nb = num(b), tot = na + nb || 1;
        const lb = LOWER.has(path), la = lb ? na < nb : na > nb, lB = lb ? nb < na : nb > na;
        return (
          <div key={label} className="st">
            <div className="st-top"><b className={la ? 'lead' : ''}>{a ?? 0}</b><span>{label}</span><b className={lB ? 'lead' : ''}>{b ?? 0}</b></div>
            <div className="st-bars">
              <span><motion.i className={`h ${la ? 'lead' : ''}`} initial={{ width: 0 }} whileInView={{ width: `${(na / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /></span>
              <span><motion.i className={`a ${lB ? 'lead' : ''}`} initial={{ width: 0 }} whileInView={{ width: `${(nb / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stats({ p }) {
  const s = p.estatisticas;
  if (!s || !s.mandante || !s.visitante) return <Panel><Empty>As estatísticas aparecem depois que a partida começa.</Empty></Panel>;
  const pa = parseFloat(s.mandante.posse_de_bola) || 0, pb = parseFloat(s.visitante.posse_de_bola) || 0;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  return (
    <div className="grid-main one">
      <Panel>
        {pa + pb > 0 && (
          <div className="poss-wrap">
            <div className="poss-head"><Crest t={p.time_mandante} size={28} /><span>Posse de bola</span><Crest t={p.time_visitante} size={28} /></div>
            <div className="poss">
              <motion.div style={{ background: ch, color: inkFor(ch) }} initial={{ width: '50%' }} animate={{ width: `${pa}%` }} transition={{ duration: 1.1, ease }}><CountUp value={pa} />%</motion.div>
              <motion.div style={{ background: ca, color: inkFor(ca) }} initial={{ width: '50%' }} animate={{ width: `${pb}%` }} transition={{ duration: 1.1, ease }}><CountUp value={pb} />%</motion.div>
            </div>
          </div>
        )}
        <StatRows p={p} rows={[
          ['Ataque'], ['Finalizações', 'finalizacao.total'], ['Chutes no gol', 'finalizacao.no_gol'], ['Chutes para fora', 'finalizacao.pra_fora'], ['Chutes bloqueados', 'finalizacao.bloqueado'], ['Bolas na trave', 'finalizacao.na_trave'], ['Escanteios', 'escanteios'], ['Impedimentos', 'impedimentos'],
          ['Passes'], ['Passes', 'passes.total'], ['Passes certos', 'passes.completos'], ['Precisão de passes', 'passes.precisao'], ['Cruzamentos', 'cruzamentos.total'], ['Lançamentos', 'lancamentos.total'],
          ['Defesa'], ['Desarmes', 'desarmes'], ['Interceptações', 'interceptacoes'], ['Cortes', 'cortes'], ['Defesas do goleiro', 'defensivo.defesas'],
          ['Disciplina'], ['Faltas', 'faltas'], ['Cartões amarelos', 'cartoes_amarelos'], ['Cartões vermelhos', 'cartoes_vermelhos'],
        ]} />
      </Panel>
    </div>
  );
}

/* ---------- escalações no campo ---------- */
function Lineups({ p }) {
  const E = p.escalacoes;
  if (!E || (!(E.mandante || {}).titulares && !(E.visitante || {}).titulares)) return <Panel><Empty>As escalações ainda não foram divulgadas. Normalmente saem cerca de 1 hora antes do jogo.</Empty></Panel>;
  const events = (side) => {
    const m = new Map();
    const bump = (id, k) => { if (!id) return; const o = m.get(id) || {}; o[k] = (o[k] || 0) + 1; m.set(id, o); };
    ((p.gols || {})[side] || []).forEach((g) => !g.gol_contra && bump((g.atleta || {}).atleta_id, 'g'));
    (((p.cartoes || {}).amarelo || {})[side] || []).forEach((c) => bump((c.atleta || {}).atleta_id, 'y'));
    (((p.cartoes || {}).vermelho || {})[side] || []).forEach((c) => bump((c.atleta || {}).atleta_id, 'r'));
    ((p.substituicoes || {})[side] || []).forEach((s) => { bump((s.saiu || {}).atleta_id, 'out'); bump((s.entrou || {}).atleta_id, 'in'); });
    return m;
  };
  const players = (side, team) => {
    const L = E[side];
    if (!L || !L.titulares) return [];
    const ev = events(side), kit = kitColor(team);
    const st = [...L.titulares].sort((a, b) => a.ordem - b.ordem);
    const shape = String(L.esquema_tatico || '').split('-').map(Number).filter(Boolean);
    let lines;
    if (shape.length && shape.reduce((a, b) => a + b, 0) + 1 === st.length) { lines = [[st[0]]]; let i = 1; shape.forEach((n) => { lines.push(st.slice(i, i + n)); i += n; }); }
    else lines = [[st[0]], st.slice(1, 5), st.slice(5, 8), st.slice(8)];
    const home = side === 'mandante', outfield = lines.length - 1;
    return lines.flatMap((ln, li) => {
      const along = li === 0 ? 5 : 14 + (outfield > 1 ? ((li - 1) / (outfield - 1)) * 25 : 14);
      return ln.map((x, j) => {
        const across = ((j + 1) / (ln.length + 1)) * 100;
        const fx = home ? along : 100 - along, fy = home ? 100 - across : across;
        const e = ev.get(x.atleta.atleta_id) || {};
        return { x, fx, fy, e, gk: li === 0, kit, home, delay: li * 0.08 + j * 0.03 };
      });
    });
  };
  const H = p.time_mandante, A = p.time_visitante;
  const all = [...players('mandante', H), ...players('visitante', A)];
  const bench = (side, team) => {
    const L = E[side] || {}, ev = events(side);
    return (
      <div className="bench">
        <h4><Crest t={team} size={18} /> {team.nome_popular} · Reservas</h4>
        {L.tecnico && <div className="b-row"><span className="n">T</span><span>{L.tecnico.nome_popular}</span><small>Técnico</small></div>}
        {[...(L.reservas || [])].sort((a, b) => a.ordem - b.ordem).map((x) => (
          <Link key={x.atleta.atleta_id} className="b-row" to={`/jogador/${x.atleta.atleta_id}`}><span className="n">{x.camisa}</span><span>{x.atleta.nome_popular}{(ev.get(x.atleta.atleta_id) || {}).in && <em className="in">entrou</em>}</span><small>{(x.posicao && x.posicao.sigla) || ''}</small></Link>
        ))}
      </div>
    );
  };
  return (
    <Panel className="flush">
      <div className="lu-head"><span><Crest t={H} size={24} />{H.nome_popular}</span><b>{(E.mandante || {}).esquema_tatico}{(E.visitante || {}).esquema_tatico ? ` · ${E.visitante.esquema_tatico}` : ''}</b><span className="r">{A.nome_popular}<Crest t={A} size={24} /></span></div>
      <div className="pitch">
        <svg className="pitch-lines" viewBox="0 0 105 68" preserveAspectRatio="none"><rect x="1" y="1" width="103" height="66" /><line x1="52.5" y1="1" x2="52.5" y2="67" /><circle cx="52.5" cy="34" r="9.15" /><rect x="1" y="13.85" width="16.5" height="40.3" /><rect x="1" y="24.85" width="5.5" height="18.3" /><rect x="87.5" y="13.85" width="16.5" height="40.3" /><rect x="98.5" y="24.85" width="5.5" height="18.3" /></svg>
        {all.map(({ x, fx, fy, e, gk, kit, delay }) => (
          <motion.div key={x.atleta.atleta_id} className="pl" style={{ left: `${fx}%`, top: `${fy}%`, '--kit': kit, '--shirt-ink': inkFor(kit) }}
            initial={{ opacity: 0, scale: 0.3, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay }}>
            <Link to={`/jogador/${x.atleta.atleta_id}`} title={x.atleta.nome_popular}>
              <span className={`shirt ${gk ? 'gk' : ''}`}>{x.camisa}
                {(e.g || e.y || e.r) && <span className="badges">{Array.from({ length: e.g || 0 }, (_, i) => <span key={i}>{Icon.ball}</span>)}{e.y ? Icon.card('y') : null}{e.r ? Icon.card('r') : null}</span>}
                {e.out && <span className="off">↓</span>}
              </span>
              <span className="nm">{shortName(x.atleta.nome_popular)}</span>
            </Link>
          </motion.div>
        ))}
      </div>
      <div className="benches">{bench('mandante', H)}{bench('visitante', A)}</div>
    </Panel>
  );
}

function TableTab({ p, camp }) {
  const { data } = useApi(`/campeonatos/${camp.campeonato_id}/tabela`, { ttl: 60_000 });
  if (!data) return <Skel h={500} />;
  const g = flattenTable(data);
  if (!g.length) return <Panel><Empty>Sem tabela.</Empty></Panel>;
  return <Panel className="flush"><Standings rows={g[0].rows} campId={camp.campeonato_id} highlight={[+p.time_mandante.time_id, +p.time_visitante.time_id]} /></Panel>;
}

function PreGame({ p, rows }) {
  const find = (t) => rows.find((r) => +r.time.time_id === +t.time_id);
  const h = find(p.time_mandante), a = find(p.time_visitante);
  if (!h || !a) return null;
  const ap = (r) => (r.jogos ? Math.round((r.pontos / (r.jogos * 3)) * 100) : 0);
  const gpj = (v, r) => (r.jogos ? (v / r.jogos).toFixed(1).replace('.', ',') : '–');
  const line = (label, x, y, better) => {
    const nx = parseFloat(String(x).replace(',', '.')), ny = parseFloat(String(y).replace(',', '.'));
    const bx = better === 'min' ? nx < ny : nx > ny, by = better === 'min' ? ny < nx : ny > nx;
    return <div className="pg"><b className={bx ? 'best' : ''}>{x}</b><span>{label}</span><b className={by ? 'best' : ''}>{y}</b></div>;
  };
  return (
    <Panel>
      <Head>{p.status === 'finalizado' ? 'Os times na tabela' : 'Momento dos times'}</Head>
      <div className="pg-head"><span><Crest t={p.time_mandante} size={22} />{p.time_mandante.sigla}</span><span>{p.time_visitante.sigla}<Crest t={p.time_visitante} size={22} /></span></div>
      {line('Posição', `${h.posicao}º`, `${a.posicao}º`, 'min')}{line('Pontos', h.pontos, a.pontos)}{line('Aproveitamento', `${ap(h)}%`, `${ap(a)}%`)}
      {line('Gols pró / jogo', gpj(h.gols_pro, h), gpj(a.gols_pro, a))}{line('Gols sofridos / jogo', gpj(h.gols_contra, h), gpj(a.gols_contra, a), 'min')}
      {(h.ultimos_jogos || []).length > 0 && <div className="pg"><Form f={h.ultimos_jogos} /><span>Últimos</span><Form f={a.ultimos_jogos} /></div>}
    </Panel>
  );
}

function H2H({ p }) {
  const h = p.confronto;
  if (!h || !h.jogos) return null;
  const t = (x) => Math.max(0, x || 0);
  const total = t(h.vitorias_mandante) + t(h.vitorias_visitante) + t(h.empates) || 1;
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  return (
    <Reveal>
      <Panel>
        <Head sub={`últimos ${h.jogos} jogos · ${h.gols} gols`}>Confronto direto</Head>
        <div className="prob">
          <div className="prob-c"><Crest t={p.time_mandante} size={28} /><b><CountUp value={t(h.vitorias_mandante)} /></b><small>vitórias</small></div>
          <div className="prob-c"><span className="x">EMPATES</span><b><CountUp value={t(h.empates)} /></b></div>
          <div className="prob-c"><Crest t={p.time_visitante} size={28} /><b><CountUp value={t(h.vitorias_visitante)} /></b><small>vitórias</small></div>
        </div>
        <div className="prob-bar">{[[h.vitorias_mandante, ch], [h.empates, 'var(--draw)'], [h.vitorias_visitante, ca]].map(([v, c], i) => <motion.i key={i} style={{ background: c }} initial={{ width: 0 }} whileInView={{ width: `${(t(v) / total) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease }} />)}</div>
        <Stagger>{(h.partidas || []).map((m) => <MatchRow key={m.partida_id} p={m} showDate comp={m.campeonato} />)}</Stagger>
      </Panel>
    </Reveal>
  );
}

function Info({ p }) {
  const rows = [];
  if (p.placar_intervalo) rows.push(['Intervalo', p.placar_intervalo]);
  (p.arbitragem || []).forEach((r) => rows.push([r.funcao, `${r.nome || '—'}${r.nacionalidade ? ` (${r.nacionalidade})` : ''}`]));
  if (p.estadio) rows.push(['Estádio', p.estadio.nome_popular]);
  if (!rows.length) return null;
  return <Panel><Head>Informações</Head><dl className="facts">{rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Panel>;
}
