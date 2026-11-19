import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/pages.css';
import { queryClient } from './lib/api.js';
import { startLive } from './lib/live.js';
import { loadAccount } from './lib/store.js';
import { Mode } from './lib/mode.js';
import { Header, Ticker, MobileBar, Footer, GoalToasts, NotFound } from './components/Shell.jsx';
import { UpdateNotice } from './components/Update.jsx';
import Intro from './components/Intro.jsx';
import Assistant from './components/Assistant.jsx';
import { ease, QueryBoundary } from './components/ui.jsx';
import Home from './pages/Home.jsx';

const Competitions = lazy(() => import('./pages/Competitions.jsx'));
const Competition = lazy(() => import('./pages/Competition.jsx'));
const Match = lazy(() => import('./pages/Match.jsx'));
const NBA = lazy(() => import('./pages/NBA.jsx'));
const NBAGame = lazy(() => import('./pages/NBAGame.jsx'));
const F1 = lazy(() => import('./pages/F1.jsx'));
const F1Race = lazy(() => import('./pages/F1Race.jsx'));
const ForYou = lazy(() => import('./pages/ForYou.jsx'));
const News = lazy(() => import('./pages/News.jsx'));
const Multi = lazy(() => import('./pages/Multi.jsx'));
const BolaoHome = lazy(() => import('./pages/BolaoGroups.jsx').then((m) => ({ default: m.BolaoHome })));
const BolaoGroup = lazy(() => import('./pages/BolaoGroups.jsx').then((m) => ({ default: m.BolaoGroup })));
const BolaoJoin = lazy(() => import('./pages/BolaoGroups.jsx').then((m) => ({ default: m.BolaoJoin })));
const Team = lazy(() => import('./pages/Team.jsx'));
const Player = lazy(() => import('./pages/Player.jsx'));
const Games = lazy(() => import('./pages/Games.jsx'));
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const sp = () => import('./pages/SportProfiles.jsx');
const NBATeam = named(sp, 'NBATeam'), NBAPlayer = named(sp, 'NBAPlayer'), F1Driver = named(sp, 'F1Driver'), F1Team = named(sp, 'F1Team');
const misc = () => import('./pages/Misc.jsx');
const Search = named(misc, 'Search'), Favorites = named(misc, 'Favorites'), About = named(misc, 'About'), Compare = named(misc, 'Compare');
const acc = () => import('./pages/Account.jsx');
const Auth = named(acc, 'Auth'), Forgot = named(acc, 'Forgot'), Reset = named(acc, 'Reset'), AccountPage = named(acc, 'AccountPage');

// o modo (cores do esporte/campeonato) segue a rota; campeonato e partida definem o deles na própria tela
function ModeByRoute() {
  const { pathname } = useLocation();
  useEffect(() => {
    const p0 = pathname.split('/')[1];
    if (p0 === 'nba' || p0 === 'f1') Mode.sport(p0);
    else if (p0 !== 'campeonato' && p0 !== 'partida') Mode.clear();
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Page({ children }) {
  return (
    <motion.main className="page" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.18 } }} transition={{ duration: 0.45, ease }}>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <QueryBoundary onReset={reset}>
            <Suspense fallback={<div className="skel" style={{ height: 420 }} />}>{children}</Suspense>
          </QueryBoundary>
        )}
      </QueryErrorResetBoundary>
    </motion.main>
  );
}

function App() {
  const loc = useLocation();
  const p1 = loc.pathname.split('/')[1];
  const seg = p1 === 'cadastro' || p1 === 'entrar' ? '/auth' : ['time', 'minijogos'].includes(p1) ? loc.pathname.split('/').slice(0, p1 === 'time' ? 3 : 3).join('/') : loc.pathname.split('/').slice(0, 3).join('/'); // anima ao trocar de tela, não de aba
  return (
    <>
      <ModeByRoute />
      <div className="bg-art" aria-hidden="true" />
      <Header />
      <Ticker />
      <AnimatePresence mode="wait">
        <Routes location={loc} key={seg}>
          <Route path="/" element={<Page><Home /></Page>} />
          <Route path="/para-voce" element={<Page><ForYou /></Page>} />
          <Route path="/campeonatos" element={<Page><Competitions /></Page>} />
          <Route path="/campeonato/:id/:tab?" element={<Page><Competition /></Page>} />
          <Route path="/partida/:id/:tab?" element={<Page><Match /></Page>} />
          <Route path="/nba/jogo/:id" element={<Page><NBAGame /></Page>} />
          <Route path="/nba/time/:id" element={<Page><NBATeam /></Page>} />
          <Route path="/nba/jogador/:id" element={<Page><NBAPlayer /></Page>} />
          <Route path="/nba/:tab?" element={<Page><NBA /></Page>} />
          <Route path="/f1/corrida/:rnd" element={<Page><F1Race /></Page>} />
          <Route path="/f1/piloto/:id" element={<Page><F1Driver /></Page>} />
          <Route path="/f1/equipe/:id" element={<Page><F1Team /></Page>} />
          <Route path="/f1/:tab?" element={<Page><F1 /></Page>} />
          <Route path="/noticias" element={<Page><News /></Page>} />
          <Route path="/multijogo" element={<Page><Multi /></Page>} />
          <Route path="/bolao" element={<Page><BolaoHome /></Page>} />
          <Route path="/bolao/grupo/:id" element={<Page><BolaoGroup /></Page>} />
          <Route path="/bolao/entrar/:codigo" element={<Page><BolaoJoin /></Page>} />
          <Route path="/time/:id/:tab?" element={<Page><Team /></Page>} />
          <Route path="/jogador/:id" element={<Page><Player /></Page>} />
          <Route path="/minijogos/:game?" element={<Page><Games /></Page>} />
          <Route path="/busca/:q?" element={<Page><Search /></Page>} />
          <Route path="/favoritos" element={<Page><Favorites /></Page>} />
          <Route path="/sobre" element={<Page><About /></Page>} />
          <Route path="/comparar" element={<Page><Compare /></Page>} />
          <Route path="/entrar" element={<Page><Auth /></Page>} />
          <Route path="/cadastro" element={<Page><Auth /></Page>} />
          <Route path="/esqueci" element={<Page><Forgot /></Page>} />
          <Route path="/redefinir" element={<Page><Reset /></Page>} />
          <Route path="/conta" element={<Page><AccountPage /></Page>} />
          <Route path="*" element={<Page><NotFound /></Page>} />
        </Routes>
      </AnimatePresence>
      <Footer />
      <MobileBar />
      <GoalToasts />
      <UpdateNotice />
      <Assistant />
      <Intro />
    </>
  );
}

startLive();
loadAccount();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <HashRouter><App /></HashRouter>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
