/**
 * @file lib/carte/voronoi-direct.ts — le Voronoï du panneau Analyse, sans le chat
 *
 * Jusqu'au 2026-10-12, « Lancer le calcul » écrivait au chat
 * « Fais le Voronoi des <catégorie> <territoire> » ; le modèle traduisait la
 * phrase en arguments de l'outil `voronoi_analysis`, et `useToolProcessor`
 * affichait son résultat. Le chat part (chantier « suppression de toute
 * l'IA », lot 4) : ce module fait les deux traductions à sa place.
 *
 *   1. `requeteVoronoi` — le territoire du panneau devient les paramètres de
 *      `GET /api/voronoi`, champ par champ, dans l'ordre où `buildTerritoire`
 *      (`use-territory-selection.ts`) le formulait : ville, puis UN
 *      département, puis UNE région, puis l'étendue (métropole / France
 *      entière). Une sélection de PLUSIEURS régions ou départements n'a pas
 *      d'équivalent dans la RPC (un seul filtre de chaque) : elle retombe sur
 *      l'étendue. Aucun écran ne la pose aujourd'hui — seul `PanneauFiltre`
 *      écrit ce périmètre, et seulement son étendue.
 *   2. `appliquerResultatVoronoi` — la branche `voronoi_analysis` de
 *      `useToolProcessor`, recopiée : erreur → bandeau, cellules →
 *      `applyVoronoi`, POI → `setZoneData`.
 *
 * Logique pure : aucun `fetch`, testée par `tests/unit/carte/voronoi-direct.test.ts`.
 */
import type { VoronoiData, ZoneData } from '@/types/spatial';

export interface TerritoireVoronoi {
  scope: 'metro' | 'all' | null;
  selectedRegions: string[];
  selectedDepts: string[];
  ville: string;
  /** Référentiel des régions : la RPC filtre `poi_france.region` par NOM. */
  refRegions: { code_region: string; nom_region: string }[];
}

/**
 * La chaîne de requête de `GET /api/voronoi` pour une catégorie et un territoire.
 *
 * `metropolitaine` vaut faux pour la seule étendue « France entière » (`all`),
 * vrai sinon — le défaut de l'outil copilote, que le modèle ne quittait que
 * sur « France entière ».
 */
export function requeteVoronoi(categorie: string, t: TerritoireVoronoi): string {
  const p = new URLSearchParams({ categorie });
  if (t.scope === 'all') p.set('metropolitaine', 'false');
  const ville = t.ville.trim();
  if (ville) {
    p.set('ville', ville);
  } else if (t.selectedDepts.length === 1) {
    p.set('departement', t.selectedDepts[0]);
  } else if (t.selectedDepts.length === 0 && t.selectedRegions.length === 1) {
    const code = t.selectedRegions[0];
    p.set('region', t.refRegions.find((r) => r.code_region === code)?.nom_region ?? code);
  }
  return p.toString();
}

/** Ce que rend `GET /api/voronoi` — succès ou refus, même enveloppe que l'outil. */
export interface ResultatVoronoi {
  error?: string;
  voronoiGeoJSON?: VoronoiData;
  poisForMap?: ZoneData;
  nb_polygones?: number;
  tronque?: boolean;
}

export interface AfficheurVoronoi {
  applyVoronoi: (data: VoronoiData) => void;
  setZoneData: (data: ZoneData) => void;
  setError: (message: string) => void;
}

/**
 * Affiche un résultat comme `useToolProcessor` le faisait pour
 * `voronoi_analysis` — même ordre, mêmes conditions, même message d'erreur.
 */
export function appliquerResultatVoronoi(resultat: ResultatVoronoi, afficheur: AfficheurVoronoi): void {
  if (resultat.error) {
    afficheur.setError(`⬡ Voronoï — Erreur : ${resultat.error}`);
    return;
  }
  const vGeo = resultat.voronoiGeoJSON;
  if (vGeo?.features && vGeo.features.length > 0) afficheur.applyVoronoi(vGeo);
  if (resultat.poisForMap) afficheur.setZoneData(resultat.poisForMap);
}
