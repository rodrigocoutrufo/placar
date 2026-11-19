// Botão "Instalar o Vyra" (cabeçalho), faixa na página inicial e o passo a passo do iPhone.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useInstall, promptInstall, bannerDismissed, dismissBanner } from '../lib/install.js';
import { ease } from './ui.jsx';

const dlIcon = (
  <svg viewBox="0 0 24 24" className="ico" aria-hidden="true">
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const shareIco = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
    <path d="M12 3v12M12 3 8 7M12 3l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 11H5v9h14v-9h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

function IOSSteps({ onClose }) {
  return (
    <motion.div className="share-back" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="share-box ios-box" role="dialog" aria-modal="true" aria-label="Instalar no iPhone" onClick={(e) => e.stopPropagation()}
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ duration: 0.3, ease }}>
        <header className="share-head"><b>Instalar no iPhone</b><button type="button" className="share-x" onClick={onClose} aria-label="Fechar">×</button></header>
        <ol className="ios-steps">
          <li>No Safari, toque em <b>Compartilhar</b> {shareIco} na barra de baixo.</li>
          <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
          <li>Toque em <b>Adicionar</b>. O Vyra aparece como app, em tela cheia.</li>
        </ol>
        <p className="np-note ios-note">No iPhone, os avisos de gol do navegador só funcionam com o app instalado (iOS 16.4 ou mais novo).</p>
      </motion.div>
    </motion.div>
  );
}

function useInstallAction() {
  const st = useInstall();
  const [ios, setIos] = useState(false);
  const run = async () => { if (st.can) await promptInstall(); else if (st.ios) setIos(true); };
  const modal = createPortal(<AnimatePresence>{ios && <IOSSteps key="ios" onClose={() => setIos(false)} />}</AnimatePresence>, document.body);
  return { st, run, modal };
}

// cabeçalho: só aparece quando dá para instalar (e ainda não está instalado)
export function InstallButton() {
  const { st, run, modal } = useInstallAction();
  if (!st.can && !st.ios) return null;
  return (
    <>
      <button className="ibtn install" onClick={run} aria-label="Instalar o Vyra" title="Instalar o Vyra como aplicativo">{dlIcon}<span>Instalar</span></button>
      {modal}
    </>
  );
}

// página inicial: convite com o que a pessoa ganha; fecha por 30 dias
export function InstallBanner() {
  const { st, run, modal } = useInstallAction();
  if ((!st.can && !st.ios) || bannerDismissed()) return null;
  return (
    <>
      <motion.section className="install-bn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
        <img src="/icons/icon-192.png" alt="" width="44" height="44" />
        <div><b>Instale o Vyra</b><small>Abre como aplicativo, em tela cheia e mais rápido, com aviso de gol mesmo com a aba em segundo plano.</small></div>
        <button type="button" className="btn primary" onClick={run}>{dlIcon} Instalar</button>
        <button type="button" className="install-x" onClick={dismissBanner} aria-label="Agora não">×</button>
      </motion.section>
      {modal}
    </>
  );
}
