import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useOtherLive } from '../lib/live.js';
import { LOGO } from '../lib/themes.js';
import { parseISO, fmtDT } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Tabs, Stagger, Item, Countdown, LiveDot, Watch, CountUp, ease } from '../components/ui.jsx';

const flag = (src, w = 22) => (src ? <img className="flag" src={src} alt="" width={w} loading="lazy" /> : null);
const classic = (h) => `#${h}`;

export default function F1() {
  const { tab = 'pilotos' } = useParams();
  const q = useApi('/esportes/f1', { ttl: 60_000, critical: true });
  const tv = useApi('/transmissoes', { ttl: 3_600_000 });
  const other = useOtherLive();
  const d = q.data;
  if (!d) return <><Skel h={380} /><Skel h={500} /></>;
  const nx = d.proxima, now = Date.now();
  const nextSession = nx ? nx.sessoes.find((s) => parseISO(s.data_iso) > now - 2 * 3600e3) : null;
  const live = other.f1 || (d.fim_de_semana && d.fim_de_semana.ao_vivo);
  const T = d.titulo;
  const w = tv.data && tv.data.campeonatos && tv.data.campeonatos.f1 ? { ...tv.data.campeonatos.f1, atualizado_em: tv.data.atualizado_em } : null;
  return (
    <>
      <section className="pitwall">
        <span className="pw-carbon" />
        <motion.span className="pw-slash" initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.8, ease }} />
        <div className="pw-in">
          <motion.img className="pw-logo" src={LOGO.f1} alt="Fórmula 1" initial={{ opacity: 0, x: -60, skewX: -14 }} animate={{ opacity: 1, x: 0, skewX: 0 }} transition={{ duration: 0.6, ease }} />
          {nx && (
            <div className="pw-race">
              <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>Etapa {nx.rodada} de {d.etapas} · {nx.cidade}</motion.small>
              <motion.h1 initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.5, ease }}>{nx.nome}</motion.h1>
              <span className="pw-circ">{nx.circuito}</span>
            </div>
          )}
          {nextSession && parseISO(nextSession.data_iso) > now && (
            <motion.div className="pw-cd" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5, ease }}>
              <small>Próxima sessão · <b>{nextSession.nome}</b></small>
              <Countdown iso={nextSession.data_iso} className="big" />
            </motion.div>
          )}
        </div>
        {nx && (
          <Stagger className="pw-sessions">
            {nx.sessoes.map((s) => {
              const t = parseISO(s.data_iso), past = t && t < now - 2 * 3600e3;
              return (
                <Item key={s.nome} className={`ses ${past ? 'past' : ''} ${nextSession === s ? 'next' : ''} ${s.nome === 'Corrida' ? 'race' : ''}`}>
                  <b>{s.nome}</b><span>{fmtDT(s.data_iso)}</span>
                </Item>
              );
            })}
          </Stagger>
        )}
        {nx && <Link className="pw-btn" to={`/f1/corrida/${nx.rodada}`}>Detalhes da etapa</Link>}
      </section>

      {live && (
        <Panel className="f1-live">
          <Head sub={live.volta ? `volta ${live.volta}` : ''}><LiveDot /> Ao vivo · {live.nome}</Head>
          <Stagger className="tower">{(live.ordem || []).map((x) => (
            <Item key={x.pos + x.nome} className="tw-row" layout><span className="p">{x.pos}</span>{flag(x.bandeira, 18)}<b>{x.nome}</b></Item>
          ))}</Stagger>
        </Panel>
      )}

      {T && (
        <motion.div className="champ" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5, ease }}>
          <span className="champ-bar" />
          <div><b>{T.decidido ? `${T.lider} é campeão mundial de ${d.temporada}` : `${T.lider} lidera por ${T.vantagem} pontos`}</b>
            <small>{T.decidido ? `Vantagem de ${T.vantagem} pontos com só ${T.pontos_em_jogo} em jogo nas ${d.restantes} etapas restantes.` : `Ainda há ${T.pontos_em_jogo} pontos em jogo.${T.pode_decidir_no_proximo ? ' O título pode ser decidido no próximo GP.' : ''}`}</small></div>
        </motion.div>
      )}

      <div className="sticky-tabs"><Tabs id="f1" active={tab} items={[['pilotos', 'Pilotos', '/f1'], ['construtores', 'Construtores', '/f1/construtores'], ['calendario', 'Calendário', '/f1/calendario']]} /></div>
      <div className="grid-main">
        <div className="col">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease }}>
              {tab === 'construtores' ? <Constructors d={d} /> : tab === 'calendario' ? <Calendar d={d} nx={nx} /> : <Drivers d={d} />}
            </motion.div>
          </AnimatePresence>
        </div>
        <aside className="col side">
          <Watch w={w} title="Onde assistir a F1" />
          {d.fim_de_semana && !live && (d.fim_de_semana.sessoes || []).some((s) => s.ordem.length) && (
            <Panel><Head>{d.fim_de_semana.nome || 'Fim de semana'}</Head>
              {d.fim_de_semana.sessoes.filter((s) => s.ordem.length).slice(-3).reverse().map((s) => (
                <div key={s.nome} className="pad"><h4 className="st-sec">{s.nome}</h4>{s.ordem.slice(0, 3).map((x) => <div key={x.pos} className="tw-row"><span className="p">{x.pos}</span>{flag(x.bandeira, 16)}<b>{x.nome}</b></div>)}</div>
              ))}
            </Panel>
          )}
          <Panel className="note">Calendário, resultados e classificação: Jolpica (base Ergast). Sessão ao vivo: ESPN. Horários de Brasília.</Panel>
        </aside>
      </div>
    </>
  );
}

// torre de cronometragem
function Drivers({ d }) {
  const max = (d.pilotos[0] || {}).pontos || 1;
  return (
    <Panel className="flush tower-panel">
      <Stagger className="tower">
        {d.pilotos.map((x) => {
          const c = (x.piloto.equipe || {}).cor || '#888';
          return (
            <Item key={x.piloto.id}>
              <a className={`tw ${x.piloto.brasileiro ? 'br' : ''}`} href={classic(`/f1/piloto/${x.piloto.id}`)} style={{ '--tc': c }}>
                <span className={`p p${x.posicao}`}>{x.posicao}</span>
                <span className="tc" />
                {x.piloto.foto_oficial ? <img className="tw-face" src={x.piloto.foto_oficial} alt="" loading="lazy" /> : flag(x.piloto.bandeira)}
                <span className="nm"><b>{x.piloto.nome}</b><small>{(x.piloto.equipe || {}).nome}{x.vitorias ? ` · ${x.vitorias} vitória${x.vitorias === 1 ? '' : 's'}` : ''}</small></span>
                <span className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(x.pontos / max) * 100}%` }} transition={{ duration: 1, ease, delay: 0.15 + x.posicao * 0.02 }} /></span>
                <b className="pt"><CountUp value={x.pontos} /></b>
              </a>
            </Item>
          );
        })}
      </Stagger>
    </Panel>
  );
}

function Constructors({ d }) {
  const max = (d.construtores[0] || {}).pontos || 1;
  return (
    <Panel className="flush tower-panel">
      <Stagger className="tower">
        {d.construtores.map((c) => (
          <Item key={c.equipe.id}>
            <a className="tw" href={classic(`/f1/equipe/${c.equipe.id}`)} style={{ '--tc': c.equipe.cor }}>
              <span className={`p p${c.posicao}`}>{c.posicao}</span><span className="tc" />
              <span className="nm"><b>{c.equipe.nome}</b><small>{c.vitorias} vitória{c.vitorias === 1 ? '' : 's'}</small></span>
              <span className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(c.pontos / max) * 100}%` }} transition={{ duration: 1, ease }} /></span>
              <b className="pt"><CountUp value={c.pontos} /></b>
            </a>
          </Item>
        ))}
      </Stagger>
    </Panel>
  );
}

function Calendar({ d, nx }) {
  return (
    <Stagger className="cal">
      {d.calendario.map((r) => (
        <Item key={r.rodada}>
          <Link to={`/f1/corrida/${r.rodada}`} className={`gp ${r.status} ${nx && r.rodada === nx.rodada ? 'next' : ''}`}>
            <span className="gp-rd">{String(r.rodada).padStart(2, '0')}</span>
            <span className="gp-when">{fmtDT(r.data_iso, { day: '2-digit', month: 'short' })}</span>
            <span className="gp-nm"><b>{r.nome}</b><small>{r.circuito}{r.sprint ? ' · sprint' : ''}</small></span>
            <span className="gp-win">{r.vencedor ? <>{flag(r.vencedor.bandeira, 18)}<b>{r.vencedor.sobrenome}</b><i style={{ background: (r.vencedor.equipe || {}).cor || '#888' }} /></> : nx && r.rodada === nx.rodada ? <em>Próxima</em> : null}</span>
          </Link>
        </Item>
      ))}
      {!d.calendario.length && <Empty>Sem calendário.</Empty>}
    </Stagger>
  );
}
