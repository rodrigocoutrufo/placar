import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useComps } from '../lib/data.js';
import { REGIONS, isLeague, regionGroups } from '../lib/format.js';
import { compTheme, compLogoDark } from '../lib/themes.js';
import { Skel, Stagger, Item, Tilt, Icon, ease } from '../components/ui.jsx';
import { followsCompHome, toggleFollowComp } from '../lib/follow.js';
import { useStoreVersion } from '../lib/store.js';

function Poster({ c }) {
  useStoreVersion();
  const th = compTheme(c);
  const on = followsCompHome(c.campeonato_id);
  const prog = c.jogos_total ? Math.round((c.jogos_disputados / c.jogos_total) * 100) : null;
  return (
    <Item>
      <Tilt className="poster" style={{ '--m1': th.m1, '--m2': th.m2, '--acc': th.acc }} data-pat={th.pat}>
        <Link to={`/campeonato/${c.campeonato_id}`} className="poster-in">
          <span className="poster-pat" />
          <img className="poster-wm" src={compLogoDark(c)} alt="" aria-hidden="true" />
          <img className="poster-logo" src={compLogoDark(c)} alt="" />
          <span className="poster-txt">
            <b>{c.nome_popular || c.nome}</b>
            <small>{c.edicao_atual ? c.edicao_atual.nome : ''}</small>
            <em>{c.fase_atual && !isLeague(c) ? c.fase_atual.nome : c.rodada_atual ? c.rodada_atual.nome : c.status === 'andamento' ? 'Em andamento' : ''}</em>
          </span>
          {prog != null && <span className="poster-prog"><motion.i initial={{ width: 0 }} animate={{ width: `${prog}%` }} transition={{ duration: 1, ease, delay: 0.3 }} /></span>}
          <span className="scard-glare" />
        </Link>
        <button type="button" className={`poster-star ${on ? 'on' : ''}`} onClick={() => toggleFollowComp(c.campeonato_id)} aria-pressed={on}
          aria-label={on ? `Deixar de seguir ${c.nome_popular}` : `Seguir ${c.nome_popular}`} title={on ? 'Seguindo (aparece na página inicial)' : 'Seguir'}>{Icon.star}</button>
      </Tilt>
    </Item>
  );
}

// Estaduais e regionais: cartazes baixos; fora da temporada (todos encerrados) ficam recolhidos numa linha
function Regionals({ list }) {
  const done = list.every((c) => c.status === 'finalizado');
  const [open, setOpen] = useState(!done);
  if (!open) {
    const year = (list[0] && list[0].edicao_atual && list[0].edicao_atual.temporada) || '';
    return (
      <div className="reg-fold">
        <span className="reg-fold-logos">{list.map((c) => <img key={c.campeonato_id} src={compLogoDark(c)} alt={c.nome_popular} title={c.nome_popular} />)}</span>
        <span>Temporada {year} encerrada · voltam no começo do ano</span>
        <button type="button" className="chip" onClick={() => setOpen(true)}>Ver {list.length}</button>
      </div>
    );
  }
  return <Stagger className="poster-grid compact">{list.map((c) => <Poster key={c.campeonato_id} c={c} />)}</Stagger>;
}

// "menu de seleção": cada campeonato é um cartaz com a sua identidade
export default function Competitions() {
  const { data: comps } = useComps();
  if (!comps) return <Skel h={520} />;
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>Campeonatos</motion.h1>
      {REGIONS.map(([r, label]) => {
        const list = comps.filter((c) => (c.regiao || 'nacional') === r);
        if (!list.length) return null;
        return (
          <section key={r} className="reg">
            <h2 className="reg-title">{label}</h2>
            {r === 'estadual' ? <Regionals list={list} /> : regionGroups(r, list).map(([sub, items]) => (
              <div key={sub || r} className="reg-group">
                {sub && <h3 className="reg-sub">{sub}</h3>}
                <Stagger className="poster-grid">{items.map((c) => <Poster key={c.campeonato_id} c={c} />)}</Stagger>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
