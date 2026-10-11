/**
 * La logique PURE du rapport d'un modèle de clustering (`components/ClusterDetails.tsx`, lot 4, T19) : formats, tables
 * et textes que React calculait dans chaque onglet, sortis ici pour être testés sans rendu.
 */
import { FEATURE_THEMES, featureSelectionLabel } from './feature-themes';
import { FEAT_SHORT, libelleCourt } from './libelles';
import { pourcent1 } from './panneau';
import type { DetailModele, MoyennesFrance, PoiModele, ResumeCluster } from './types';

/** `Math.round(val / avg * 100)` ; `null` sans moyenne (`revenusIndex`). */
export function revenusIndex(val: number, moyenne: number): number | null {
  if (!moyenne) return null;
  return Math.round((val / moyenne) * 100);
}

/** La teinte d'un index de revenu : ≥ 110 au-dessus, ≤ 90 en dessous, sinon dans la moyenne. */
export function jetonIndex(idx: number): 'success' | 'warning' | 'danger' {
  return idx >= 110 ? 'success' : idx <= 90 ? 'danger' : 'warning';
}

/** `fmtVal` : la surface en m², tout le reste en pourcentage. */
export function formaterValeur(variable: string, v: number): string {
  return variable === 'surface_moyenne' ? `${v.toFixed(1)} m²` : pourcent1(v);
}

/** La même valeur, en cellule étroite (`FeatureRow` : « m² » collé). */
export function formaterValeurCompacte(variable: string, v: number): string {
  return variable === 'surface_moyenne' ? `${v.toFixed(1)}m²` : pourcent1(v);
}

/** Les variables du modèle ; à défaut, les 16 de `FEAT_SHORT` (`model.feature_names.length > 0 ? … : …`). */
export function variables(modele: DetailModele): string[] {
  return modele.feature_names.length > 0 ? modele.feature_names : Object.keys(FEAT_SHORT);
}

/** Le profil « Moy. France » des radars ; `undefined` sans moyennes. */
export function profilReference(france: MoyennesFrance | null): Record<string, number> | undefined {
  return france ? Object.fromEntries(Object.entries(france).map(([k, v]) => [k, v.avg])) : undefined;
}

/** `toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })`. */
export function dateLongue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Le panneau « Modèle vN » du résumé, `[libellé, valeur]` (`TabResume`). */
export function lignesModele(m: DetailModele): [string, string][] {
  return [
    ['Clusters (K)', String(m.k)],
    ['Silhouette', m.silhouette_score.toFixed(4)],
    ['Variables', featureSelectionLabel(m.feature_names)],
    ['PCA composantes', String(m.n_pca_components)],
    ['Variance expliquée', pourcent1(m.variance_explained)],
    ['POI entraînés', String(m.n_poi_trained)],
    ['Isochrone', `${m.duration_minutes} min ${m.mode}`],
    ['Créé le', dateLongue(m.created_at)],
  ];
}

/** « Excellent » ≥ 0,5, « Bon » ≥ 0,3, sinon « Faible » (`TabQualite`). */
export function libelleSilhouette(s: number): 'Excellent' | 'Bon' | 'Faible' {
  return s >= 0.5 ? 'Excellent' : s >= 0.3 ? 'Bon' : 'Faible';
}

/** Le badge des thématiques : affiché seulement pour 1 à 3 thématiques (4 = toutes, rien à dire). */
export function themesBadge(themes: readonly string[] | null): string | null {
  if (!themes || themes.length === 0 || themes.length >= 4) return null;
  return themes.map((t) => FEATURE_THEMES[t as keyof typeof FEATURE_THEMES]?.label ?? t).join(' + ');
}

/** Le nombre de POI aux variables imputées, par cluster (`imputedByCluster`). */
export function imputesParCluster(pois: readonly PoiModele[]): Record<string, number> {
  const parCluster: Record<string, number> = {};
  for (const p of pois) {
    if (p.imputed_features.length > 0) parCluster[String(p.cluster_id)] = (parCluster[String(p.cluster_id)] ?? 0) + 1;
  }
  return parCluster;
}

/** Les POI par cluster, clusters croissants (`TabCarte`). */
export function poisParCluster(pois: readonly PoiModele[]): [number, PoiModele[]][] {
  const ids = [...new Set(pois.map((p) => p.cluster_id))].sort((a, b) => a - b);
  return ids.map((cid) => [cid, pois.filter((p) => p.cluster_id === cid)]);
}

/** Un écart à la moyenne nationale (`deltaData` de `TabProfils`). */
export interface EcartFrance {
  variable: string;
  ecart: number;
}

/** L'écart d'un cluster à la moyenne nationale, variable par variable, arrondi à 4 décimales. */
export function ecartsFrance(cluster: ResumeCluster, vars: readonly string[], france: MoyennesFrance): EcartFrance[] {
  return vars.map((f) => ({
    variable: libelleCourt(f),
    ecart: parseFloat(((cluster.avg_profile[f] ?? 0) - (france[f]?.avg ?? 0)).toFixed(4)),
  }));
}

/** La teinte d'un écart en points (`TabComparaison`) : au-delà de ±0,02, au-dessus / en dessous. */
export function jetonEcart(delta: number): 'success' | 'danger' | 'text-primary' {
  return delta > 0.02 ? 'success' : delta < -0.02 ? 'danger' : 'text-primary';
}

/** Une cellule du tableau des profils (`FeatureRow`). */
export interface CelluleProfil {
  cid: string;
  couleur: string;
  /** Largeur de la barre, en % du maximum de la ligne. */
  largeur: number;
  texte: string;
  /** L'index de revenu (ligne `revenu_moyen` seulement). */
  index: number | null;
}

/** Une ligne du tableau des profils. */
export interface LigneProfil {
  variable: string;
  libelle: string;
  valeurs: CelluleProfil[];
  /** Position du repère national, en % du maximum ; `null` sans moyennes. */
  repereFrance: number | null;
  texteFrance: string | null;
}

/** Le tableau des profils de `TabProfils` : une ligne par variable, une cellule par cluster, le repère national. */
export function lignesTableauProfils(
  vars: readonly string[], cids: readonly string[], summary: Readonly<Record<string, ResumeCluster>>, france: MoyennesFrance | null,
): LigneProfil[] {
  const refRevenu = france?.['revenu_moyen']?.avg;
  return vars.map((variable) => {
    const moyenne = france?.[variable]?.avg;
    const brutes = cids.map((cid) => summary[cid]?.avg_profile[variable] ?? 0);
    const max = Math.max(...brutes, ...(moyenne !== undefined ? [moyenne] : []), 0.001);
    return {
      variable,
      libelle: libelleCourt(variable),
      valeurs: cids.map((cid, i) => ({
        cid,
        couleur: summary[cid]?.color ?? '',
        largeur: Math.min(100, (brutes[i] / max) * 100),
        texte: formaterValeurCompacte(variable, brutes[i]),
        index: variable === 'revenu_moyen' && refRevenu ? revenusIndex(brutes[i], refRevenu) : null,
      })),
      repereFrance: moyenne !== undefined ? Math.min(100, (moyenne / max) * 100) : null,
      texteFrance: moyenne !== undefined ? formaterValeurCompacte(variable, moyenne) : null,
    };
  });
}

/** Les six étapes de l'onglet « Méthodologie », textes de React (`TabMethodologie`). */
export function etapesMethodologie(m: DetailModele): { titre: string; detail: string }[] {
  return [
    { titre: '1. Données source', detail: 'Table carreaux_filosofi (INSEE Filosofi 200m). Seuil secret statistique : ind > 11. Carreaux exploitables : ~822 727 sur 2 298 582.' },
    { titre: '2. Calcul du profil POI', detail: `Isochrone OpenRouteService ${m.duration_minutes} min ${m.mode}. Intersection avec carreaux. Agrégation pondérée de ${m.feature_names.length} features socio-démographiques. Imputation médiane si secret stat.` },
    { titre: '3. Normalisation', detail: "StandardScaler (μ=0, σ=1) sur les 16 features. Élimine les effets d'unité (%, m², ratio revenu normalisé)." },
    { titre: '4. Réduction dimensionnelle (PCA)', detail: `PCA avec seuil de variance 85%. Résultat : ${m.n_pca_components} composantes → ${(m.variance_explained * 100).toFixed(1)}% de variance expliquée.` },
    { titre: '5. Clustering K-Means', detail: `Recherche du K optimal par maximisation du score de silhouette (K ∈ [3, 10]). K retenu : ${m.k}. Score final : ${m.silhouette_score.toFixed(4)}.` },
    { titre: '6. Features utilisées', detail: (m.feature_names ?? []).join(', ') || 'Standard 16 features Filosofi' },
  ];
}
