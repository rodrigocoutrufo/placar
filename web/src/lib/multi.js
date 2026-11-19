// Multijogo: última escolha (no aparelho) e link com um jogo a mais. A tela fica em pages/Multi.jsx.
export const MAX_MULTI = 4;
export const SAVE = 'placar.multi.ultimo';
export const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço ou bloqueado */ } };
export const lastMulti = () => read(SAVE, []);
// botão "Multijogo" na partida: abre com os jogos da última vez + este (no máximo 4; sai o mais antigo)
export const multiWith = (id) => `/multijogo?j=${[...new Set([...lastMulti().filter((x) => +x !== +id), +id])].slice(-MAX_MULTI).join(',')}`;
