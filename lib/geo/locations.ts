/**
 * GENESIS — lib/geo/locations.ts
 *
 * Coordonnées de référence des villes et régions françaises.
 * Utilisé par /api/chat pour résoudre les localisations textuelles
 * en coordonnées lat/lng.
 */

// ---------------------------------------------------------------------------
// Grandes villes
// ---------------------------------------------------------------------------

export const VILLES: Record<string, { lat: number; lng: number }> = {
  paris:              { lat: 48.8566, lng:  2.3522 },
  lyon:               { lat: 45.764,  lng:  4.8357 },
  marseille:          { lat: 43.2965, lng:  5.3698 },
  bordeaux:           { lat: 44.8378, lng: -0.5792 },
  nantes:             { lat: 47.2184, lng: -1.5534 },
  lille:              { lat: 50.6292, lng:  3.0573 },
  toulouse:           { lat: 43.6047, lng:  1.4442 },
  nice:               { lat: 43.7102, lng:  7.262  },
  strasbourg:         { lat: 48.5734, lng:  7.7521 },
  rennes:             { lat: 48.1173, lng: -1.6778 },
  montpellier:        { lat: 43.6108, lng:  3.8767 },
  grenoble:           { lat: 45.1885, lng:  5.7245 },
  dijon:              { lat: 47.322,  lng:  5.0415 },
  angers:             { lat: 47.4784, lng: -0.5632 },
  reims:              { lat: 49.2583, lng:  4.0317 },
  metz:               { lat: 49.1193, lng:  6.1757 },
  tours:              { lat: 47.3941, lng:  0.6848 },
  brest:              { lat: 48.3904, lng: -4.4861 },
  cannes:             { lat: 43.5528, lng:  7.017  },
  toulon:             { lat: 43.1242, lng:  5.928  },
  rouen:              { lat: 49.4432, lng:  1.0999 },
  nancy:              { lat: 48.6921, lng:  6.1844 },
  nimes:              { lat: 43.8367, lng:  4.3601 },
  perpignan:          { lat: 42.6887, lng:  2.9483 },
  besancon:           { lat: 47.2378, lng:  6.0241 },
  orleans:            { lat: 47.9029, lng:  1.9039 },
  caen:               { lat: 49.1829, lng: -0.3707 },
  amiens:             { lat: 49.8941, lng:  2.2957 },
  limoges:            { lat: 45.8336, lng:  1.2611 },
  'aix-en-provence':  { lat: 43.5297, lng:  5.4474 },
  'clermont-ferrand': { lat: 45.7797, lng:  3.0863 },
  'le havre':         { lat: 49.4938, lng:  0.1077 },
};

/** Rayon approximatif (en mètres) de la ville pour l'estimation des limites admin. */
export const CITY_BASE_RADIUS: Record<string, number> = {
  paris:        7000,
  lyon:         5500,
  marseille:    8000,
  bordeaux:     5000,
  nantes:       5000,
  lille:        4500,
  toulouse:     6000,
  nice:         5000,
  strasbourg:   4500,
  rennes:       4000,
  montpellier:  5000,
  grenoble:     4000,
};

// ---------------------------------------------------------------------------
// Régions
// ---------------------------------------------------------------------------

export const REGIONS: Record<string, { lat: number; lng: number }> = {
  'ile-de-france':               { lat: 48.8566,   lng:   2.3522  },
  'hauts-de-france':             { lat: 49.8941,   lng:   2.2957  },
  'normandie':                   { lat: 49.1829,   lng:  -0.3707  },
  'bretagne':                    { lat: 48.2020,   lng:  -2.9326  },
  'pays de la loire':            { lat: 47.4784,   lng:  -0.5632  },
  'centre-val de loire':         { lat: 47.9029,   lng:   1.9039  },
  'bourgogne-franche-comte':     { lat: 47.2378,   lng:   6.0241  },
  'grand est':                   { lat: 48.5734,   lng:   7.7521  },
  'auvergne-rhone-alpes':        { lat: 45.764,    lng:   4.8357  },
  'nouvelle-aquitaine':          { lat: 44.8378,   lng:  -0.5792  },
  'occitanie':                   { lat: 43.6047,   lng:   1.4442  },
  'paca':                        { lat: 43.2965,   lng:   5.3698  },
  "provence-alpes-cote d'azur":  { lat: 43.2965,   lng:   5.3698  },
  'corse':                       { lat: 42.1596,   lng:   9.1393  },
  'guadeloupe':                  { lat: 16.265,    lng: -61.551   },
  'martinique':                  { lat: 14.6415,   lng: -61.0242  },
  'guyane':                      { lat:  3.9339,   lng: -53.1258  },
  'la reunion':                  { lat: -21.1151,  lng:  55.5364  },
  'mayotte':                     { lat: -12.8275,  lng:  45.1662  },
  'nouvelle-caledonie':          { lat: -22.2558,  lng: 166.4505  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise une chaîne : minuscules, sans accents, espaces normalisés. */
export function normVille(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normLookup(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Résout un nom de ville en coordonnées. Fallback: Paris. */
export function getCoordsForVille(ville: string): { lat: number; lng: number } {
  const key = normLookup(ville);
  if (VILLES[key]) return VILLES[key];
  for (const [k, v] of Object.entries(VILLES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  console.warn(`[geo/locations] Ville inconnue: "${ville}" → Paris`);
  return { lat: 48.8566, lng: 2.3522 };
}

/** Résout un nom de région en coordonnées. Fallback: Paris. */
export function getCoordsForRegion(region: string): { lat: number; lng: number } {
  const key = normLookup(region);
  if (REGIONS[key]) return REGIONS[key];
  for (const [k, v] of Object.entries(REGIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  console.warn(`[geo/locations] Région inconnue: "${region}" → Paris`);
  return { lat: 48.8566, lng: 2.3522 };
}

/**
 * Résout la catégorie demandée contre les catégories réelles en base.
 * Retourne la catégorie exacte ou null si non trouvée.
 */
export function resolveCategory(
  requested: string | undefined,
  validCategories: string[]
): string | null {
  if (!requested) return null;
  const norm = normVille(requested);

  const exact = validCategories.find(c => c.toLowerCase() === norm);
  if (exact) return exact;

  const partial = validCategories.find(c => {
    const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return cn.includes(norm) || norm.includes(cn);
  });
  return partial ?? null;
}
