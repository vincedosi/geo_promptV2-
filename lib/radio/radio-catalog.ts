/**
 * Catalogue exhaustif des radios FM françaises avec slugs frequence-radio.com
 * et métadonnées Arcom (catégorie, portée, genre, groupe).
 *
 * Sources :
 * - Liste publique Arcom des services autorisés
 * - frequence-radio.com (slugs URL)
 * - Connaissance métier du marché radio français
 */

export interface RadioCatalogEntry {
  nom: string;
  slug: string; // URL slug on frequence-radio.com: /frequence-{slug}.html
  categorie_arcom: 'A' | 'B' | 'C' | 'D' | 'E';
  portee: 'nationale' | 'regionale' | 'locale' | 'autoroute';
  genre: 'generaliste' | 'musicale' | 'info_talk' | 'culturelle' | 'communautaire' | 'autre';
  groupe_media: string;
}

/**
 * Exhaustive list of French FM radios.
 * Category E = service public, D = national privé thématique, C = franchise locale,
 * B = locale commerciale, A = associative
 */
export const RADIO_CATALOG: RadioCatalogEntry[] = [
  // ── Catégorie E — Service public (Radio France) ──────────────────────────
  { nom: 'France Inter', slug: 'france-inter', categorie_arcom: 'E', portee: 'nationale', genre: 'generaliste', groupe_media: 'Radio France' },
  { nom: 'France Info', slug: 'france-info', categorie_arcom: 'E', portee: 'nationale', genre: 'info_talk', groupe_media: 'Radio France' },
  { nom: 'France Culture', slug: 'france-culture', categorie_arcom: 'E', portee: 'nationale', genre: 'culturelle', groupe_media: 'Radio France' },
  { nom: 'France Musique', slug: 'france-musique', categorie_arcom: 'E', portee: 'nationale', genre: 'musicale', groupe_media: 'Radio France' },
  { nom: 'France Bleu', slug: 'france-bleu', categorie_arcom: 'E', portee: 'regionale', genre: 'generaliste', groupe_media: 'Radio France' },
  { nom: 'FIP', slug: 'fip', categorie_arcom: 'E', portee: 'nationale', genre: 'musicale', groupe_media: 'Radio France' },
  { nom: 'Mouv\'', slug: 'mouv', categorie_arcom: 'E', portee: 'nationale', genre: 'musicale', groupe_media: 'Radio France' },

  // ── Catégorie E — Généralistes privées ──────────────────────────────────
  { nom: 'RTL', slug: 'rtl', categorie_arcom: 'E', portee: 'nationale', genre: 'generaliste', groupe_media: 'RTL Group' },
  { nom: 'Europe 1', slug: 'europe-1', categorie_arcom: 'E', portee: 'nationale', genre: 'generaliste', groupe_media: 'Lagardère' },
  { nom: 'RMC', slug: 'rmc', categorie_arcom: 'E', portee: 'nationale', genre: 'info_talk', groupe_media: 'Altice' },

  // ── Catégorie D — Nationales thématiques ─────────────────────────────────
  { nom: 'NRJ', slug: 'nrj', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'NRJ Group' },
  { nom: 'Nostalgie', slug: 'nostalgie', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'NRJ Group' },
  { nom: 'Chérie FM', slug: 'cherie-fm', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'NRJ Group' },
  { nom: 'Rire et Chansons', slug: 'rire-et-chansons', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'NRJ Group' },
  { nom: 'RTL2', slug: 'rtl2', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'RTL Group' },
  { nom: 'Fun Radio', slug: 'fun-radio', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'RTL Group' },
  { nom: 'Virgin Radio', slug: 'virgin-radio', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Lagardère' },
  { nom: 'RFM', slug: 'rfm', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Lagardère' },
  { nom: 'Europe 2', slug: 'europe-2', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Lagardère' },
  { nom: 'Skyrock', slug: 'skyrock', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Skyrock' },
  { nom: 'Radio Classique', slug: 'radio-classique', categorie_arcom: 'D', portee: 'nationale', genre: 'culturelle', groupe_media: 'LVMH' },
  { nom: 'BFM Business', slug: 'bfm-business', categorie_arcom: 'D', portee: 'nationale', genre: 'info_talk', groupe_media: 'Altice' },
  { nom: 'Sud Radio', slug: 'sud-radio', categorie_arcom: 'D', portee: 'nationale', genre: 'generaliste', groupe_media: 'Fiducial' },
  { nom: 'Radio FG', slug: 'radio-fg', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'TSF Jazz', slug: 'tsf-jazz', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Oüi FM', slug: 'oui-fm', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Nova', slug: 'radio-nova', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'M Radio', slug: 'm-radio', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Latina', slug: 'latina', categorie_arcom: 'D', portee: 'nationale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Orient', slug: 'radio-orient', categorie_arcom: 'D', portee: 'nationale', genre: 'communautaire', groupe_media: 'Indépendant' },
  { nom: 'Beur FM', slug: 'beur-fm', categorie_arcom: 'D', portee: 'nationale', genre: 'communautaire', groupe_media: 'Indépendant' },
  { nom: 'Africa Radio', slug: 'africa-radio', categorie_arcom: 'D', portee: 'nationale', genre: 'communautaire', groupe_media: 'Indépendant' },
  { nom: 'Radio Croix Bleue', slug: 'radio-croix-bleue', categorie_arcom: 'D', portee: 'nationale', genre: 'communautaire', groupe_media: 'Indépendant' },

  // ── Catégorie C — Franchises locales de réseaux nationaux ────────────────
  { nom: 'Contact FM', slug: 'contact-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Voltage', slug: 'voltage', categorie_arcom: 'C', portee: 'locale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Vibration', slug: 'vibration', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Alouette', slug: 'alouette', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Wit FM', slug: 'wit-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Forum', slug: 'forum', categorie_arcom: 'C', portee: 'locale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Totem', slug: 'totem', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Hit West', slug: 'hit-west', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Flash FM', slug: 'flash-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Sweet FM', slug: 'sweet-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Champagne FM', slug: 'champagne-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Flor FM', slug: 'flor-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Scoop', slug: 'scoop', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Chante France', slug: 'chante-france', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Jazz Radio', slug: 'jazz-radio', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Espace', slug: 'radio-espace', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Scoop', slug: 'radio-scoop', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Top Music', slug: 'top-music', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'D!CI Radio', slug: 'dici-radio', categorie_arcom: 'C', portee: 'regionale', genre: 'generaliste', groupe_media: 'Indépendant' },
  { nom: 'Radio 6', slug: 'radio-6', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Ado FM', slug: 'ado-fm', categorie_arcom: 'C', portee: 'locale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Star', slug: 'radio-star', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Kiss FM', slug: 'kiss-fm', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Tendance Ouest', slug: 'tendance-ouest', categorie_arcom: 'C', portee: 'regionale', genre: 'generaliste', groupe_media: 'Indépendant' },
  { nom: 'Evasion', slug: 'evasion', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },
  { nom: 'Radio Bonheur', slug: 'radio-bonheur', categorie_arcom: 'C', portee: 'regionale', genre: 'musicale', groupe_media: 'Indépendant' },

  // ── Catégorie A/B — Associatives et locales notables ────────────────────
  { nom: 'RCF', slug: 'rcf', categorie_arcom: 'A', portee: 'regionale', genre: 'communautaire', groupe_media: 'RCF' },
  { nom: 'Radio Fidélité', slug: 'radio-fidelite', categorie_arcom: 'A', portee: 'locale', genre: 'communautaire', groupe_media: 'Indépendant' },
  { nom: 'Phare FM', slug: 'phare-fm', categorie_arcom: 'A', portee: 'locale', genre: 'communautaire', groupe_media: 'Indépendant' },
  { nom: 'Radio Présence', slug: 'radio-presence', categorie_arcom: 'A', portee: 'locale', genre: 'communautaire', groupe_media: 'Indépendant' },

  // ── Autoroute ───────────────────────────────────────────────────────────
  { nom: '107.7', slug: '107-7', categorie_arcom: 'D', portee: 'autoroute', genre: 'info_talk', groupe_media: 'Vinci Autoroutes' },
  { nom: 'Autoroute Info', slug: 'autoroute-info', categorie_arcom: 'D', portee: 'autoroute', genre: 'info_talk', groupe_media: 'Sanef' },
];

/** Map exploitant ANFR → radio name for matching */
export const EXPLOITANT_TO_RADIO: Record<string, string> = {
  'RADIO FRANCE': 'France Inter',  // default; refined per frequency
  'SA NRJ': 'NRJ',
  'NRJ': 'NRJ',
  'SA NOSTALGIE': 'Nostalgie',
  'NOSTALGIE': 'Nostalgie',
  'CHERIE FM': 'Chérie FM',
  'SA CHERIE FM': 'Chérie FM',
  'RIRE ET CHANSONS': 'Rire et Chansons',
  'CLT-UFA': 'RTL',
  'RTL': 'RTL',
  'IP FRANCE': 'RTL',
  'RTL2': 'RTL2',
  'FUN RADIO': 'Fun Radio',
  'LAGARDERE': 'Europe 1',
  'EUROPE 1': 'Europe 1',
  'VIRGIN RADIO': 'Virgin Radio',
  'RFM': 'RFM',
  'EUROPE 2': 'Europe 2',
  'NEXT RADIO': 'RMC',
  'RMC': 'RMC',
  'BFM': 'BFM Business',
  'SKYROCK': 'Skyrock',
  'RADIO CLASSIQUE': 'Radio Classique',
  'SUD RADIO': 'Sud Radio',
  'FG CONCEPT': 'Radio FG',
  'TSF JAZZ': 'TSF Jazz',
  'OUI FM': 'Oüi FM',
  'RADIO NOVA': 'Radio Nova',
  'M RADIO': 'M Radio',
  'LATINA': 'Latina',
  'BEUR FM': 'Beur FM',
  'RADIO ORIENT': 'Radio Orient',
  'AFRICA N 1': 'Africa Radio',
  'CONTACT FM': 'Contact FM',
  'VOLTAGE': 'Voltage',
  'VIBRATION': 'Vibration',
  'ALOUETTE': 'Alouette',
  'WIT FM': 'Wit FM',
  'TOTEM': 'Totem',
  'HIT WEST': 'Hit West',
  'FLASH FM': 'Flash FM',
  'SWEET FM': 'Sweet FM',
  'CHAMPAGNE FM': 'Champagne FM',
  'SCOOP': 'Scoop',
  'JAZZ RADIO': 'Jazz Radio',
  'RADIO ESPACE': 'Radio Espace',
  'TOP MUSIC': 'Top Music',
  'KISS FM': 'Kiss FM',
  'TENDANCE OUEST': 'Tendance Ouest',
  'EVASION': 'Evasion',
  'RCF': 'RCF',
  'RADIO FIDELITE': 'Radio Fidélité',
  'PHARE FM': 'Phare FM',
  'ADO FM': 'Ado FM',
  'RADIO BONHEUR': 'Radio Bonheur',
  'CHANTE FRANCE': 'Chante France',
  'RADIO STAR': 'Radio Star',
  'D!CI RADIO': 'D!CI Radio',
  'RADIO 6': 'Radio 6',
  'FLOR FM': 'Flor FM',
  'RADIO SCOOP': 'Radio Scoop',
  '107.7': '107.7',
  'AUTOROUTE INFO': 'Autoroute Info',
  'SANEF 107.7': '107.7',
  'VINCI AUTOROUTES': '107.7',
  'COFIROUTE': '107.7',
  'ASF': '107.7',
  'APRR': '107.7',
  // Technical operators (not radio names — skip)
  'TOWERCAST': '__SKIP__',
  'TDF': '__SKIP__',
  'ITAS': '__SKIP__',
  'ONECAST': '__SKIP__',
  'DIFFUSION PLUS': '__SKIP__',
};
