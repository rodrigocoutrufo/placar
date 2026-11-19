// "Nova versão do Vyra": o site é de uma página só e navegar entre telas não baixa a página de novo; uma aba aberta
// há horas continuaria na versão antiga. Ao voltar para a aba (e a cada 10 min) compara o arquivo principal do site
// com o que o servidor está entregando e, se mudou, oferece atualizar.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const RX = /\/assets\/index-[\w-]+\.js/;
const loaded = () => {
  const s = [...document.querySelectorAll('script[type="module"][src]')].map((x) => x.getAttribute('src')).find((src) => RX.test(src));
  return s ? s.match(RX)[0] : null;
};

export function UpdateNotice() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const mine = loaded();
    if (!mine) return undefined; // em desenvolvimento (Vite) não há arquivo com hash: nada a fazer
    let last = 0;
    const check = async () => {
      if (document.hidden || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const now = (html.match(RX) || [])[0];
        if (now && now !== mine) setFresh(true);
      } catch { /* sem conexão: tenta depois */ }
    };
    const t = setInterval(check, 10 * 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);
  return (
    <AnimatePresence>
      {fresh && (
        <motion.div className="upd" role="status" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}>
          <span><b>Nova versão do Vyra</b> com novidades e correções.</span>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>Atualizar</button>
          <button type="button" className="upd-x" onClick={() => setFresh(false)} aria-label="Fechar aviso de versão nova">×</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
