/**
 * @file lib/carreaux/normalisation.ts
 *
 * Rend les valeurs des carreaux comparables entre paliers de zoom.
 *
 * La cascade de `get_tile` sert des mailles de 200 m, 2 km ou 5 km selon le
 * zoom. Un effectif brut n'y est donc pas comparable : mesuré le 2026-09-10 sur
 * Paris, la population mediane passe de 57 310 (2 km) a 814 (200 m) — un facteur
 * 70 pour un seul cran de zoom. Rapporte a la surface, l'ecart disparait.
 *
 * Deux champs Filosofi font exception. `ind_snv` et `men_surf` sont des SOMMES
 * (somme des niveaux de vie winsorises, somme des surfaces de logements), que
 * l'interface presente en « Revenu median » et « Surface moyenne ». Les diviser
 * par la surface n'aurait aucun sens : leur denominateur naturel est le nombre
 * d'individus et le nombre de menages. Sans cette division, la carte affiche
 * aujourd'hui « Revenu median : 11 941 181 € ».
 */

/** Un effectif se rapporte a une surface ; une moyenne a son propre effectif. */
export type ClasseIndicateur = 'effectif' | 'moyenne';

/**
 * Indicateurs qui sont des sommes a moyenner par leur effectif, et non des
 * effectifs a rapporter a une surface. Table close : ce sont les deux seuls
 * champs Filosofi dans ce cas.
 */
const MOYENNES: Record<string, 'population_totale' | 'menages_total'> = {
  revenu_median:   'population_totale', // ind_snv  / ind
  surface_moyenne: 'menages_total',     // men_surf / men
};

export function classeDe(id: string): ClasseIndicateur {
  return id in MOYENNES ? 'moyenne' : 'effectif';
}

export function denominateurDe(
  id: string,
): 'superficie_km2' | 'population_totale' | 'menages_total' {
  return MOYENNES[id] ?? 'superficie_km2';
}

/**
 * @returns la valeur normalisee, ou `null` si le denominateur est inexploitable
 *          — un carreau sans habitant ne doit pas produire `Infinity`, qui
 *          contaminerait le calcul des bornes.
 */
export function normaliser(valeur: number, denominateur: number): number | null {
  if (!Number.isFinite(denominateur) || denominateur <= 0) return null;
  return valeur / denominateur;
}

export function uniteNormalisee(id: string, uniteBrute: string): string {
  return classeDe(id) === 'effectif' ? `${uniteBrute}/km²` : uniteBrute;
}
