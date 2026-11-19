// "Instalar o Vyra": o site já é um PWA (manifesto + service worker). Aqui fica o pedido de instalação do navegador.
// Chrome/Edge/Android disparam "beforeinstallprompt" uma vez, às vezes antes do React montar: o index.html guarda o
// evento em window.__vyraBip. iPhone/iPad (Safari) não têm botão: mostramos o passo a passo.
import { useSyncExternalStore } from 'react';

let deferred = (typeof window !== 'undefined' && window.__vyraBip) || null;
let installedNow = false;
let version = 0;
const subs = new Set();
const emit = () => { version++; subs.forEach((f) => f()); };
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; emit(); });
}

export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const isIOS = () => typeof navigator !== 'undefined'
  && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function installState() {
  const installed = installedNow || isStandalone();
  return { installed, can: !installed && !!deferred, ios: !installed && isIOS() };
}
export const useInstall = () => { useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version); return installState(); };

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; // o navegador só deixa usar uma vez
  emit();
  return outcome; // 'accepted' | 'dismissed'
}

// faixa "Instale o Vyra" na página inicial: some por 30 dias quando a pessoa fecha
const KEY = 'placar.instalar.fechado';
export const bannerDismissed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 30 * 864e5; } catch { return false; } };
export const dismissBanner = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* */ } emit(); };
