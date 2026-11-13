// Identidade de cada esporte e campeonato: cores, textura e logos oficiais.
import { norm } from './format.js';

export const LOGO = {
  nba: '/brands/nba-logo.png',
  f1: '/brands/f1-logo.svg',
};

// m1/m2 = fundo profundo; acc = destaque (fundo escuro); accL = destaque legível em fundo claro; ink = texto sobre o destaque
const COMP = [
  { re: /champions/, m1: '#020722', m2: '#0a1d6e', acc: '#3f7cff', accL: '#1f4fd8', ink: '#fff', pat: 'stars' },
  { re: /premier/, m1: '#18001e', m2: '#3d0049', acc: '#ff2882', accL: '#c4006a', ink: '#fff', pat: 'diag' },
  { re: /la ?liga/, m1: '#1a0505', m2: '#4d0e0a', acc: '#ff4b44', accL: '#d42a22', ink: '#fff', pat: 'diag' },
  { re: /^serie a$/, m1: '#00102c', m2: '#00306b', acc: '#1aa3ff', accL: '#0068c9', ink: '#fff', pat: 'hex' },
  { re: /bundesliga/, m1: '#170003', m2: '#4a0008', acc: '#ff2433', accL: '#d20515', ink: '#fff', pat: 'dots' },
  { re: /ligue 1/, m1: '#050c19', m2: '#14233f', acc: '#d7ff3a', accL: '#4c7a00', ink: '#0a1200', pat: 'diag' },
  { re: /portugal/, m1: '#020f26', m2: '#0b2c63', acc: '#ff6b3d', accL: '#d94a1c', ink: '#fff', pat: 'dots' },
  { re: /eredivisie/, m1: '#060f30', m2: '#13277a', acc: '#ff8a1f', accL: '#c45e00', ink: '#1a0d00', pat: 'hex' },
  { re: /libertadores/, m1: '#0a0803', m2: '#2b220b', acc: '#e8c45a', accL: '#8f700d', ink: '#1a1300', pat: 'stars' },
  { re: /sul-?americana/, m1: '#03102b', m2: '#08306b', acc: '#2ea8ff', accL: '#0b6fc4', ink: '#fff', pat: 'diag' },
  { re: /copa do brasil/, m1: '#031335', m2: '#0b2f78', acc: '#ffd23f', accL: '#957000', ink: '#1a1400', pat: 'stars' },
  { re: /serie b/, m1: '#031626', m2: '#0b3a57', acc: '#2fd4c4', accL: '#0b8a7e', ink: '#02201c', pat: 'dots' },
  { re: /brasileir/, m1: '#021a0c', m2: '#07502a', acc: '#ffd400', accL: '#0a8a43', ink: '#1a1500', pat: 'diag' },
];
const DEFAULT = { m1: '#05140b', m2: '#0b3d22', acc: '#19d36b', accL: '#0a8a43', ink: '#04140a', pat: 'diag' };
export const SPORT = {
  nba: { m1: '#050915', m2: '#17306e', acc: '#ff7a1a', accL: '#cf540a', ink: '#1a0a00', pat: 'court' },
  f1: { m1: '#050505', m2: '#2a0303', acc: '#ff1e1e', accL: '#cf0000', ink: '#fff', pat: 'carbon' },
};
export const compTheme = (c) => COMP.find((t) => t.re.test(norm(c && (c.nome_popular || c.nome)))) || DEFAULT;
export const compLogoDark = (c) => (c ? c.logo_escuro || c.logo : null);
export const compLogo = (c, dark) => (c ? (dark && c.logo_escuro) || c.logo || c.logo_escuro : null);

// Emissoras: ícone oficial (app/site da própria emissora) e onde assistir
const B = (icon, url) => ({ icon: `/brands/${icon}.png`, url });
export const BROADCASTERS = {
  globo: B('globo', 'https://globoplay.globo.com/agora-na-tv/'),
  record: B('record', 'https://www.playplus.com/'),
  sportv: B('sportv', 'https://globoplay.globo.com/canais/sportv/'),
  premiere: B('premiere', 'https://premierefc.globo.com/'),
  'prime video': B('primevideo', 'https://www.primevideo.com/'),
  cazetv: B('youtube', 'https://www.youtube.com/@CazeTV'),
  'caze tv': B('youtube', 'https://www.youtube.com/@CazeTV'),
  'ge tv': B('getv', 'https://www.youtube.com/@getv'),
  'disney+': B('disneyplus', 'https://www.disneyplus.com/'),
  espn: B('espn', 'https://www.disneyplus.com/'),
  xsports: B('xsports', 'https://xsports.com.br/'),
  sportynet: B('sportynet', 'https://www.youtube.com/@SportyNetBR'),
  'paramount+': B('paramountplus', 'https://www.paramountplus.com/br/'),
  sbt: B('sbt', 'https://www.sbt.com.br/aovivo'),
  '+sbt': B('sbt', 'https://www.sbt.com.br/aovivo'),
  'tnt sports': B('tntsports', 'https://www.hbomax.com/br/pt/sports'),
  'hbo max': B('hbomax', 'https://www.hbomax.com/br/pt'),
  goat: B('youtube', 'https://www.youtube.com/results?search_query=goat+futebol'),
  'nba league pass': B('leaguepass', 'https://www.nba.com/watch/league-pass-stream'),
  globoplay: B('globoplay', 'https://globoplay.globo.com/'),
  'f1 tv': B('f1tv', 'https://f1tv.formula1.com/'),
  youtube: B('youtube', 'https://www.youtube.com/'),
};
// "Globo / sportv / Premiere" -> três emissoras; "TNT Sports no YouTube" -> TNT Sports
export function brandsOf(name) {
  const parts = String(name).split('/').map((s) => norm(s).replace(/\s+no youtube$/, '').trim());
  return parts.map((k) => ({ key: k, ...(BROADCASTERS[k] || {}) }));
}
export const TV_KIND = { aberta: 'TV aberta', fechada: 'TV fechada', streaming: 'Streaming', ppv: 'Pay-per-view', youtube: 'YouTube' };
