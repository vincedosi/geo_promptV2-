/**
 * Constantes des sections du FilterPanel — extraites du composant monolithe
 * (2026-09-03), où elles étaient reconstruites à chaque render.
 */

/** Régies OOH filtrables dans la section Panneaux. */
export const OOH_REGIES = [
  { id: 'DECAUX',       label: 'JCDecaux' },
  { id: 'Clear Chanel', label: 'Clear Channel' },
  { id: 'SIGNALI',      label: 'Signali' },
  { id: 'PUBLI ESPACE', label: 'Publi Espace' },
  { id: 'AFFIOUEST',    label: 'Affiouest' },
  { id: 'PUB OCEANNE',  label: 'Pub Océanne' },
  { id: 'PROMOVIL',     label: 'Promovil' },
  { id: 'RDPP',         label: 'RDPP' },
];

/** Modes de transport en commun filtrables. */
export const TRANSPORT_TYPES = [
  { id: 'bus',   label: 'Bus' },
  { id: 'train', label: 'Train' },
  { id: 'tram',  label: 'Tramway' },
  { id: 'metro', label: 'Métro' },
];

/** Tailles d'épingle proposées par POI sélectionné. */
export const PIN_SIZES = ['Petite', 'Standard', 'Grosse', 'Large'] as const;

/** Couleurs d'épingle proposées par POI sélectionné. */
export const PIN_COLORS: { label: string; hex: string }[] = [
  { label: 'Noir',    hex: 'var(--bg-level-2)' },
  { label: 'Blanc',   hex: '#eeeeee' },
  { label: 'Gris',    hex: '#888888' },
  { label: 'Violet',  hex: '#a855f7' },
  { label: 'Vert',    hex: '#3dffa0' },
  { label: 'Cyan',    hex: '#00d4ff' },
  { label: 'Rouge',   hex: '#ff4444' },
  { label: 'Orange',  hex: '#ff8c00' },
  { label: 'Jaune',   hex: '#ffd700' },
  { label: 'Bleu',    hex: '#3b82f6' },
];
