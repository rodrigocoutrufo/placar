import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { useComps, useAgenda, compOf } from '../lib/data.js';
import { Taste, matchAffinity, getFavs, useStoreVersion } from '../lib/store.js';
import { isLive, parseDate, timeAgo } from '../lib/format.js';
import { LOGO } from '../lib/themes.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Crest, ease } from '../components/ui.jsx';
import { ScoreCard } from '../components/match.jsx';
import { NBAGameCard } from './NBA.jsx';

export default function ForYou() {
  useStoreVersion();
  const live = useLive();
  const { data: comps } = useComps();
  const { data: agenda } = useAgenda(comps);
  const { data: news } = useApi('/noticias?por_pagina=40', { ttl: 600_000 });
  const { data: nba } = useApi('/esportes/nba/jogos', { ttl: 60_000 });
  const { data: f1 } = useApi('/esportes/f1', { ttl: 300_000 });
  const { data: st } = useApi('/ia/status', { ttl: 600_000 });
  const favs = Object.values(getFavs());
  const teams = [...new Set([...favs.map((t) => t.nome_popular), ...Taste.top('t', 8).map((x) => x.m && x.m.n).filter(Boolean)])].slice(0, 8);
  const compIds = Taste.top('c', 4).map((x) => x.id).filter((x) => /^\d+$/.test(x));
  const qs = new URLSearchParams({ times: teams.join(','), campeonatos: compIds.join(',') }).toString();
  const day = useApi(st && st.ativo && (teams.length || compIds.length) ? `/ia/para-voce?${qs}` : '', { ttl: 30 * 60_000 });

  if (!comps || !agenda) return <><Skel h={220} /><Skel h={400} /></>;
  const now = Date.now();
  const lm = new Map(live.map((p) => [p.partida_id, p]));
  const all = [...live, ...agenda.filter((p) => !lm.has(p.partida_id))];
  const mine = all.filter((p) => {
    const d = parseDate(p);
    return isLive(p) || (p.status !== 'finalizado' && d && d - now > -3 * 36e5 && d - now < 6 * 864e5) || (p.status === 'finalizado' && d && now - d < 30 * 36e5);
  }).map((p) => ({ p, ...matchAffinity(p) })).filter((x) => x.s >= 1 && x.why)
    .sort((a, b) => (isLive(b.p) - isLive(a.p)) || (b.p.status !== 'finalizado') - (a.p.status !== 'finalizado') || b.s - a.s || (parseDate(a.p) || 0) - (parseDate(b.p) || 0))
    .slice(0, 12);
  const nbaFollow = new Set(Taste.top('n', 10).map((x) => +x.id));
  const nbaGames = ((nba && nba.jogos) || []).filter((g) => nbaFollow.has(+g.casa.id) || nbaFollow.has(+g.fora.id));
  const likesF1 = Taste.score('e', 'f1') >= 3 || Taste.top('p', 1).length > 0;
  const nx = f1 && f1.proxima;
  const ranked = rankNews(((news && news.noticias) || []).filter((n) => !/feminin|sub-?\d{2}|\bbase\b/i.test(n.titulo || ''))).slice(0, 8);
  const h = new Date().getHours();
  const nLive = mine.filter((x) => isLive(x.p)).length;
  const learning = Taste.empty();

  return (
    <>
      <section className="fy-hero">
        <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Para você</motion.small>
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>{h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}.</motion.h1>
        <p>{learning ? 'Siga seus times e abra os jogos que te interessam: o Placar aprende e monta esta página para você.' : nLive ? `${nLive} jogo${nLive > 1 ? 's' : ''} do seu interesse rolando agora.` : mine.length ? `${mine.length} jogos do seu interesse nos próximos dias.` : 'Nenhum jogo dos seus times nos próximos dias.'}</p>
        <div className="fy-chips">
          {favs.map((t) => <a key={t.time_id} href={`#/time/${t.time_id}`} className="fchip"><Crest t={t} size={18} />{t.nome_popular}</a>)}
          {Taste.top('c', 4).filter((x) => x.m && x.m.n).map((x) => <Link key={x.id} to={`/campeonato/${x.id}`} className="fchip">{x.m.n}</Link>)}
        </div>
      </section>
      <div className="grid-main">
        <div className="col">
          {day.data && day.data.resumo && (
            <Panel className="ai">
              <Head sub="resumo gerado por IA">{day.data.resumo.titulo}</Head>
              <Stagger as="ul" className="day-list">{day.data.resumo.itens.map((it, i) => <Item as="li" key={i}>{it.texto}</Item>)}</Stagger>
            </Panel>
          )}
          {mine.length > 0 && (
            <section>
              <h2 className="sec-h">Seus jogos</h2>
              <Stagger className="card-grid">{mine.map(({ p, why }) => <Item key={p.partida_id}><ScoreCard p={p} comp={compOf(comps, p)} why={why} /></Item>)}</Stagger>
            </section>
          )}
          {nbaGames.length > 0 && (
            <section><h2 className="sec-h"><img src={LOGO.nba} alt="" className="sec-lg" /> Na NBA</h2><Stagger className="led-grid">{nbaGames.map((g) => <NBAGameCard key={g.id} g={g} />)}</Stagger></section>
          )}
          {likesF1 && nx && (
            <Link to="/f1" className="fy-f1"><img src={LOGO.f1} alt="F1" /><span><small>Etapa {nx.rodada}</small><b>{nx.nome}</b><em>{nx.circuito}</em></span></Link>
          )}
          {ranked.length > 0 && (
            <Panel>
              <Head to="/noticias">Notícias para você</Head>
              <Stagger className="news-mini">
                {ranked.map((n) => (
                  <Item key={n.link} as="a" href={n.link} target="_blank" rel="noopener noreferrer" className="nm-row">
                    {n.imagem && <img src={n.imagem} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}
                    <span><b>{n.titulo}</b><small>{n.provedor ? n.provedor.nome : ''} · {timeAgo(n.publicado_em)}</small></span>
                  </Item>
                ))}
              </Stagger>
            </Panel>
          )}
          {!mine.length && !ranked.length && <Panel><Empty>Ainda aprendendo o que você gosta.</Empty></Panel>}
        </div>
        <aside className="col side">
          <Panel>
            <Head right={<a className="phead-more" href="#/favoritos">Gerenciar</a>}>Seus times</Head>
            {favs.length ? <Stagger className="list">{favs.map((t) => <Item key={t.time_id} as="a" className="li" href={`#/time/${t.time_id}`}><Crest t={t} size={24} /><b>{t.nome_popular}</b></Item>)}</Stagger>
              : <p className="pad small muted">Abra a página de um time e toque em Seguir.</p>}
          </Panel>
          <Panel>
            <Head>Seus interesses</Head>
            <div className="pad fy-chips">
              {Taste.top('t', 10).filter((x) => x.m && x.m.n).map((x) => <span key={x.id} className="fchip">{x.m.e && <img src={x.m.e} alt="" width="16" />}{x.m.n}</span>)}
              {Taste.top('c', 6).filter((x) => x.m && x.m.n).map((x) => <Link key={x.id} className="fchip" to={`/campeonato/${x.id}`}>{x.m.n}</Link>)}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function rankNews(list) {
  const now = Date.now();
  return list.map((n) => {
    const aff = (n.times || []).reduce((s, t) => s + Taste.team(t), 0);
    const d = n.publicado_em ? new Date(String(n.publicado_em).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
    const hours = d ? (now - d) / 36e5 : 48;
    return { n, s: Math.min(aff, 60) * 1.5 + 30 / (1 + hours / 6) };
  }).sort((a, b) => b.s - a.s).map((x) => x.n);
}
