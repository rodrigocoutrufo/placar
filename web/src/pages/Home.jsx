import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLive } from '../lib/live.js';
import { useApi } from '../lib/api.js';
import { useComps, useAgenda, featured, compOf, compRank } from '../lib/data.js';
import { dayKey, parseDate, flattenTable, isLeague, isLive, fmtDT, timeAgo, parseISO } from '../lib/format.js';
import { followsComp, followsTeam } from '../lib/notify.js';
import { compTheme, LOGO } from '../lib/themes.js';
import { Taste, getFavs, useStoreVersion } from '../lib/store.js';
import { Panel, Head, Skel, Empty, Stagger, Item, CompLogo, Crest, Countdown, LiveDot, Icon, ScrollRow, ease } from '../components/ui.jsx';
import { ScoreCard, Rail, CompBlocks, Standings } from '../components/match.jsx';

export default function Home() {
  useStoreVersion();
  const live = useLive();
  const { data: comps } = useComps();
  const { data: agenda } = useAgenda(comps);
  const [params, setParams] = useSearchParams();
  const today = dayKey(new Date());
  const filter = params.get('f') || 'all';
  const [manual, setManual] = useState({}); // campeonatos que a pessoa abriu/fechou na mão

  const liveMap = useMemo(() => new Map(live.map((p) => [p.partida_id, p])), [live]);
  const merged = useMemo(() => (agenda || []).map((p) => liveMap.get(p.partida_id) || p), [agenda, liveMap]);
  const byDay = useMemo(() => {
    const m = new Map();
    merged.forEach((p) => { const k = dayKey(parseDate(p)); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    return m;
  }, [merged]);
  const days = useMemo(() => [...new Set([...byDay.keys(), today])].filter((k) => k !== 'tbd').sort(), [byDay, today]);
  // sem jogo hoje: abre no próximo dia com jogos
  const autoDay = byDay.has(today) || !agenda ? today : days.find((k) => k > today && byDay.has(k)) || today;
  const sel = params.get('d') || autoDay;
  const daysRef = useRef(null);
  useEffect(() => {
    const el = daysRef.current && daysRef.current.querySelector('.day.on');
    if (el) { const box = daysRef.current; box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2; }
  }, [sel, days.length]);

  if (!comps) return <><Skel h={260} /><Skel h={500} /></>;
  const feat = agenda ? featured(live, merged, comps) : live;
  const favIds = new Set(Object.keys(getFavs()).map(Number));
  let list = filter === 'live' ? live : (byDay.get(sel) || []);
  if (filter === 'mine') list = (byDay.get(sel) || []).filter((p) => favIds.has(+p.time_mandante.time_id) || favIds.has(+p.time_visitante.time_id) || Taste.team(p.time_mandante) + Taste.team(p.time_visitante) >= 1);
  const groups = new Map();
  [...list].sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0)).forEach((p) => {
    const id = p.campeonato ? p.campeonato.campeonato_id : 0;
    if (!groups.has(id)) groups.set(id, { c: compOf(comps, p), ps: [] });
    groups.get(id).ps.push(p);
  });
  const order = (id) => { const i = comps.findIndex((c) => c.campeonato_id === id); return compRank(id, i < 0 ? 99 : i); };
  const blocks = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([, g]) => g);
  // dia cheio (muitos campeonatos): abre só o que importa para a pessoa; o resto vira uma linha por campeonato
  const many = filter === 'all' && blocks.length > 6;
  const important = (g) => {
    const id = +g.c.campeonato_id;
    return TOP.has(id) || followsComp(id) || Taste.score('c', id) >= 3 || g.ps.some((p) => isLive(p)
      || favIds.has(+p.time_mandante.time_id) || favIds.has(+p.time_visitante.time_id) || followsTeam(p.time_mandante) || followsTeam(p.time_visitante));
  };
  const auto = new Map(blocks.map((g) => [g.c.campeonato_id || g.c.nome, !many || important(g)]));
  const isOpen = (id) => (manual[id] != null ? manual[id] : auto.get(id) !== false);
  const toggle = (id) => setManual((m) => ({ ...m, [id]: !isOpen(id) }));
  const allOpen = blocks.every((g) => isOpen(g.c.campeonato_id || g.c.nome));
  const setAll = (v) => setManual(Object.fromEntries(blocks.map((g) => [g.c.campeonato_id || g.c.nome, v])));
  const jump = (id) => {
    setManual((m) => ({ ...m, [id]: true }));
    requestAnimationFrame(() => { const el = document.getElementById(`cb-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  };
  const setQ = (k, v) => { const n = new URLSearchParams(params); if (v == null) n.delete(k); else n.set(k, v); setParams(n, { replace: true }); };

  return (
    <>
      <section className="home-hero">
        <div className="hh-head">
          <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease }}>
            {live.length ? <><LiveDot /> Ao vivo agora</> : 'Em destaque'}
          </motion.h1>
          <span>{live.length ? `${live.length} ${live.length === 1 ? 'jogo rolando' : 'jogos rolando'}` : 'Os jogos que importam hoje'} · arraste para ver mais</span>
        </div>
        {feat.length ? (
          <Rail>{feat.map((p) => <ScoreCard key={p.partida_id} p={p} comp={compOf(comps, p)} />)}</Rail>
        ) : <Skel h={170} />}
      </section>

      <CompStrip comps={comps} />

      <div className="grid-main">
        <div className="col">
          <Panel className="center">
            <ScrollRow className="daybar" trackRef={daysRef} step={0.6}>
              <div className="days">
                {days.map((k) => {
                  const d = new Date(k + 'T12:00:00');
                  const delta = Math.round((d - new Date(today + 'T12:00:00')) / 864e5);
                  const w = delta === 0 ? 'Hoje' : delta === -1 ? 'Ontem' : delta === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
                  const on = k === sel && filter !== 'live';
                  return (
                    <button key={k} className={`day ${on ? 'on' : ''} ${byDay.has(k) ? '' : 'none'}`} onClick={() => { const n = new URLSearchParams(); n.set('d', k); setParams(n, { replace: true }); }}>
                      {on && <motion.span layoutId="day-ind" className="day-ind" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                      <small>{w}</small><b>{d.getDate()} {d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</b>
                    </button>
                  );
                })}
              </div>
            </ScrollRow>
            <div className="filters">
              {[['all', 'Todos'], ['live', `Ao vivo · ${live.length}`], ['mine', 'Meus times']].map(([k, l]) => (
                <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setQ('f', k === 'all' ? null : k)}>{k === 'live' && <LiveDot />}{l}</button>
              ))}
            </div>
            {many && (
              <div className="cb-jump">
                <ScrollRow><div className="cb-jump-row">
                  {blocks.map((g) => {
                    const id = g.c.campeonato_id || g.c.nome;
                    return (
                      <button type="button" key={id} className={g.ps.some((p) => isLive(p)) ? 'live' : ''} onClick={() => jump(id)} title={g.c.nome_popular}>
                        <CompLogo c={g.c} size={18} dark />{g.c.nome_popular || g.c.nome}<em>{g.ps.length}</em>
                      </button>
                    );
                  })}
                </div></ScrollRow>
                <button type="button" className="cb-all" onClick={() => setAll(!allOpen)}>{allOpen ? 'Recolher' : 'Abrir todos'}</button>
              </div>
            )}
            {!agenda && filter !== 'live' ? <div className="pad"><Skel h={300} /></div>
              : blocks.length ? <CompBlocks key={`${sel}-${filter}`} groups={blocks} isOpen={isOpen} onToggle={many ? toggle : null} />
                : <Empty>{filter === 'live' ? 'Nenhum jogo em andamento agora.' : filter === 'mine' ? 'Nenhum jogo dos seus times neste dia.' : 'Nenhum jogo neste dia.'}</Empty>}
          </Panel>
        </div>
        <aside className="col side">
          <NBAWidget />
          <F1Widget />
          <TableWidget comps={comps} />
          <NewsWidget />
        </aside>
      </div>
    </>
  );
}

// campeonatos que sempre aparecem abertos no "Todos": Brasil, Conmebol, Champions e as 5 grandes ligas
const TOP = new Set([10, 14, 2, 7, 9, 106, 101, 102, 103, 104, 105]);

/* faixa de campeonatos: cada um com a sua cor e o logo oficial */
function CompStrip({ comps }) {
  return (
    <ScrollRow><Stagger className="cstrip">
      {comps.map((c) => {
        const th = compTheme(c);
        return (
          <Item key={c.campeonato_id}>
            <Link to={`/campeonato/${c.campeonato_id}`} className="ctile" style={{ '--m1': th.m1, '--m2': th.m2, '--acc': th.acc }}>
              <CompLogo c={c} size={34} dark />
              <span>{c.nome_popular || c.nome}</span>
            </Link>
          </Item>
        );
      })}
    </Stagger></ScrollRow>
  );
}

function NBAWidget() {
  const { data } = useApi('/esportes/nba/jogos', { ttl: 60_000 });
  const games = ((data && data.jogos) || []).slice(0, 4);
  if (!games.length) return null;
  return (
    <Panel className="w-nba">
      <Link to="/nba" className="w-head nba"><img src={LOGO.nba} alt="NBA" /><b>NBA</b><span>Ver jogos</span></Link>
      <Stagger className="w-nba-list">
        {games.map((g) => (
          <Item key={g.id}>
            <Link to={`/nba/jogo/${g.id}`} className={`w-nba-g ${g.status === 'andamento' ? 'live' : ''}`}>
              {[g.fora, g.casa].map((t, i) => (
                <span key={i} className={`t ${g.status === 'finalizado' && t.placar < (i ? g.fora : g.casa).placar ? 'lose' : ''}`}>
                  <img src={t.logo} alt="" /><b>{t.sigla}</b><em>{t.placar ?? ''}</em>
                </span>
              ))}
              <small>{g.status === 'andamento' ? <><LiveDot />{g.periodo}</> : g.status === 'finalizado' ? 'Final' : g.hora}</small>
            </Link>
          </Item>
        ))}
      </Stagger>
    </Panel>
  );
}

function F1Widget() {
  const { data } = useApi('/esportes/f1', { ttl: 300_000 });
  const nx = data && data.proxima;
  if (!nx) return null;
  const now = Date.now();
  const ses = nx.sessoes.find((s) => parseISO(s.data_iso) > now - 2 * 3600e3);
  return (
    <Panel className="w-f1">
      <Link to="/f1" className="w-f1-in">
        <img className="f1-lg" src={LOGO.f1} alt="Fórmula 1" />
        <small>Etapa {nx.rodada} · {nx.cidade}</small>
        <b>{nx.nome}</b>
        {ses && <><span className="w-f1-ses">{ses.nome} · {fmtDT(ses.data_iso)}</span>{parseISO(ses.data_iso) > now && <Countdown iso={ses.data_iso} className="mini" />}</>}
      </Link>
    </Panel>
  );
}

function TableWidget({ comps }) {
  const league = comps.find(isLeague);
  const { data } = useApi(league ? `/campeonatos/${league.campeonato_id}/tabela` : '', { ttl: 60_000, enabled: !!league });
  if (!league || !data) return null;
  const g = flattenTable(data);
  if (!g.length) return null;
  return (
    <Panel>
      <Head to={`/campeonato/${league.campeonato_id}`}><CompLogo c={league} size={20} /> {league.nome_popular}</Head>
      <Standings rows={g[0].rows.slice(0, 8)} campId={league.campeonato_id} compact />
    </Panel>
  );
}

function NewsWidget() {
  const { data } = useApi('/noticias?por_pagina=5', { ttl: 600_000 });
  const list = (data && data.noticias) || [];
  if (!list.length) return null;
  return (
    <Panel>
      <Head to="/noticias">Últimas notícias</Head>
      <Stagger className="news-mini">
        {list.map((n) => (
          <Item key={n.link} as="a" href={n.link} target="_blank" rel="noopener noreferrer" className="nm-row">
            {n.imagem && <img src={n.imagem} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}
            <span><b>{n.titulo}</b><small>{n.provedor ? n.provedor.nome : ''} · {timeAgo(n.publicado_em)}</small></span>
          </Item>
        ))}
      </Stagger>
    </Panel>
  );
}

