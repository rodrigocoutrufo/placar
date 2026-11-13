import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { Mode } from '../lib/mode.js';
import { Taste } from '../lib/store.js';
import { flattenTable, isLeague, regionLabel, roundsList, faseMatches, parseDate, fmtDay, timeAgo } from '../lib/format.js';
import { compLogoDark } from '../lib/themes.js';
import { Panel, Head, Skel, Empty, ErrorBox, Tabs, Stagger, Item, Watch, CountUp, Icon, LiveDot, ease } from '../components/ui.jsx';
import { Chances, Simulator, Bracket, CompStats, MovingTable, liveStandings } from './CompTabs.jsx';
import { Standings, RankList, MatchRow } from '../components/match.jsx';

export default function Competition() {
  const { id: sid, tab = 'tabela' } = useParams();
  const id = +sid;
  const camp = useApi(`/campeonatos/${id}`, { ttl: 600_000 });
  const fases = useApi(`/campeonatos/${id}/fases`, { ttl: 600_000 });
  const tv = useApi('/transmissoes', { ttl: 3_600_000 });
  const c = camp.data;
  useEffect(() => { if (c) { Mode.comp(c); if (tab === 'tabela') Taste.bump('c', id, 2, { n: c.nome_popular || c.nome }); } }, [c, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { scrollY } = useScroll();
  const yLogo = useTransform(scrollY, [0, 400], [0, 90]);
  const rot = useTransform(scrollY, [0, 400], [-8, 4]);

  if (camp.error) return <ErrorBox error={camp.error} retry={camp.refetch} />;
  if (!c) return <><Skel h={320} /><Skel h={500} /></>;
  if (Array.isArray(fases.data) && fases.data.length) c.fases = fases.data;
  const league = isLeague(c);
  const knockout = (c.fases || []).filter((f) => f.tipo === 'mata-mata');
  const base = `/campeonato/${id}`;
  const tabs = [['tabela', 'Classificação', `${base}/tabela`], ['jogos', 'Jogos', `${base}/jogos`]];
  const hasChances = league && id !== 106; // a Champions tem fase de liga + mata-mata: o modelo não se aplica
  if (hasChances) tabs.push(['chances', 'Chances', `${base}/chances`], ['simulador', 'Simulador', `${base}/simulador`]);
  if (knockout.length) tabs.push(['chaveamento', 'Chaveamento', `${base}/chaveamento`]);
  tabs.push(['artilharia', 'Artilharia', `${base}/artilharia`], ['assistencias', 'Assistências', `${base}/assistencias`], ['estatisticas', 'Estatísticas', `${base}/estatisticas`]);
  const wide = tab === 'simulador';
  const logo = compLogoDark(c);
  const prog = c.jogos_total ? (c.jogos_disputados / c.jogos_total) * 100 : null;
  const w = tv.data && tv.data.campeonatos && tv.data.campeonatos[String(id)] ? { ...tv.data.campeonatos[String(id)], atualizado_em: tv.data.atualizado_em } : null;

  return (
    <>
      <section className="takeover">
        <span className="to-pat" />
        {logo && <motion.img className="to-wm" src={logo} alt="" aria-hidden="true" style={{ y: yLogo, rotate: rot }} />}
        <div className="to-in">
          <motion.div className="to-logo" initial={{ opacity: 0, scale: 0.6, rotate: -10 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.1 }}>
            {logo && <img src={logo} alt="" />}
          </motion.div>
          <div className="to-txt">
            <motion.small initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.5, ease }}>{regionLabel(c)} · {c.edicao_atual ? c.edicao_atual.temporada || c.edicao_atual.nome : ''}</motion.small>
            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6, ease }}>{c.nome_popular || c.nome}</motion.h1>
            <motion.div className="to-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <span>{c.status === 'andamento' ? 'Em andamento' : c.status}</span>
              {!league && c.fase_atual && <span>Fase atual: <b>{c.fase_atual.nome}</b></span>}
              {c.rodada_atual && <span><b>{c.rodada_atual.nome}</b></span>}
              {c.jogos_total ? <span><b><CountUp value={c.jogos_disputados} /></b> de {c.jogos_total} jogos</span> : null}
            </motion.div>
            {prog != null && <div className="to-prog"><motion.i initial={{ width: 0 }} animate={{ width: `${prog}%` }} transition={{ duration: 1.2, ease, delay: 0.4 }} /></div>}
          </div>
        </div>
      </section>
      <div className="sticky-tabs"><Tabs items={tabs} active={tab} id="comp" /></div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} className={wide ? 'col' : 'grid-main'} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
          <div className="col">
            {tab === 'jogos' ? <Games c={c} />
              : tab === 'artilharia' || tab === 'assistencias' ? <Ranking id={id} tab={tab} />
                : tab === 'chances' && hasChances ? <Chances id={id} />
                  : tab === 'simulador' && hasChances ? <Simulator id={id} />
                    : tab === 'chaveamento' ? <Bracket c={c} />
                      : tab === 'estatisticas' ? <CompStats id={id} />
                        : <Table id={id} />}
          </div>
          {!wide && <aside className="col side">
            {tab === 'tabela' ? <Scorers id={id} /> : <MiniTable id={id} />}
            <Watch w={w} />
            <CompNews id={id} name={c.nome_popular || c.nome} />
          </aside>}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function Table({ id }) {
  const { data, error } = useApi(`/campeonatos/${id}/tabela`, { ttl: 60_000, refetch: 60_000 });
  const live = useLive();
  const [mode, setMode] = useState('atual');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Skel h={600} />;
  const groups = flattenTable(data);
  if (!groups.length) return <Panel><Empty>Sem tabela de pontos nesta fase. Veja o <Link to={`/campeonato/${id}/chaveamento`}>chaveamento</Link>.</Empty></Panel>;
  // jogo da liga rolando: "como fica se terminar agora"
  const lt = groups.length === 1 && !groups[0].title ? liveStandings(groups[0].rows, live) : null;
  return (
    <Panel className="flush">
      {lt && (
        <div className="seg">{[['atual', 'Tabela atual'], ['vivo', 'Ao vivo · se terminar agora']].map(([k, l]) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{k === 'vivo' && <LiveDot />} {l}{mode === k && <motion.span layoutId="seg-lt" className="seg-ind" />}</button>
        ))}</div>
      )}
      {lt && mode === 'vivo' ? <MovingTable rows={lt} campId={id} live /> : groups.map((g) => (
        <div key={g.title || 'u'}>{g.title && <h3 className="grp">{g.title}</h3>}<Standings rows={g.rows} campId={id} /></div>
      ))}
    </Panel>
  );
}

function MiniTable({ id }) {
  const { data } = useApi(`/campeonatos/${id}/tabela`, { ttl: 60_000 });
  const g = flattenTable(data || []);
  if (!g.length || g[0].title) return null;
  return <Panel><Head to={`/campeonato/${id}/tabela`}>Classificação</Head><Standings rows={g[0].rows.slice(0, 10)} campId={id} compact /></Panel>;
}

function Scorers({ id }) {
  const { data } = useApi(`/campeonatos/${id}/artilharia`, { ttl: 300_000 });
  if (!data || !data.length) return null;
  return <Panel><Head to={`/campeonato/${id}/artilharia`}>Artilheiros</Head><RankList list={data.slice(0, 5)} k="gols" unit=" gols" /></Panel>;
}

function Ranking({ id, tab }) {
  const { data, isLoading } = useApi(`/campeonatos/${id}/${tab}`, { ttl: 300_000 });
  const k = tab === 'artilharia' ? 'gols' : 'assistencias';
  if (isLoading) return <Skel h={500} />;
  return (
    <Panel>
      <Head>{tab === 'artilharia' ? 'Artilharia' : 'Assistências'}</Head>
      {data && data.length ? <RankList list={data.slice(0, 50)} k={k} /> : <Empty>Dados ainda não disponíveis para este campeonato.</Empty>}
    </Panel>
  );
}

// rodada a rodada (liga) ou fase a fase (mata-mata)
function Games({ c }) {
  const id = c.campeonato_id;
  const league = isLeague(c);
  const rounds = useApi(league ? `/campeonatos/${id}/rodadas` : '', { ttl: 600_000, enabled: league });
  const list = league ? roundsList(rounds.data) : (c.fases || []);
  const curIdx = league ? Math.max(0, list.findIndex((r) => c.rodada_atual && r.rodada === c.rodada_atual.rodada)) : Math.max(0, list.findIndex((f) => c.fase_atual && f.fase_id === c.fase_atual.fase_id));
  const [idx, setIdx] = useState(null);
  const i = idx ?? curIdx;
  const sel = list[i];
  const path = !sel ? '' : league ? `/campeonatos/${id}/rodadas/${sel.rodada}` : `/campeonatos/${id}/fases/${sel.fase_id}`;
  const { data } = useApi(path, { ttl: 60_000, enabled: !!path });
  const live = useLive();
  const lm = new Map(live.map((p) => [p.partida_id, p]));
  const games = data ? (league ? data.partidas || [] : faseMatches(data)).map((p) => lm.get(p.partida_id) || p) : null;
  const byDay = new Map();
  (games || []).slice().sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0)).forEach((p) => { const k = fmtDay(parseDate(p)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); });
  if (league && !rounds.data) return <Skel h={500} />;
  return (
    <Panel className="flush">
      <div className="roundbar">
        <button className="ibtn" disabled={i <= 0} onClick={() => setIdx(i - 1)} aria-label="Anterior">{Icon.left}</button>
        <AnimatePresence mode="wait">
          <motion.b key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            {sel ? (league ? `${sel.rodada}ª rodada` : sel.nome) : '—'}
          </motion.b>
        </AnimatePresence>
        <button className="ibtn" disabled={i >= list.length - 1} onClick={() => setIdx(i + 1)} aria-label="Próxima">{Icon.right}</button>
      </div>
      {!games ? <div className="pad"><Skel h={400} /></div> : games.length ? (
        <Stagger key={path}>
          {[...byDay].map(([d, ps]) => (
            <div key={d}><div className="date-sep">{d}</div>{ps.map((p) => <MatchRow key={p.partida_id} p={p} />)}</div>
          ))}
        </Stagger>
      ) : <Empty>Nenhum jogo nesta etapa.</Empty>}
    </Panel>
  );
}

function CompNews({ id, name }) {
  const { data } = useApi(`/noticias?por_pagina=5&campeonato_id=${id}`, { ttl: 600_000 });
  const list = (data && data.noticias) || [];
  if (!list.length) return null;
  return (
    <Panel>
      <Head to="/noticias">Notícias · {name}</Head>
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

