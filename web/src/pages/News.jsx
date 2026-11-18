import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useComps } from '../lib/data.js';
import { timeAgo } from '../lib/format.js';
import { Skel, Wait, Empty, Stagger, Item, CompLogo, ScrollRow, isDark, ease } from '../components/ui.jsx';

// redação: manchete principal grande e grade editorial
export default function News() {
  const [params, setParams] = useSearchParams();
  const comp = params.get('c') || '';
  const { data: comps } = useComps();
  const newsQ = useApi(`/noticias?por_pagina=30${comp ? `&campeonato_id=${comp}` : ''}`, { ttl: 600_000 });
  const { data } = newsQ;
  const list = (data && data.noticias) || [];
  const [lead, ...rest] = list;
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>Notícias</motion.h1>
      <ScrollRow><div className="filters chips-row">
        <button className={`chip ${!comp ? 'on' : ''}`} onClick={() => setParams({}, { replace: true })}>Todas</button>
        {(comps || []).map((c) => (
          <button key={c.campeonato_id} className={`chip ${comp === String(c.campeonato_id) ? 'on' : ''}`} onClick={() => setParams({ c: String(c.campeonato_id) }, { replace: true })}>
            <CompLogo c={c} size={16} dark={comp === String(c.campeonato_id) ? !isDark() : isDark()} />{c.nome_popular || c.nome}
          </button>
        ))}
      </div></ScrollRow>
      <AnimatePresence mode="wait">
        <motion.div key={comp} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
          {!data ? <Wait q={newsQ} h={500} /> : !list.length ? <Empty>Sem notícias agora.</Empty> : (
            <>
              <a className="lead-story" href={lead.link} target="_blank" rel="noopener noreferrer">
                {lead.imagem && <motion.img src={lead.imagem} alt="" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.2, ease }} />}
                <span className="ls-txt"><small>{lead.provedor ? lead.provedor.nome : ''} · {timeAgo(lead.publicado_em)}</small><b>{lead.titulo}</b></span>
              </a>
              <Stagger className="news-grid">
                {rest.map((n) => (
                  <Item key={n.link} as="a" className="story" href={n.link} target="_blank" rel="noopener noreferrer" whileHover={{ y: -4 }}>
                    <span className="story-img">{n.imagem ? <img src={n.imagem} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} /> : null}</span>
                    <b>{n.titulo}</b>
                    <small>{n.provedor ? n.provedor.nome : ''} · {timeAgo(n.publicado_em)}</small>
                  </Item>
                ))}
              </Stagger>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
