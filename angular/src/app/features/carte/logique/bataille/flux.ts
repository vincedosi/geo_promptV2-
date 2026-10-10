/**
 * Logique PURE des flux NDJSON des batailles — portage de la lecture que `useMapDirectActions.ts:118-509` faisait
 * à la main sur `res.body.getReader()` (lot 4, T17). Le découpage en lignes est celui, commun, de
 * `core/http/ndjson.ts` ; ici, ce que chaque événement veut dire.
 *
 * Unifié volontairement (React recopiait trois boucles presque identiques) : un même événement donne le même message
 * dans la bataille V1 et dans le remplissage V2 — React écrivait « undefined POIs trouvés » au remplissage quand le
 * total manquait, « ? » en V1 ; c'est « ? » partout. Même règle pour une erreur : une page HTML (503/521 relayée)
 * devient une phrase, le reste est coupé à 200 caractères.
 */
import type { BattleRing } from '../modes-isochrones';
import type { PoiBataille } from './anneaux';

/** Une ligne de flux : son `type` et ses champs, lus défensivement (rien n'est garanti par la route). */
export interface EvenementFlux {
  type: string;
  [champ: string]: unknown;
}

/** Un anneau brut d'isochrone, tel qu'il arrive avant la découpe (`partial_rings`), géométrie en OBJET. */
export interface AnneauBrut {
  cirfa_id: string;
  nom: string;
  lat: number;
  lng: number;
  palier: number;
  geojson: object;
}

/** Un POI de bataille avec sa catégorie (`POI` de `useMapDirectActions`, `setBattlePois`). */
export type PoiCategorise = PoiBataille & { categorie: string };

/** Le message d'un événement de la bataille V1 ou du remplissage (`useMapDirectActions.ts:165-181,331-346`). */
export function messageEvenement(e: EvenementFlux): string | null {
  if (e.type === 'partial_rings') {
    const n = Array.isArray(e['rings']) ? e['rings'].length : 0;
    return n > 0 ? `> ◆ +${n} isochrones sur la carte` : null;
  }
  if (e.type === 'pois_loaded') return `> ${e['total'] ?? '?'} POIs trouvés — démarrage ORS...`;
  if (e.type === 'progress') {
    if (e['status'] === 'bataille_postgis') return '> [BATAILLE] ST_Difference en cours (PostGIS)...';
    const termines = Number(e['completed'] ?? 0);
    const total = Number(e['total'] ?? 0);
    const pct = total > 0 ? Math.round((termines / total) * 100) : 0;
    const erreurs = Number(e['err'] ?? 0);
    return `> ${termines}/${total} POIs traités — ${pct}%${erreurs > 0 ? ` (${erreurs} erreurs ORS)` : ''}`;
  }
  return null;
}

/** Le message d'un événement de la bataille V2 (`useMapDirectActions.ts:473-476`). */
export function messageEvenementV2(e: EvenementFlux): string | null {
  switch (e.type) {
    case 'warning': return `> ! ${String(e['message'])}`;
    case 'pois_loaded': return `> ${String(e['total'])} POIs chargés`;
    case 'rings_loaded': return `> ${String(e['count'])} anneaux en cache (${String(e['missing'])} manquants)`;
    case 'computing': return `> ${String(e['message'])}`;
    default: return null;
  }
}

/** La progression de l'application par étape de la route (`useMapDirectActions.ts:404`) ; 50 pour une inconnue. */
const PCT_ETAPES: Readonly<Record<string, number>> = { clip: 15, clip_done: 45, battle: 50, done: 85 };
export function pctApplication(etape: unknown): number {
  return PCT_ETAPES[String(etape ?? '')] ?? 50;
}

/** Le message d'un événement `error`, ou d'un `error` de résultat. */
export function erreurDeFlux(brut: unknown): string {
  const texte = String(brut ?? 'Erreur inconnue');
  return texte.startsWith('<') ? 'Service temporairement indisponible (503/521)' : texte.slice(0, 200);
}

/**
 * Le message d'un échec HTTP d'une route lue en TEXTE (flux) : le corps est une chaîne, dont on relit `error`
 * (`err.error ?? \`HTTP ${res.status}\``, `useMapDirectActions.ts:143-144`). Statut 0 : le réseau.
 */
export function messageEchecHttp(e: unknown): string {
  const statut = (e as { status?: unknown } | null)?.status;
  if (typeof statut === 'number') {
    if (statut === 0) return 'Erreur réseau';
    const corps = (e as { error?: unknown }).error;
    try {
      const lu = (typeof corps === 'string' ? JSON.parse(corps) : corps) as { error?: unknown } | null;
      if (lu && typeof lu.error === 'string' && lu.error) return lu.error;
    } catch { /* un corps qui n'est pas du JSON : le statut parle */ }
    return `HTTP ${statut}`;
  }
  return e instanceof Error && e.message ? e.message : 'Erreur réseau';
}

const proprietes = (f: GeoJSON.Feature) => (f?.properties ?? {}) as Record<string, unknown>;

/** Les anneaux d'un résultat en anneaux bruts, pour l'affichage avant découpe (`useMapDirectActions.ts:200-215`). */
export function anneauxBruts(features: readonly GeoJSON.Feature[]): AnneauBrut[] {
  return features.filter((f) => !!f?.geometry).map((f) => {
    const p = proprietes(f);
    return {
      cirfa_id: String(p['cirfa_id'] ?? p['id'] ?? ''), nom: String(p['nom'] ?? ''), lat: Number(p['lat'] ?? 0),
      lng: Number(p['lng'] ?? 0), palier: Number(p['palier'] ?? 0), geojson: f.geometry as object,
    };
  });
}

/** Les anneaux à découper : seuls les `ring`, géométrie SÉRIALISÉE (contrat d'`apply-battle`, l.272-287). */
export function anneauxPourDecoupe(features: readonly GeoJSON.Feature[]): BattleRing[] {
  return features.filter((f) => proprietes(f)['feature_type'] === 'ring' && !!f?.geometry).map((f) => {
    const p = proprietes(f);
    return {
      cirfa_id: String(p['cirfa_id'] ?? p['id'] ?? ''), nom: String(p['nom'] ?? ''), lat: Number(p['lat'] ?? 0),
      lng: Number(p['lng'] ?? 0), palier: Number(p['palier'] ?? 0), geojson: JSON.stringify(f.geometry),
    };
  });
}

/**
 * Les POI de la bataille (`useMapDirectActions.ts:218-235`) : `poisForMap` quand la route le rend, sinon un par POI
 * des anneaux — les anciens caches v3 ne le portaient pas. La catégorie de la bataille est posée sur chacun.
 */
export function poisDeBataille(
  poisForMap: readonly (PoiBataille & { categorie?: string })[] | null | undefined,
  features: readonly GeoJSON.Feature[], categorie: string,
): PoiCategorise[] {
  if (poisForMap && poisForMap.length > 0) return poisForMap.map((p) => ({ ...p, categorie: p.categorie ?? categorie }));
  const vus = new Set<string>();
  const pois: PoiCategorise[] = [];
  for (const f of features) {
    const p = proprietes(f);
    const id = String(p['cirfa_id'] ?? p['id'] ?? '');
    const lat = Number(p['lat']);
    const lng = Number(p['lng']);
    if (!id || vus.has(id) || Number.isNaN(lat) || Number.isNaN(lng) || !lat || !lng) continue;
    vus.add(id);
    pois.push({ id, nom: String(p['nom'] ?? ''), lat, lng, categorie, adresse: String(p['adresse'] ?? ''), ville: String(p['ville'] ?? '') });
  }
  return pois;
}
