import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useComps } from '../lib/data.js';
import { timeAgo, REGIONS, regionGroups } from '../lib/format.js';
import { compTheme } from '../lib/themes.js';
import { getFavs, useStoreVersion } from '../lib/store.js';
import { Wait, Empty, Stagger, Item, CompLogo, Crest, ScrollRow, isDark, ease } from '../components/ui.jsx';

const STEP = 30, MAX = 100; // o servidor entrega até 100 por página
const MAIN = 10; // campeonatos na faixa; o resto fica em "Mais campeonatos", por região

// campeonatos e times de que a notícia fala, como etiquetas
function Tags({ n, byId }) {
  const comps = (n.campeonatos || []).map((id) => byId[id]).filter(Boolean).slice(0, 2);
  const teams = (n.times || []).slice(0, 3);
  if (!comps.length && !teams.length) return null;
  return (
    <span className="ns-tags">
      {comps.map((c) => <span key={c.campeonato_id} className="ns-tag"><CompLogo c={c} size={14} dark={isDark()} />{c.nome_popular || c.nome}</span>)}
      {teams.map((t) => <span key={t.time_id || t.nome_popular} className="ns-tag team" title={t.nome_popular}><Crest t={t} size={16} /></span>)}
    </span>
  );
}

// notícia sem foto: capa com as cores do campeonato (ou do site) e o veículo
function Cover({ n, byId }) {
  const c = (n.campeonatos || []).map((id) => byId[id]).find(Boolean);
  const th = compTheme(c);
  return (
    <span className="ns-cover" style={{ '--m1': th.m1, '--m2': th.m2, '--acc': th.acc }}>
      {c ? <CompLogo c={c} size={46} dark /> : null}
      {n.provedor && n.provedor.logo && <img className="ns-cover-src" src={n.provedor.logo} alt="" />}
    </span>
  );
}

const Meta = ({ n }) => (
  <small className="ns-meta">
    {n.provedor && n.provedor.logo && <img src={n.provedor.logo} alt="" />}
    <b>{n.provedor ? n.provedor.nome : ''}</b> · {timeAgo(n.publicado_em)}
  </small>
);

export default function News() {
  const [params, setParams] = useSearchParams();
  const comp = params.get('c') || '';
  const mine = params.get('t') === 'meus';
  const outlet = params.get('v') || '';
  const [more, setMore] = useState(false);
  const [size, setSize] = useState(STEP);
  useStoreVersion(); // favoritos mudam a lista de "Meus times"
  const favs = Object.values(getFavs());
  const { data: comps } = useComps();
  const byId = Object.fromEntries((comps || []).map((c) => [c.campeonato_id, c]));

  const set = (patch) => {
    const next = Object.fromEntries(Object.entries({ c: comp, t: mine ? 'meus' : '', v: outlet, ...patch }).filter(([, v]) => v));
    setSize(STEP);
    setParams(next, { replace: true });
  };
  const q = [`por_pagina=${size}`, comp && `campeonato_id=${comp}`, mine && favs.length && `time_id=${favs.map((f) => f.time_id).join(',')}`, outlet && `provedor=${outlet}`].filter(Boolean).join('&');
  const newsQ = useApi(`/noticias?${q}`, { ttl: 600_000, keep: size > STEP });
  const { data } = newsQ;
  const list = (data && data.noticias) || [];
  const total = data ? data.paginacao.total : 0;
  const [lead, side1, side2, ...rest] = list;

  const all = comps || [];
  const strip = all.slice(0, MAIN);
  if (comp && !strip.some((c) => String(c.campeonato_id) === comp) && byId[comp]) strip.push(byId[comp]); // o escolhido sempre aparece
  const chip = (c) => (
    <button key={c.campeonato_id} className={`chip ${comp === String(c.campeonato_id) ? 'on' : ''}`} onClick={() => { set({ c: comp === String(c.campeonato_id) ? '' : String(c.campeonato_id) }); setMore(false); }}>
      <CompLogo c={c} size={16} dark={comp === String(c.campeonato_id) ? !isDark() : isDark()} />{c.nome_popular || c.nome}
    </button>
  );

  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>Notícias</motion.h1>
      <ScrollRow><div className="filters chips-row">
        <button className={`chip ${!comp && !mine ? 'on' : ''}`} onClick={() => set({ c: '', t: '' })}>Todas</button>
        {favs.length > 0 && <button className={`chip ${mine ? 'on' : ''}`} onClick={() => set({ t: mine ? '' : 'meus' })}>★ Meus times</button>}
        {strip.map(chip)}
        <button className={`chip more ${more ? 'on' : ''}`} onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Fechar' : `+ ${Math.max(0, all.length - MAIN)} campeonatos`}</button>
      </div></ScrollRow>
      <AnimatePresence initial={false}>
        {more && (
          <motion.div className="ns-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }}>
            {REGIONS.map(([r, label]) => {
              const cs = all.filter((c) => (c.regiao || 'nacional') === r);
              return cs.length ? regionGroups(r, cs).map(([sub, items]) => (
                <div key={r + (sub || '')} className="ns-more-reg"><small>{sub ? `${label} · ${sub}` : label}</small><div className="chips-wrap">{items.map(chip)}</div></div>
              )) : null;
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {data && data.provedores && data.provedores.length > 1 && (
        <ScrollRow><div className="filters outlets">
          <button className={`outlet ${!outlet ? 'on' : ''}`} onClick={() => set({ v: '' })}>Todos os veículos</button>
          {data.provedores.map((p) => (
            <button key={p.slug} className={`outlet ${outlet === p.slug ? 'on' : ''}`} onClick={() => set({ v: outlet === p.slug ? '' : p.slug })}>
              {p.logo && <img src={p.logo} alt="" />}{p.nome}<em>{p.total}</em>
            </button>
          ))}
        </div></ScrollRow>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={`${comp}|${mine}|${outlet}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
          {!data ? <Wait q={newsQ} h={500} /> : !list.length ? (
            <Empty>{mine ? 'Nenhuma notícia dos seus times agora.' : comp ? 'Sem notícias deste campeonato agora. Os portais brasileiros cobrem pouco algumas ligas; tente mais tarde.' : 'Sem notícias agora.'}</Empty>
          ) : (
            <>
              <div className="ns-top">
                <a className="lead-story" href={lead.link} target="_blank" rel="noopener noreferrer">
                  {lead.imagem ? <motion.img src={lead.imagem} alt="" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.2, ease }} /> : <Cover n={lead} byId={byId} />}
                  <span className="ls-txt">
                    <small>{lead.provedor ? lead.provedor.nome : ''} · {timeAgo(lead.publicado_em)}</small>
                    <b>{lead.titulo}</b>
                    {lead.resumo && <p>{lead.resumo}</p>}
                  </span>
                </a>
                {[side1, side2].filter(Boolean).map((n) => (
                  <motion.a key={n.link} className="ns-side" href={n.link} target="_blank" rel="noopener noreferrer" whileHover={{ y: -3 }}>
                    <span className="story-img">{n.imagem ? <img src={n.imagem} alt="" onError={(e) => e.currentTarget.remove()} /> : <Cover n={n} byId={byId} />}</span>
                    <span className="ns-side-txt"><Meta n={n} /><b>{n.titulo}</b>{n.resumo && <p>{n.resumo}</p>}<Tags n={n} byId={byId} /></span>
                  </motion.a>
                ))}
              </div>
              <Stagger className="news-grid">
                {rest.map((n) => (
                  <Item key={n.link} as="a" className="story" href={n.link} target="_blank" rel="noopener noreferrer" whileHover={{ y: -4 }}>
                    <span className="story-img">{n.imagem ? <img src={n.imagem} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} /> : <Cover n={n} byId={byId} />}</span>
                    <b>{n.titulo}</b>
                    <Meta n={n} />
                    <Tags n={n} byId={byId} />
                  </Item>
                ))}
              </Stagger>
              {total > list.length && size < MAX && (
                <div className="ns-load">
                  <button type="button" className="btn" disabled={newsQ.isFetching} onClick={() => setSize((s) => Math.min(MAX, s + STEP))}>
                    {newsQ.isFetching ? 'Carregando…' : `Carregar mais (${total - list.length})`}
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
