import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useOtherLive } from '../lib/live.js';
import { Taste } from '../lib/store.js';
import { LOGO } from '../lib/themes.js';
import { fmtDT } from '../lib/format.js';
import { getNotif, setNotif } from '../lib/notify.js';
import { Bell } from '../components/Notify.jsx';
import { Panel, Head, Skel, Wait, Empty, Tabs, Stagger, Item, Tilt, Digit, LiveDot, Watch, Icon, ease } from '../components/ui.jsx';

export function NBAHero({ sub, action = null }) {
  return (
    <section className="arena">
      <span className="arena-court" />
      <motion.img className="arena-logo" src={LOGO.nba} alt="NBA" initial={{ opacity: 0, y: 30, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 16 }} />
      <div className="arena-txt">
        <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.5, ease }}>NBA</motion.h1>
        <span>{sub}</span>
        {action}
      </div>
    </section>
  );
}

// placar eletrônico de um jogo
export function NBAGameCard({ g }) {
  const live = g.status === 'andamento', done = g.status === 'finalizado';
  const lead = (g.lideres || []).filter((l) => l.categoria === 'PTS').map((l) => `${l.nome} ${l.valor}`).join(' · ');
  const team = (t, o) => (
    <div className={`led-t ${done && t.placar > o.placar ? 'win' : done ? 'lose' : ''}`}>
      <img src={t.logo} alt="" /><b>{t.curto || t.nome}</b><small>{t.recorde}</small>
      <span className="led-n">{t.placar != null ? <Digit v={t.placar} /> : ''}</span>
    </div>
  );
  return (
    <Item>
      <Tilt className={`led ${live ? 'is-live' : ''}`} max={5}>
        <Link to={`/nba/jogo/${g.id}`} className="led-in">
          <div className="led-st">{live ? <><LiveDot />{g.periodo}</> : done ? 'Final' : g.hora || fmtDT(g.data_iso, { hour: '2-digit', minute: '2-digit' })}</div>
          {team(g.fora, g.casa)}{team(g.casa, g.fora)}
          {lead && !g.status.startsWith('agend') && <div className="led-lead">{lead}</div>}
          <span className="scard-glare" />
        </Link>
      </Tilt>
    </Item>
  );
}

export default function NBA() {
  const { tab = 'jogos' } = useParams();
  const [params] = useSearchParams();
  const date = params.get('data') || '';
  const other = useOtherLive();
  const live = (other.nba || []).length;
  const q = useApi(`/esportes/nba/jogos${date ? `?data=${date}` : ''}`, { ttl: 20_000, refetch: live ? 20_000 : false, critical: true });
  const tv = useApi('/transmissoes', { ttl: 3_600_000 });
  const w = tv.data && tv.data.campeonatos && tv.data.campeonatos.nba ? { ...tv.data.campeonatos.nba, atualizado_em: tv.data.atualizado_em } : null;
  const d = q.data;
  const shift = (n) => { const x = new Date(`${(d && d.data) || new Date().toISOString().slice(0, 10)}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
  const day = d && d.data ? new Date(`${d.data}T12:00:00`) : new Date();
  const nLive = d ? d.jogos.filter((g) => g.status === 'andamento').length : 0;
  return (
    <>
      <NBAHero action={<Bell on={() => getNotif().nbaTodos} onClick={() => setNotif({ nbaTodos: !getNotif().nbaTodos })} label="Avisar todos os jogos" onLabel="Avisando todos os jogos" className="on-dark" />} sub={tab === 'classificacao' ? 'Temporada 2026-27 · classificação por conferência' : d ? `${nLive ? `${nLive} ao vivo · ` : ''}${d.jogos.length} jogos` : 'Carregando…'} />
      <div className="sticky-tabs"><Tabs id="nba" active={tab} items={[['jogos', 'Jogos', '/nba'], ['classificacao', 'Classificação', '/nba/classificacao']]} /></div>
      {tab === 'classificacao' ? <Standings /> : (
        <div className="grid-main">
          <div className="col">
            <Panel className="flush dark-panel">
              <div className="roundbar">
                <Link className="ibtn" to={`/nba?data=${shift(-1)}`} replace aria-label="Dia anterior">{Icon.left}</Link>
                <AnimatePresence mode="wait"><motion.b key={day.toDateString()} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>{day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</motion.b></AnimatePresence>
                <Link className="ibtn" to={`/nba?data=${shift(1)}`} replace aria-label="Próximo dia">{Icon.right}</Link>
              </div>
              <p className="hint">Data dos EUA · horários de Brasília</p>
              {!d ? <div className="pad"><Skel h={300} /></div> : d.jogos.length ? (
                <Stagger key={d.data} className="led-grid">{d.jogos.map((g) => <NBAGameCard key={g.id} g={g} />)}</Stagger>
              ) : <Empty>Nenhum jogo neste dia.</Empty>}
              {date && <div className="pad"><Link className="btn" to="/nba">Voltar para hoje</Link></div>}
            </Panel>
          </div>
          <aside className="col side">
            <Watch w={w} title="Onde assistir a NBA" />
            <Panel className="note">Placar, box score e chance de vitória pela ESPN, atualizados ao vivo.</Panel>
          </aside>
        </div>
      )}
    </>
  );
}

function Standings() {
  const sq = useApi('/esportes/nba/classificacao', { ttl: 300_000 });
  const { data } = sq;
  if (!data) return <Wait q={sq} h={600} />;
  return (
    <div className="grid-2">
      {data.map((c) => (
        <Panel key={c.nome} className="flush">
          <Head>{c.nome}</Head>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th className="l">Time</th><th>V</th><th>D</th><th>%</th><th className="hs">Atrás</th><th className="hs">Seq.</th><th className="hs">Últ. 10</th></tr></thead>
              <motion.tbody variants={{ show: { transition: { staggerChildren: 0.03 } } }} initial="hidden" animate="show">
                {c.times.map((r) => (
                  <motion.tr key={r.time.id} variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }}>
                    <td className="pos" style={{ '--z': r.posicao <= 6 ? '#1d6ff2' : r.posicao <= 10 ? '#f59e0b' : 'transparent' }}>{r.posicao}</td>
                    <td className="team l"><a href={`#/nba/time/${r.time.id}`}><img className="crest" src={r.time.logo} alt="" width="22" height="22" /><span>{r.time.curto || r.time.nome}</span></a></td>
                    <td className="pts"><b>{r.v}</b></td><td>{r.d}</td><td>{r.pct}</td><td className="hs">{r.atras || '–'}</td><td className="hs">{r.sequencia}</td><td className="hs">{r.ultimos10}</td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
          <div className="legend"><span style={{ '--c': '#1d6ff2' }}>Playoffs (1º a 6º)</span><span style={{ '--c': '#f59e0b' }}>Play-in (7º a 10º)</span></div>
        </Panel>
      ))}
    </div>
  );
}
