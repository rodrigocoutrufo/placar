import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useComps } from '../lib/data.js';
import { REGIONS, isLeague, regionLabel } from '../lib/format.js';
import { compTheme, compLogoDark } from '../lib/themes.js';
import { Skel, Stagger, Item, Tilt, ease } from '../components/ui.jsx';

function Poster({ c }) {
  const th = compTheme(c);
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
      </Tilt>
    </Item>
  );
}

// Europa: primeiro as competições continentais, depois um bloco por país (liga, segunda divisão e copas juntas,
// na ordem de importância que o servidor já manda)
function groupsOf(r, list) {
  if (r !== 'europa') return [[null, list]];
  const by = new Map();
  list.forEach((c) => {
    const k = regionLabel(c);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(c);
  });
  const cont = by.get('Europa');
  by.delete('Europa');
  return [...(cont ? [['Competições europeias', cont]] : []), ...by.entries()];
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
            {groupsOf(r, list).map(([sub, items]) => (
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
