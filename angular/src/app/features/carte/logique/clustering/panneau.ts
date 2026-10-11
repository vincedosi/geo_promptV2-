/**
 * La logique PURE du panneau de clusters (`app/map/_components/ClusterPanel.tsx`, lot 4, T19) : ce que React calculait
 * dans le corps du composant (`useMemo`, fonctions locales), sorti ici pour être testé sans rendu.
 */
import { libelleCourt } from './libelles';
import type { ClustersGeoJSON, PoiCluster, ProfilsPoi, ResumeCluster } from './types';

/** Une emprise `[[ouest, sud], [est, nord]]`, la forme de `onFitBounds`. */
export type Emprise = [[number, number], [number, number]];

/** Les clusters du résumé, par identifiant NUMÉRIQUE croissant (`Object.entries(summary).sort(…)`). */
export function clustersTries(summary: Readonly<Record<string, ResumeCluster>>): [string, ResumeCluster][] {
  return Object.entries(summary).sort((a, b) => Number(a[0]) - Number(b[0]));
}

/** Une ligne de l'onglet « POI », coordonnées comprises (`poiRows`). */
export type LignePoi = PoiCluster & { lat: number; lng: number };

/** Les POI de la table : tous, ou ceux du cluster filtré (`poiRows`, `ClusterPanel.tsx:314-330`). */
export function lignesPoi(geojson: ClustersGeoJSON | null, filtre: number | null): LignePoi[] {
  if (!geojson) return [];
  return geojson.features
    .filter((f) => filtre === null || f.properties['cluster_id'] === filtre)
    .map((f) => ({
      poi_id: String(f.properties['poi_id']),
      poi_name: String(f.properties['poi_name']),
      cluster_id: Number(f.properties['cluster_id']),
      cluster_label: String(f.properties['cluster_label']),
      cluster_color: String(f.properties['cluster_color']),
      categorie: String(f.properties['categorie']),
      ville: String(f.properties['ville']),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      profile_features: {},
    }));
}

/** L'emprise des POI d'un cluster (`fitCluster`) ; `null` s'il n'en a aucun. */
export function emprise(geojson: ClustersGeoJSON | null, cid: string): Emprise | null {
  const points = geojson?.features.filter((f) => String(f.properties['cluster_id']) === cid) ?? [];
  if (!points.length) return null;
  const lngs = points.map((f) => f.geometry.coordinates[0]);
  const lats = points.map((f) => f.geometry.coordinates[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

/**
 * Le POI d'un clic sur la couche (`onClustersClick`, `useMapInit.ts:783-806`). MapLibre rend des propriétés PLATES :
 * `profile_features` y est un JSON en texte, relu ici ; illisible (tronqué, absent) → profil vide, jamais une exception.
 */
export function poiDepuisClic(p: Readonly<Record<string, unknown>>, lngLat: { lat: number; lng: number }): PoiCluster {
  let profil: Record<string, number> = {};
  try {
    profil = JSON.parse(String(p['profile_features'] ?? '{}')) as Record<string, number>;
  } catch {
    profil = {};
  }
  return {
    poi_id: p['poi_id'] as string,
    poi_name: p['poi_name'] as string,
    cluster_id: Number(p['cluster_id']),
    cluster_label: p['cluster_label'] as string,
    cluster_color: p['cluster_color'] as string,
    categorie: p['categorie'] as string,
    ville: p['ville'] as string,
    profile_features: profil,
    lat: lngLat.lat,
    lng: lngLat.lng,
  };
}

/**
 * La couleur d'un cluster dans un `style` : un hexadécimal, ou le gris neutre de la donnée absente. `cluster_color`
 * vient de la base : on ne lui fait pas confiance (`useMapInit.ts:813-817` — React repliait sur un gris ardoise en dur).
 */
export function couleurBadge(couleur: unknown): string {
  return typeof couleur === 'string' && /^#[0-9a-f]{3,8}$/i.test(couleur) ? couleur : 'var(--donnee-absente)';
}

/** Le jeton de la silhouette : elle dit si les clusters se tiennent (`ClusteringSection.tsx:121-122`). */
export function jetonSilhouette(s: number): 'success' | 'warning' | 'danger' {
  return s >= 0.5 ? 'success' : s >= 0.3 ? 'warning' : 'danger';
}

/** `toLocaleDateString('fr-FR', { day, month, year: '2-digit' })`. */
export function dateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** `toLocaleDateString('fr-FR', { day, month })` — l'historique d'un POI. */
export function dateJourMois(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** La légende du radar de l'onglet « Légende » (`C${cid}: ${label.split('/')[0].trim().slice(0, 12)}`). */
export function etiquetteRadarCluster(cid: string, label: string): string {
  return `C${cid}: ${premierSegment(label).slice(0, 12)}`;
}

/** Le premier segment d'un libellé de cluster (« Seniors actifs / Propriétaires » → « Seniors actifs »). */
export function premierSegment(label: string): string {
  return label.split('/')[0].trim();
}

/** `(v * 100).toFixed(1) + '%'`. */
export function pourcent1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** `(v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'` (`CompareView`, `fmt`). */
export function pourcent1Signe(v: number): string {
  return (v >= 0 ? '+' : '') + pourcent1(v);
}

/** Une ligne du « Delta par feature » de deux POI. */
export interface LigneDelta {
  cle: string;
  libelle: string;
  valA: number;
  valB: number;
  delta: number;
}

/**
 * Les écarts entre deux POI (`CompareView`, `ClusterPanel.tsx:941-950`) : le profil du POI, à défaut la moyenne de son
 * cluster ; triés par écart absolu ; les trois premiers nomment le verdict.
 */
export function deltasComparaison(
  a: PoiCluster, b: PoiCluster, summary: Readonly<Record<string, ResumeCluster>>, cles: readonly string[],
): { lignes: LigneDelta[]; principales: string[] } {
  const clA = summary[String(a.cluster_id)];
  const clB = summary[String(b.cluster_id)];
  const lignes = cles.map((cle) => {
    const valA = a.profile_features[cle] ?? clA?.avg_profile[cle] ?? 0;
    const valB = b.profile_features[cle] ?? clB?.avg_profile[cle] ?? 0;
    return { cle, libelle: libelleCourt(cle), valA, valB, delta: valA - valB };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { lignes, principales: lignes.slice(0, 3).map((l) => l.libelle) };
}

/** Les profils d'un POI par durée (`loadDurCompare`, `ClusterPanel.tsx:282-285`). */
export function profilsParDuree(reponse: ProfilsPoi): Record<number, Record<string, number>> {
  const parDuree: Record<number, Record<string, number>> = {};
  for (const [d, v] of Object.entries(reponse.durations ?? {})) parDuree[Number(d)] = v.profile_features ?? {};
  return parDuree;
}

/** Cocher / décocher une durée : jamais la dernière (`toggleDur`). */
export function basculerDuree(actives: readonly number[], d: number): number[] {
  if (actives.includes(d)) return actives.length > 1 ? actives.filter((x) => x !== d) : [...actives];
  return [...actives, d].sort((a, b) => a - b);
}

/** Une ligne de « Variation par feature ». */
export interface LigneDuree {
  cle: string;
  libelle: string;
  valeurs: number[];
  amplitude: number;
}

/**
 * La comparaison des durées d'un POI (`CompareDurationsView`, `ClusterPanel.tsx:735-806`) : durées disponibles et
 * choisies, lignes dont l'amplitude dépasse 0,005, triées par amplitude, huit au plus.
 */
export function comparaisonDurees(
  donnees: Readonly<Record<number, Record<string, number>>>, actives: readonly number[], cles: readonly string[],
): { disponibles: number[]; choisies: number[]; lignes: LigneDuree[] } {
  const disponibles = Object.keys(donnees).map(Number).sort((a, b) => a - b);
  const choisies = actives.filter((d) => disponibles.includes(d));
  const lignes = cles.map((cle) => {
    const valeurs = choisies.map((d) => donnees[d]?.[cle] ?? 0);
    const amplitude = valeurs.length ? Math.max(...valeurs) - Math.min(...valeurs) : 0;
    return { cle, libelle: libelleCourt(cle), valeurs, amplitude };
  })
    .filter((l) => l.amplitude > 0.005)
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, 8);
  return { disponibles, choisies, lignes };
}

/**
 * Le message d'une durée sans modèle (404 de `GET /api/poi-clusters?duration=`). React n'en disait rien : le bouton
 * revenait, la carte restait vide. Les deux modèles en base sont à 15 min et le sélecteur propose 30/45/60 : sans ce
 * message, aucune durée proposée n'affiche jamais rien, sans que l'écran dise pourquoi.
 */
export function messageAucunModele(duree: number, dureesCalculees: readonly number[]): string {
  const durees = [...new Set(dureesCalculees)].sort((a, b) => a - b);
  const base = `Aucun modèle de clustering à ${duree} min`;
  return durees.length ? `${base} — modèles calculés : ${durees.map((d) => `${d} min`).join(', ')}.` : `${base}.`;
}
