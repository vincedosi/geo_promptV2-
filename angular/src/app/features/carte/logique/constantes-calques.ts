// Exception B12 : `PIN_COLORS` est un choix d'utilisateur (couleur d'épingle), pas une couleur d'interface — hexadécimaux gardés pour la parité (défaut React listé : violet #a855f7, interdit par le design system, et `var(--bg-level-2)` rangé dans un champ `hex`)
/**
 * Copie Angular (lot 4, P6) VERBATIM de `app/map/_components/filter-panel/constants.ts`,
 * `poi-style.ts` et de `lib/geo/france-admin.ts` (`POI_TYPES`, `POI_RAYONS`), verrouillée par
 * tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 étendu à /map).
 * `OOH_REGIES` n'est PLUS copié (2026-10-16) : l'Angular choisit une campagne de l'espace, plus des régies (spec
 * ooh-campagnes § 6) ; React garde sa liste.
 *
 * `AUDIENCE_METRICS` (même fichier React) n'est PAS copié : aucun panneau Angular ne le lit
 * (le catalogue d'indicateurs vient de `/api/iris/bornes` et `/api/cibles/indicators`).
 * Les types des paramètres directs vivent dans `modes-isochrones.ts`.
 * Ne pas corriger un défaut ici sans le corriger dans React.
 */

// ── filter-panel/constants.ts ───────────────────────────────────────────────

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

// ── filter-panel/poi-style.ts ───────────────────────────────────────────────

/** Style d'affichage d'un type de POI sur la carte. */
export interface POIStyle {
  size: string;
  color: string;
}

export type POIStylesMap = Record<string, POIStyle>;

// ── lib/geo/france-admin.ts ─────────────────────────────────────────────────

export const POI_TYPES = [
  { id: 'CIRFA',        label: 'CIRFA'       },
  { id: 'Lycées',       label: 'Lycées'      },
  { id: 'BTS / IUT',   label: 'BTS / IUT'   },
  { id: 'CFA',          label: 'CFA'         },
  { id: 'Gares',        label: 'Gares'       },
  { id: 'Universités',  label: 'Universités' },
  { id: 'Hôpitaux',    label: 'Hopitaux'    },
  { id: 'Pharmacies',   label: 'Pharmacies'  },
  { id: 'Supermarchés', label: 'Supermarches'},
  { id: 'Fast-foods',   label: 'Fast-foods'  },
  { id: 'Banques',      label: 'Banques'     },
  { id: 'Panneaux OOH', label: 'Panneaux OOH'},
];

export const POI_RAYONS    = ['500m', '1km', '2km', '3km', '5km', '10km', '20km'];
