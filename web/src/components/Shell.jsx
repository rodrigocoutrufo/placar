import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useLive, useOtherLive, useGoals, dismissGoal } from '../lib/live.js';
import { useApi } from '../lib/api.js';
import { useModeState } from '../lib/mode.js';
import { account, toggleTheme, useStoreVersion } from '../lib/store.js';
import { Crest, Icon, LiveDot, LiveMinute, ease } from './ui.jsx';
import { LOGO } from '../lib/themes.js';
import { HeaderBell } from './Notify.jsx';
import { InstallButton } from './Install.jsx';
import { isFollowedMatch } from '../lib/follow.js';
import { isLive } from '../lib/format.js';
import { useSuggest } from '../lib/registry.js';
import { HitThumb } from './SearchHit.jsx';

const NAV = [
  ['/', 'Jogos', (p) => p === '/' || p.startsWith('/partida')],
  ['/para-voce', 'Para você'],
  ['/campeonatos', 'Campeonatos', (p) => p.startsWith('/campeonato')],
  ['/minijogos/palpites', 'Bolão', (p) => p.startsWith('/bolao') || p.startsWith('/minijogos')], // palpites, grupos com amigos e minijogos
  ['/nba', 'NBA'],
  ['/f1', 'Fórmula 1'],
  ['/noticias', 'Notícias'],
];

export function Mark({ className = '' }) {
  return (
    <svg className={`mark ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" className="mark-bg" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="2.8" fill="currentColor" />
    </svg>
  );
}

export function Header() {
  const { pathname } = useLocation();
  const mode = useModeState();
  const other = useOtherLive();
  useStoreVersion();
  const dark = document.documentElement.dataset.theme === 'dark';
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const sugg = useSuggest(q.trim());
  useEffect(() => setQ(''), [pathname]); // mudou de tela: fecha as sugestões
  const isOn = (to, test) => (test ? test(pathname) : pathname === to || pathname.startsWith(to + '/'));
  const u = account.user;
  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" aria-label="Vyra — início"><Mark /><span>VYRA</span></Link>
        <AnimatePresence mode="wait">
          {mode.kind && (
            <motion.div key={mode.key} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.35, ease }}>
              <Link to={mode.info.href} className="mbadge">{mode.info.logo && <img src={mode.info.logo} alt="" />}<span>{mode.info.name}</span></Link>
            </motion.div>
          )}
        </AnimatePresence>
        <nav className="nav">
          {NAV.map(([to, label, test]) => {
            const on = isOn(to, test);
            const live = (to === '/nba' && (other.nba || []).length) || (to === '/f1' && other.f1);
            return (
              <NavLink key={to} to={to} className={`nav-a ${on ? 'on' : ''}`}>
                {label}{live ? <LiveDot /> : null}
                {on && <motion.span layoutId="nav-ind" className="nav-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              </NavLink>
            );
          })}
        </nav>
        {/* sem espaço (campeonato aberto, tela menor): vira uma lupa que abre por cima do menu */}
        <div className="srch-wrap">
        <form className="srch" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { navigate(`/busca/${encodeURIComponent(q.trim())}`); setQ(''); } }}>
            <label htmlFor="busca" className="srch-ico" title="Buscar">{Icon.search}</label><input id="busca" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setQ(''), 200)} placeholder="Buscar times, jogadores, campeonatos" aria-label="Buscar" />
            <AnimatePresence>
              {sugg && (
                <motion.div className="srch-sugg" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  {sugg === 'loading' ? <span className="none">Buscando…</span>
                    : sugg.length ? <>
                      {sugg.map((x) => <Link key={x.k} to={x.to} onClick={() => setQ('')}><HitThumb x={x} size={22} /><span>{x.nome}{x.sub && <em>{x.sub}</em>}</span><small>{x.kind}</small></Link>)}
                      <Link className="all" to={`/busca/${encodeURIComponent(q.trim())}`} onClick={() => setQ('')}>Ver todos os resultados</Link>
                    </> : <span className="none">Nada encontrado para “{q.trim()}”</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </div>
        <InstallButton />
        <HeaderBell />
        <button className="ibtn" onClick={toggleTheme} aria-label="Alternar tema" title="Tema claro/escuro">{dark ? Icon.sun : Icon.moon}</button>
        <Link className="ibtn user" to={u ? '/conta' : '/entrar'} title={u ? `Sua conta (@${u.usuario})` : 'Entrar'}>
          {u ? (u.avatar ? <img src={u.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="u-ini">{String(u.nome || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>) : Icon.user}
        </Link>
      </div>
    </header>
  );
}

/* faixa de placares rolando, estilo transmissão de TV */
export function Ticker() {
  useStoreVersion(); // seguir/deixar de seguir muda a faixa
  const live = useLive().filter((p) => isFollowedMatch(p)); // futebol: só o que a pessoa segue (ou os principais)
  const { data: nba } = useApi('/esportes/nba/jogos', { ttl: 60_000, refetch: 60_000 });
  const items = [
    ...live.map((p) => ({ k: `f${p.partida_id}`, to: `/partida/${p.partida_id}`, live: true, a: p.time_mandante, b: p.time_visitante, ga: p.placar_mandante ?? 0, gb: p.placar_visitante ?? 0, st: <LiveMinute p={p} /> })),
    ...((nba && nba.jogos) || []).filter((g) => g.status !== 'agendado').map((g) => ({
      k: `n${g.id}`, to: `/nba/jogo/${g.id}`, live: g.status === 'andamento', nba: true,
      a: { nome_popular: g.fora.sigla, escudo: g.fora.logo }, b: { nome_popular: g.casa.sigla, escudo: g.casa.logo }, ga: g.fora.placar, gb: g.casa.placar,
      st: g.status === 'andamento' ? g.periodo : 'Final',
    })),
  ];
  // as abas fixas ficam logo abaixo do cabeçalho + faixa; sem faixa, sobem junto
  useEffect(() => {
    document.documentElement.style.setProperty('--tkh', items.length ? '36px' : '0px');
  }, [items.length]);
  if (!items.length) return null;
  const nLive = items.filter((x) => x.live).length;
  const row = (suffix) => items.map((x) => (
    <Link key={x.k + suffix} to={x.to} className={`tk ${x.live ? 'live' : ''}`}>
      {x.nba && <img className="tk-lg" src={LOGO.nba} alt="NBA" />}
      <Crest t={x.a} size={16} /><span>{x.a.nome_popular}</span><b>{x.ga}</b><i>–</i><b>{x.gb}</b><span>{x.b.nome_popular}</span><Crest t={x.b} size={16} />
      <em>{x.live && <LiveDot />}{x.st}</em>
    </Link>
  ));
  return (
    <div className="ticker">
      <span className="tk-label">{nLive ? <><LiveDot /> Ao vivo</> : 'Placares'}</span>
      <div className="tk-viewport">
        <div className="tk-track" style={{ animationDuration: `${Math.max(30, items.length * 7)}s` }}>{row('a')}{row('b')}</div>
      </div>
    </div>
  );
}

const trophy = (
  <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4m-4 3h8m-6-3h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function MobileBar() {
  const { pathname } = useLocation();
  const L = [['/', 'Jogos', Icon.ball, (p) => p === '/' || p.startsWith('/partida')], ['/campeonatos', 'Ligas', Icon.star, (p) => p.startsWith('/campeonato')],
    ['/minijogos/palpites', 'Bolão', trophy, (p) => p.startsWith('/bolao') || p.startsWith('/minijogos')],
    ['/nba', 'NBA', null], ['/f1', 'F1', null], ['/para-voce', 'Para você', Icon.user]];
  return (
    <nav className="mbar">
      {L.map(([to, label, ico, test]) => {
        const on = test ? test(pathname) : pathname.startsWith(to);
        return (
          <Link key={to} to={to} className={on ? 'on' : ''}>
            {on && <motion.span layoutId="mbar-ind" className="mbar-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            {ico || <img src={to === '/nba' ? LOGO.nba : LOGO.f1} alt="" className={`mb-lg ${to.slice(1)}`} />}<span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="ftr">
      <div><Mark /><b>VYRA</b></div>
      <p>Dados: API Futebol · ESPN (fonte pública, não oficial) · football-data.org · Jolpica. Horários de Brasília.</p>
      <p><Link to="/sobre">Sobre, fontes e privacidade</Link> · <Link to="/minijogos">Minijogos</Link> · <Link to="/comparar">Comparar jogadores</Link> · <Link to="/favoritos">Favoritos</Link></p>
    </footer>
  );
}

/* aviso de gol */
export function GoalToasts() {
  const goals = useGoals();
  const navigate = useNavigate();
  const go = (a, to) => { dismissGoal(a.key); if (to) navigate(to); };
  const body = (a) => {
    if (a.kind === 'nba') {
      const g = a.jogo;
      return { to: `/nba/jogo/${g.id}`, img: <img className="t-logo" src={g.casa.logo} alt="" />, title: `NBA · ${a.texto}`,
        line: `${g.fora.curto} ${g.fora.placar ?? 0} × ${g.casa.placar ?? 0} ${g.casa.curto}`, small: g.periodo };
    }
    if (a.kind === 'f1') {
      return { to: '/f1', img: <img className="t-logo" src={LOGO.f1} alt="" />, title: `F1 · ${a.sessao} ${a.texto === 'Começou' ? 'começou' : 'terminou'}`,
        line: a.gp, small: (a.top || []).map((x) => `${x.pos}º ${x.nome}`).join(' · ') };
    }
    const p = a.partida;
    const line = `${p.time_mandante.nome_popular} ${p.placar_mandante ?? 0} × ${p.placar_visitante ?? 0} ${p.time_visitante.nome_popular}`;
    if (a.kind === 'periodo') return { to: `/partida/${p.partida_id}`, img: <Crest t={p.time_mandante} size={40} />, title: a.texto.toUpperCase(), line, small: p.campeonato && p.campeonato.nome_popular };
    return { to: `/partida/${p.partida_id}`, img: <Crest t={a.time} size={40} />, title: `GOL DO ${String(a.time.nome_popular).toUpperCase()}!`, line,
      small: a.autor && a.autor.nome ? `${a.autor.minuto ? `${a.autor.minuto} ` : ''}${a.autor.nome}` : null };
  };
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {goals.map((a) => {
          const b = body(a);
          return (
            <motion.div key={a.key} className={`goal k-${a.kind || 'gol'}`} layout initial={{ opacity: 0, x: 80, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 80 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              onClick={() => go(a, b.to)} role="button" tabIndex={0}>
              {b.img}
              <div><b>{b.title}</b><span>{b.line}</span>{b.small && <small>{b.small}</small>}</div>
              <button type="button" className="t-x" aria-label="Fechar" onClick={(e) => { e.stopPropagation(); go(a); }}>×</button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// rota desconhecida
export function NotFound() {
  return <div className="panel"><div className="empty">Página não encontrada. <Link to="/">Voltar para o início</Link></div></div>;
}

export const liveCount = (l) => l.filter(isLive).length;
