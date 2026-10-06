/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/carreaux/normalisation.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
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
 * l'interface presente en « Revenu moyen par habitant » et « Surface moyenne
 * par menage ». Les diviser par la surface n'aurait aucun sens : leur
 * denominateur naturel est le nombre d'individus et le nombre de menages.
 * Sans cette division, la carte affichait « Revenu moyen : 11 941 181 € ».
 *
 * L'unite affichee doit porter ce denominateur (`€/hab`, `m²/mén.`), jamais
 * l'unite brute seule (`€`, `m²`) : un chiffre en euros sans /hab se lit comme
 * un total, pas comme une moyenne — c'est le meme mensonge sous une autre
 * forme, juste plus discret puisque l'ordre de grandeur, lui, est plausible.
 */

/** Un effectif se rapporte a une surface ; une moyenne a son propre effectif. */
export type ClasseIndicateur = 'effectif' | 'moyenne';

/**
 * Indicateurs qui sont des sommes a moyenner par leur effectif, et non des
 * effectifs a rapporter a une surface. Table close : ce sont les deux seuls
 * champs Filosofi dans ce cas.
 *
 * `unite` porte l'unite REELLE de la moyenne, denominateur inclus. Elle ne
 * peut pas venir de `CARREAUX_INDICATEURS.unit` ('€', 'm²') : ce champ brut
 * omet le denominateur et laisse croire a un total, pas a une moyenne — c'est
 * exactement le mensonge que corrige cette branche. `uniteNormalisee` sert
 * cette unite telle quelle, sans la recomposer.
 */
const MOYENNES: Record<
  string,
  { denominateur: 'population_totale' | 'menages_total'; unite: string }
> = {
  revenu_median:   { denominateur: 'population_totale', unite: '€/hab' },      // ind_snv  / ind
  surface_moyenne: { denominateur: 'menages_total',      unite: 'm²/mén.' },   // men_surf / men
};

/** Garantit qu'un id hors du catalogue (ex. `'toString'`, `'constructor'`) est toujours classe `'effectif'`, jamais lu depuis le prototype d'objet. */
export function classeDe(id: string): ClasseIndicateur {
  return Object.prototype.hasOwnProperty.call(MOYENNES, id) ? 'moyenne' : 'effectif';
}

/** Garantit qu'un id hors du catalogue retombe sur `'superficie_km2'`, jamais sur une valeur heritee du prototype d'objet (ex. `'constructor'`). */
export function denominateurDe(
  id: string,
): 'superficie_km2' | 'population_totale' | 'menages_total' {
  return Object.prototype.hasOwnProperty.call(MOYENNES, id)
    ? MOYENNES[id].denominateur
    : 'superficie_km2';
}

/**
 * @returns la valeur normalisee, ou `null` si la valeur ou le denominateur est
 *          inexploitable — un carreau sans habitant, ou une valeur `NaN`/`Infinity`
 *          en amont, ne doit pas produire `Infinity`/`NaN`, qui contaminerait le
 *          calcul des bornes.
 */
export function normaliser(valeur: number, denominateur: number): number | null {
  if (!Number.isFinite(valeur)) return null;
  if (!Number.isFinite(denominateur) || denominateur <= 0) return null;
  return valeur / denominateur;
}

/**
 * Garantit le suffixe `/km²` sur l'unite des effectifs. Pour les deux
 * moyennes (`revenu_median`, `surface_moyenne`), `uniteBrute` est ignoree :
 * l'unite reelle vient de {@link MOYENNES}, denominateur inclus
 * (`'€/hab'`, `'m²/mén.'`), jamais du champ brut `'€'`/`'m²'` qui, seul,
 * affiche une moyenne comme si c'etait un total.
 */
export function uniteNormalisee(id: string, uniteBrute: string): string {
  if (classeDe(id) === 'effectif') return `${uniteBrute}/km²`;
  return Object.prototype.hasOwnProperty.call(MOYENNES, id) ? MOYENNES[id].unite : uniteBrute;
}
