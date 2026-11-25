// Sino de notificações (campeonato, time, NBA, F1) e o painel com tudo o que a pessoa acompanha.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStoreVersion, getFavs } from '../lib/store.js';
import { getNotif, setNotif, toggleComp, toggleTeam, toggleNbaTeam, toggleF1Driver, toggleF1Team, followsTeam, browserSupport, browserPermission, enableBrowser } from '../lib/notify.js';
import { useComps } from '../lib/data.js';
import { followsCompHome, toggleFollowComp } from '../lib/follow.js';
import { Icon } from './ui.jsx';
import { testAlert } from '../lib/live.js';
import { LOGO } from '../lib/themes.js';
import { Crest, CompLogo, isDark, ease } from './ui.jsx';

export const bellIcon = (on) => (
  <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.8H4.4L6 16.5Z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

// "★ Seguir" campeonato: aparece na página inicial e liga os avisos (o sino ao lado silencia)
export function FollowComp({ id, className = '' }) {
  useStoreVersion();
  const on = followsCompHome(id);
  return (
    <motion.button type="button" className={`follow ${on ? 'on' : ''} ${className}`} onClick={() => toggleFollowComp(id)} whileTap={{ scale: 0.92 }} aria-pressed={on}>
      <motion.span key={String(on)} initial={{ scale: 0.4, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>{Icon.star}</motion.span>
      {on ? 'Seguindo' : 'Seguir'}
    </motion.button>
  );
}

// botão "Avisar" (no cabeçalho do campeonato, do time, da NBA e da F1)
// on: booleano ou função (avaliada aqui dentro: o sino se atualiza sozinho quando a preferência muda)
export function Bell({ on: isOn, onClick, label = 'Avisar', onLabel = 'Avisando', className = '', hint = 'gols, começo e fim' }) {
  useStoreVersion();
  const on = typeof isOn === 'function' ? isOn() : isOn;
  return (
    <motion.button type="button" className={`bell ${on ? 'on' : ''} ${className}`} onClick={onClick} whileTap={{ scale: 0.92 }} aria-pressed={on}
      title={on ? `Você recebe avisos de ${hint}. Clique para parar.` : `Receber avisos de ${hint}`}>
      <motion.span key={String(on)} initial={{ rotate: on ? -25 : 0, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 12 }}>{bellIcon(on)}</motion.span>
      {on ? onLabel : label}
    </motion.button>
  );
}

const Switch = ({ on, onChange, children, hint }) => (
  <label className="np-sw">
    <span><b>{children}</b>{hint && <small>{hint}</small>}</span>
    <button type="button" role="switch" aria-checked={on} className={`sw ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
  </label>
);

// manda um gol de mentira: aparece na tela na hora e, se o navegador permitir, como notificação em 5 s
function TestButton({ perm }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!left) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const go = () => { testAlert(5000); setLeft(5); };
  return (
    <div className="np-test">
      <button type="button" className="btn" onClick={go} disabled={left > 0}>{left > 0 ? `Notificação em ${left} s…` : 'Enviar aviso de teste'}</button>
      <small>{perm === 'granted'
        ? (left > 0 ? 'Troque de aba ou minimize o navegador para ver a notificação do sistema.' : 'Mostra um gol na tela agora e, 5 s depois, a notificação do navegador.')
        : 'Mostra um gol de teste na tela. Ative as notificações do navegador para testar também a do sistema.'}</small>
    </div>
  );
}

function Panel({ onClose }) {
  useStoreVersion();
  const n = getNotif();
  const { data: comps } = useComps();
  const [perm, setPerm] = useState(browserPermission());
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const favs = Object.values(getFavs());
  const teams = [...favs, ...n.times.filter((t) => !favs.some((f) => +f.time_id === +t.time_id))];
  const followed = (comps || []).filter((c) => n.comps.includes(+c.campeonato_id));
  const tipo = (k, v) => setNotif({ tipos: { ...n.tipos, [k]: v } });
  const askBrowser = async () => setPerm(await enableBrowser());

  return (
    <motion.div className="np-back" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.aside className="np" role="dialog" aria-modal="true" aria-label="Notificações" onClick={(e) => e.stopPropagation()}
        initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.3, ease }}>
        <header className="np-head"><b>Notificações</b><button type="button" className="share-x" onClick={onClose} aria-label="Fechar">×</button></header>
        <div className="np-body">
          <section>
            <h3>No navegador</h3>
            {!browserSupport() ? <p className="np-note">Este navegador não mostra notificações. Os avisos aparecem dentro do site.</p>
              : perm === 'granted' ? <Switch on={n.navegador} onChange={(v) => setNotif({ navegador: v })} hint="Com o site aberto em outra aba ou minimizado">Notificações do navegador</Switch>
                : perm === 'denied' ? <p className="np-note">As notificações estão bloqueadas para este site. Libere no cadeado ao lado do endereço.</p>
                  : <button type="button" className="btn primary np-ask" onClick={askBrowser}>{bellIcon(true)} Ativar notificações do navegador</button>}
            <TestButton perm={perm} />
            <p className="np-note">Com o site fechado ainda não chegam: isso precisa do site no ar (hospedagem) e de notificação push.</p>
          </section>
          <section>
            <h3>Avisar quando</h3>
            <Switch on={n.tipos.gol} onChange={(v) => tipo('gol', v)}>Gol</Switch>
            <Switch on={n.tipos.inicio} onChange={(v) => tipo('inicio', v)}>Começar o jogo</Switch>
            <Switch on={n.tipos.intervalo} onChange={(v) => tipo('intervalo', v)}>Intervalo</Switch>
            <Switch on={n.tipos.fim} onChange={(v) => tipo('fim', v)} hint="Com o placar final">Fim de jogo</Switch>
          </section>
          <section>
            <h3>Campeonatos</h3>
            {followed.length ? <div className="np-list">{followed.map((c) => (
              <span key={c.campeonato_id} className="np-item"><CompLogo c={c} size={18} dark={isDark()} /><Link to={`/campeonato/${c.campeonato_id}`} onClick={onClose}>{c.nome_popular}</Link>
                <button type="button" aria-label={`Parar de avisar ${c.nome_popular}`} onClick={() => toggleComp(c.campeonato_id)}>×</button></span>
            ))}</div> : <p className="np-note">Nenhum. Toque em <b>Avisar</b> na página de um campeonato.</p>}
          </section>
          <section>
            <h3>Times</h3>
            {teams.length ? <div className="np-list">{teams.map((t) => {
              const on = followsTeam(t);
              return (
                <span key={t.time_id} className={`np-item ${on ? '' : 'off'}`}><Crest t={t} size={18} /><Link to={`/time/${t.time_id}`} onClick={onClose}>{t.nome_popular}</Link>
                  <button type="button" className="np-bell" aria-label={on ? `Silenciar ${t.nome_popular}` : `Avisar ${t.nome_popular}`} onClick={() => toggleTeam(t)}>{bellIcon(on)}</button></span>
              );
            })}</div> : <p className="np-note">Siga um time (★) ou toque em <b>Avisar</b> na página dele.</p>}
            <p className="np-note">Times que você segue avisam sozinhos; o sino silencia.</p>
          </section>
          <section>
            <h3><img src={LOGO.nba} alt="" height="16" /> NBA</h3>
            <Switch on={n.nbaTodos} onChange={(v) => setNotif({ nbaTodos: v })} hint="Começo, intervalo e placar final">Todos os jogos</Switch>
            {n.nbaTimes.length > 0 && <div className="np-list">{n.nbaTimes.filter((x) => x && x.id).map((t) => (
              <span key={t.id} className="np-item">{t.logo && <img src={t.logo} alt="" width="18" />}<Link to={`/nba/time/${t.id}`} onClick={onClose}>{t.nome}</Link>
                <button type="button" aria-label={`Parar de avisar ${t.nome}`} onClick={() => toggleNbaTeam(t)}>×</button></span>
            ))}</div>}
          </section>
          <section>
            <h3><img src={LOGO.f1} alt="" height="14" /> Fórmula 1</h3>
            <Switch on={n.f1} onChange={(v) => setNotif({ f1: v })} hint="Treinos, classificação e corrida: começo e fim com o top 3">Sessões da F1</Switch>
            {n.f1Pilotos.length + n.f1Equipes.length > 0 ? (
              <div className="np-list">
                {n.f1Pilotos.map((p) => (
                  <span key={p.id} className="np-item"><i className="np-dot" style={{ background: p.cor || '#888' }} /><Link to={`/f1/piloto/${p.id}`} onClick={onClose}>{p.nome}</Link>
                    <button type="button" aria-label={`Parar de seguir ${p.nome}`} onClick={() => toggleF1Driver(p)}>×</button></span>
                ))}
                {n.f1Equipes.map((t) => (
                  <span key={t.id} className="np-item"><i className="np-dot sq" style={{ background: t.cor || '#888' }} /><Link to={`/f1/equipe/${t.id}`} onClick={onClose}>{t.nome}</Link>
                    <button type="button" aria-label={`Parar de seguir ${t.nome}`} onClick={() => toggleF1Team(t)}>×</button></span>
                ))}
              </div>
            ) : <p className="np-note">Toque em <b>Seguir</b> na página de um piloto ou equipe para saber a posição dele no fim de cada sessão.</p>}
          </section>
        </div>
      </motion.aside>
    </motion.div>
  );
}

// sino do cabeçalho: abre o painel
export function HeaderBell() {
  const [open, setOpen] = useState(false);
  useStoreVersion();
  const n = getNotif();
  const active = n.comps.length + n.times.length + Object.keys(getFavs()).length + n.nbaTimes.length + (n.nbaTodos ? 1 : 0) + (n.f1 ? 1 : 0) + n.f1Pilotos.length + n.f1Equipes.length > 0;
  return (
    <>
      <button className={`ibtn ${active ? 'has-notif' : ''}`} onClick={() => setOpen(true)} aria-label="Notificações" title="Notificações">{bellIcon(false)}</button>
      {createPortal(<AnimatePresence>{open && <Panel key="np" onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  );
}
