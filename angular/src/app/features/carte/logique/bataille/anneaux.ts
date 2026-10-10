/**
 * Logique PURE du rendu d'une bataille d'isochrones — portage de `applyIsochroneBattle`
 * (`app/copilote/_hooks/useMapLayers.ts:1029-1136`, lot 4). La tâche 14 s'en sert pour la zone ouverte par
 * `?customZone=` (un seul « POI », palier 1) ; la tâche 17 y branchera les batailles elles-mêmes.
 *
 * Une teinte par POI, dans l'ordre d'apparition (`VORONOI_PALETTE` en cycle) ; une opacité par palier
 * (`BATTLE_PALIER_OPACITY`, `0.20` pour un palier inconnu) ; un point par POI.
 */
import { BATTLE_PALIER_OPACITY, OPACITE_PALIER_INCONNU, VORONOI_PALETTE } from '../palettes-donnees-carte';

/** Un POI de bataille tel que la carte le pointe (`poisForMap`, `useMapLayers.ts:1033`). */
export interface PoiBataille {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  adresse?: string;
  ville?: string;
}

/** Une entrée de la légende de bataille (`battlePois` de `useMapLayers`). */
export interface LegendeBataille {
  id: string;
  nom: string;
  color: string;
}

/** L'identifiant de POI d'un anneau : `id` (v2) ou `cirfa_id` (v1), `useMapLayers.ts:1043-1044`. */
function idPoi(f: GeoJSON.Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return String(p['id'] ?? p['cirfa_id'] ?? '');
}

/**
 * Les anneaux colorés (`battle_color`, `battle_opacity` ajoutés aux propriétés) et la légende — une entrée par POI,
 * dans l'ordre d'apparition (`useMapLayers.ts:1039-1063`, `:1126-1136`).
 */
export function stylerAnneaux(anneaux: readonly GeoJSON.Feature[]): { anneaux: GeoJSON.Feature[]; legende: LegendeBataille[] } {
  const couleurs = new Map<string, string>();
  for (const f of anneaux) {
    const cid = idPoi(f);
    if (cid && !couleurs.has(cid)) couleurs.set(cid, VORONOI_PALETTE[couleurs.size % VORONOI_PALETTE.length]);
  }
  const styles = anneaux.map((f): GeoJSON.Feature & { properties: Record<string, unknown> } => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const palier = Number(p['palier'] ?? 120);
    return {
      ...f,
      properties: {
        ...p,
        battle_color: couleurs.get(idPoi(f)) ?? VORONOI_PALETTE[0],
        battle_opacity: BATTLE_PALIER_OPACITY[palier] ?? OPACITE_PALIER_INCONNU,
      },
    };
  });
  const vus = new Set<string>();
  const legende: LegendeBataille[] = [];
  for (const f of styles) {
    const cid = String(f.properties['id'] ?? '');
    if (!cid || vus.has(cid)) continue;
    vus.add(cid);
    legende.push({ id: cid, nom: String(f.properties['nom'] ?? cid), color: couleurs.get(cid) ?? VORONOI_PALETTE[0] });
  }
  return { anneaux: styles, legende };
}

/**
 * Les points des POI (`useMapLayers.ts:1089-1099`) : un point par POI aux coordonnées finies et NON NULLES — React
 * écarte `lat`/`lng` à 0, ce qui est aussi ce qui écarte un centre absent.
 */
export function pointsBataille(pois: readonly PoiBataille[]): GeoJSON.Feature[] {
  return pois
    .filter((p) => !Number.isNaN(p.lat) && !Number.isNaN(p.lng) && p.lat && p.lng)
    .map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { nom: p.nom, adresse: p.adresse ?? '', ville: p.ville ?? '', id: p.id },
    }));
}
