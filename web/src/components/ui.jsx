import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';
import { PERIOD_END, liveLabel, parseISO } from '../lib/format.js';
import { brandsOf, TV_KIND, compLogo } from '../lib/themes.js';
import { useStoreVersion } from '../lib/store.js';

export const ease = [0.22, 1, 0.36, 1];
export const isDark = () => document.documentElement.dataset.theme === 'dark';

/* ---------- escudos e logos ---------- */
export function Crest({ t, size = 24, className = '' }) {
  useStoreVersion(); // troca a versão clara/escura junto com o tema
  const [failed, setFailed] = useState(false);
  const src = t && ((isDark() && t.escudo_escuro) || t.escudo || t.escudo_escuro || t.logo);
  if (!src || failed) return <span className={`crest ph ${className}`} style={{ width: size, height: size }} />;
  return <img className={`crest ${className}`} src={src} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
export function CompLogo({ c, size = 20, dark, className = '' }) {
  useStoreVersion();
  const src = compLogo(c, dark ?? isDark());
  if (!src) return null;
  return <img className={`crest ${className}`} src={src} width={size} height={size} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
}

/* ---------- estrutura ---------- */
export const Panel = ({ children, className = '', ...p }) => <section className={`panel ${className}`} {...p}>{children}</section>;
export function Head({ children, right, to, sub }) {
  return (
    <header className="phead">
      <h2>{children}{sub && <small>{sub}</small>}</h2>
      {right}
      {to && <Link className="phead-more" to={to}>Ver tudo <Arrow /></Link>}
    </header>
  );
}
export const Arrow = () => <svg className="arr" viewBox="0 0 16 16" width="14" height="14"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
export const Skel = ({ h = 120, className = '' }) => <div className={`skel ${className}`} style={{ height: h }} />;
export const Empty = ({ children }) => <div className="empty">{children}</div>;
export function ErrorBox({ error, retry }) {
  return (
    <Panel className="err">
      <b>Não foi possível carregar</b>
      <span>{error && error.message}</span>
      {retry && <button className="btn" onClick={retry}>Tentar de novo</button>}
    </Panel>
  );
}

/* ---------- listas que entram em cascata ---------- */
export const listV = { hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } } };
export const itemV = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } } };
export const Stagger = ({ as = 'div', children, className = '', ...p }) => {
  const C = motion[as];
  return <C className={className} variants={listV} initial="hidden" animate="show" {...p}>{children}</C>;
};
export const Item = ({ as = 'div', children, className = '', ...p }) => {
  const C = motion[as];
  return <C className={className} variants={itemV} {...p}>{children}</C>;
};
export const Reveal = ({ children, className = '', delay = 0 }) => (
  <motion.div className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.6, ease, delay }}>{children}</motion.div>
);

/* ---------- abas com indicador deslizante ---------- */
export function Tabs({ items, active, id = 'tabs', className = '' }) {
  return (
    <nav className={`tabs ${className}`}>
      {items.map(([k, label, to, ext]) => {
        const on = k === active;
        const inner = <>{label}{on && <motion.span layoutId={`tab-${id}`} className="tab-ind" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}</>;
        return ext
          ? <a key={k} href={to} className="tab">{label}<span className="ext">↗</span></a>
          : <Link key={k} to={to} className={`tab ${on ? 'on' : ''}`} replace>{inner}</Link>;
      })}
    </nav>
  );
}

/* ---------- faixa que rola para os lados, com setas, arrastar e roda do mouse ---------- */
export function ScrollRow({ children, className = '', step = 0.8, trackRef = null }) {
  const ref = useRef(null);
  const setRef = (el) => { ref.current = el; if (trackRef) trackRef.current = el; };
  const [edge, setEdge] = useState({ l: false, r: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // roda do mouse vertical vira rolagem lateral
    const wheel = (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { e.preventDefault(); el.scrollBy({ left: e.deltaY }); } };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); };
  }, [children]); // eslint-disable-line react-hooks/exhaustive-deps
  // arrastar com o mouse (no toque o navegador já rola sozinho)
  const drag = useRef(null);
  const down = (e) => { if (e.pointerType !== 'mouse') return; drag.current = { x: e.clientX, s: ref.current.scrollLeft, moved: false }; };
  const move = (e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 5) d.moved = true; ref.current.scrollLeft = d.s - dx; };
  const up = () => { setTimeout(() => { drag.current = null; }, 0); };
  const click = (e) => { if (drag.current && drag.current.moved) { e.preventDefault(); e.stopPropagation(); } };
  const go = (dir) => ref.current.scrollBy({ left: dir * ref.current.clientWidth * step, behavior: 'smooth' });
  return (
    <div className={`srow ${className}`}>
      <AnimatePresence>{edge.l && <motion.button key="l" className="srow-btn l" onClick={() => go(-1)} aria-label="Anteriores" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>{Icon.left}</motion.button>}</AnimatePresence>
      <div ref={setRef} className="srow-track" onScroll={update} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onClickCapture={click}>{children}</div>
      <AnimatePresence>{edge.r && <motion.button key="r" className="srow-btn r" onClick={() => go(1)} aria-label="Próximos" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>{Icon.right}</motion.button>}</AnimatePresence>
    </div>
  );
}

/* ---------- números animados ---------- */
export function CountUp({ value, duration = 0.9, decimals = 0, className = '' }) {
  const ref = useRef(null);
  const prev = useRef(0);
  useEffect(() => {
    const to = Number(value) || 0;
    const ctrl = animate(prev.current, to, {
      duration, ease,
      onUpdate: (v) => { if (ref.current) ref.current.textContent = v.toFixed(decimals).replace('.', ','); },
    });
    prev.current = to;
    return () => ctrl.stop();
  }, [value, duration, decimals]);
  return <span ref={ref} className={className}>{Number(0).toFixed(decimals)}</span>;
}
// placar: quando muda, o número antigo sai por cima e o novo entra por baixo
export function Digit({ v, className = '' }) {
  return (
    <span className={`digit ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(v)} initial={{ y: '70%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-70%', opacity: 0 }} transition={{ duration: 0.45, ease }}>{v ?? '–'}</motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------- minuto ao vivo correndo ---------- */
export function LiveMinute({ p }) {
  const [, tick] = useState(0);
  const at = useRef(Date.now());
  useEffect(() => { at.current = Date.now(); }, [p.cronometro, p.periodo]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  const running = p.cronometro != null && PERIOD_END[p.periodo] && !/\+/.test(p.cronometro_label || '');
  if (!running) return <>{liveLabel(p)}</>;
  const m = +p.cronometro + Math.floor((Date.now() - at.current) / 60000);
  const end = PERIOD_END[p.periodo];
  return <>{m > end ? `${end}+${m - end}'` : `${m}'`}</>;
}
export const LiveDot = () => <span className="ldot" aria-hidden="true" />;

/* ---------- cartão que inclina com o ponteiro ---------- */
export function Tilt({ children, className = '', max = 7, ...p }) {
  const x = useMotionValue(0.5), y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [max, -max]), { stiffness: 250, damping: 20 });
  const ry = useSpring(useTransform(x, [0, 1], [-max, max]), { stiffness: 250, damping: 20 });
  const gx = useTransform(x, (v) => `${v * 100}%`), gy = useTransform(y, (v) => `${v * 100}%`);
  const onMove = (e) => { const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left) / r.width); y.set((e.clientY - r.top) / r.height); };
  const reset = () => { x.set(0.5); y.set(0.5); };
  return (
    <motion.div className={`tilt ${className}`} style={{ rotateX: rx, rotateY: ry, '--gx': gx, '--gy': gy }} onPointerMove={onMove} onPointerLeave={reset} {...p}>
      {children}
    </motion.div>
  );
}

/* ---------- contagem regressiva com dígitos que viram ---------- */
export function Countdown({ iso, className = '' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const d = parseISO(iso);
  if (!d) return null;
  const s = Math.max(0, Math.floor((d - now) / 1000));
  const parts = [[Math.floor(s / 86400), 'dias'], [Math.floor((s % 86400) / 3600), 'h'], [Math.floor((s % 3600) / 60), 'min'], [s % 60, 's']];
  return (
    <div className={`cd ${className}`}>
      {parts.map(([v, l], i) => (i === 0 && !v ? null : (
        <div key={l} className="cd-u"><b>{String(v).padStart(2, '0').split('').map((ch, j) => <Digit key={j} v={ch} />)}</b><span>{l}</span></div>
      )))}
    </div>
  );
}

/* ---------- últimos jogos ---------- */
export const Form = ({ f }) => (
  <span className="form">{(f || []).map((x, i) => <i key={i} className={x}>{{ v: 'V', e: 'E', d: 'D' }[x]}</i>)}</span>
);

/* ---------- onde assistir: logos oficiais das emissoras ---------- */
export function Watch({ w, title = 'Onde assistir', compact = false }) {
  if (!w || (!(w.canais || []).length && !w.materia)) return null;
  const when = w.atualizado_em ? new Date(`${w.atualizado_em}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  return (
    <Panel className={`watch ${compact ? 'compact' : ''}`}>
      <Head>{title}</Head>
      {w.materia && (
        <a className="watch-news" href={w.materia.link} target="_blank" rel="noopener noreferrer">
          <small>Canal deste jogo</small><b>{w.materia.titulo}</b><em>{w.materia.veiculo} ↗</em>
        </a>
      )}
      <Stagger className="ch-grid">
        {(w.canais || []).map((c) => {
          const brands = brandsOf(c.nome);
          const main = brands.find((b) => b.url) || {};
          return (
            <Item key={c.nome} as="a" className={`ch k-${c.tipo}`} href={main.url || undefined} target="_blank" rel="noopener noreferrer" whileHover={{ y: -3 }}>
              <span className="ch-logos">
                {brands.map((b) => (b.icon ? <img key={b.key} src={b.icon} alt="" /> : <span key={b.key} className="ch-mono">{b.key.slice(0, 2).toUpperCase()}</span>))}
              </span>
              <span className="ch-txt"><b>{c.nome}</b><small>{TV_KIND[c.tipo] || c.tipo}{c.obs ? ` · ${c.obs}` : ''}</small></span>
              <span className={`ch-kind k-${c.tipo}`}>{{ aberta: 'Aberta', fechada: 'Fechada', streaming: 'Stream', ppv: 'PPV', youtube: 'Grátis' }[c.tipo] || ''}</span>
            </Item>
          );
        })}
      </Stagger>
      <p className="foot">{w.nota ? `${w.nota} ` : ''}{w.materia ? '' : 'Canais com direitos no Brasil'}{when ? ` · levantamento de ${when}` : ''}. Confira a grade da emissora.</p>
    </Panel>
  );
}

/* ---------- ícones ---------- */
export const Icon = {
  ball: <svg viewBox="0 0 24 24" className="ico"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m12 7 4 3-1.5 4.5h-5L8 10z" fill="currentColor" /></svg>,
  sun: <svg viewBox="0 0 24 24" className="ico"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" /></svg>,
  moon: <svg viewBox="0 0 24 24" className="ico"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
  search: <svg viewBox="0 0 24 24" className="ico"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m15.5 15.5 4.5 4.5" stroke="currentColor" strokeWidth="1.8" /></svg>,
  user: <svg viewBox="0 0 24 24" className="ico"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
  left: <svg viewBox="0 0 24 24" className="ico"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  right: <svg viewBox="0 0 24 24" className="ico"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  star: <svg viewBox="0 0 24 24" className="ico"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
  card: (c) => <svg viewBox="0 0 12 16" className="card-ico"><rect x="1" y="1" width="10" height="14" rx="1.5" fill={c === 'r' ? '#e5484d' : '#f5c518'} /></svg>,
  sub: <svg viewBox="0 0 24 24" className="ico"><path d="M7 4v13M3 13l4 4 4-4M17 20V7M13 11l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  chat: <svg viewBox="0 0 24 24" className="ico"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>,
  tv: <svg viewBox="0 0 24 24" className="ico"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m9 2 3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
};
