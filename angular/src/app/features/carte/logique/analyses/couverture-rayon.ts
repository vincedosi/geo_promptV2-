import { CLE_TOUTES, type CourbeCumulee, formaterKm } from '../../../risques/etapes/rayon/courbe-population.component';
import { CATEGORIES_HORS_POI } from '../jeux-carte';
import type { PerimetreRecette } from '../zones/recette';

/**
 * ④ Analyse — la couverture par rayon autour d'un type de POI (lot 4, T12) : la requête de
 * `GET /api/analyses/couverture-rayon` et sa réponse (`couverture_rayon_poi`, sql/272). Logique pure.
 */

export const RAYON_MAX_MIN_M = 100;
export const RAYON_MAX_MAX_M = 10_000;
export const RAYON_MAX_DEFAUT_M = 5000;
/** Le seul champ que la base détaille (liste fermée, `champ_non_admis` sinon). */
export const CHAMP_SOUS_CATEGORIE = 'sous_categorie';
/**
 * Les sites ICPE : en ② ils ont leur propre calque, hors du catalogue des POI (`/api/map/categories` ne compte que les
 * POI à source, et les 99 152 sites sont au socle sans source) — l'outil les propose donc en plus.
 */
export const TYPE_ICPE = { id: CATEGORIES_HORS_POI[0], label: 'Sites industriels à risque (ICPE)' } as const;

/** Une ligne de profil telle que saisie : la valeur du champ (`*` sans champ) et ses anneaux, « 500, 1000, 2000 ». */
export interface LigneProfil {
  readonly valeur: string;
  readonly anneaux: string;
}

export interface ReglageRayon {
  readonly categorie: string;
  readonly perimetre: PerimetreRecette;
  readonly cible: string;
  readonly rayonMax: number;
  readonly champ: string | null;
  readonly lignes: readonly LigneProfil[];
}

export interface ClasseRayon {
  readonly valeur: string;
  /** L'anneau extérieur de la bande ([précédent, anneau_m)). */
  readonly anneau_m: number;
  readonly population: number;
}

export interface ResultatCouvertureRayon {
  readonly cible: string;
  readonly rayon_max_m: number;
  readonly n_poi: number;
  /** Les POI retenus, `[lon, lat]`. */
  readonly poi: readonly (readonly [number, number])[];
  readonly population_perimetre: number;
  readonly courbes: readonly CourbeCumulee[];
  readonly classes?: readonly ClasseRayon[];
  readonly hors_classes?: number;
}

/** « 500, 1 000 ; 2000 » → `[500, 1000, 2000]` : la borne et le nombre d'anneaux se vérifient côté serveur (400). */
export function lireAnneaux(saisie: string): number[] {
  return saisie.split(/[,;]/).map((s) => Number(s.replace(/\s/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Le profil envoyé : `{ valeur: [anneaux triés] }`, des seules lignes qui en ont. Avec un champ, les lignes nomment des
 * valeurs ; sans champ, la seule ligne admise est `*`.
 */
export function profilRayon(r: Pick<ReglageRayon, 'champ' | 'lignes'>): Record<string, number[]> {
  return Object.fromEntries(lignesRetenues(r).filter((l) => l.anneaux.length > 0).map((l) => [l.valeur, l.anneaux]));
}

/** La requête : avec un champ, les valeurs saisies filtrent les POI (`valeur` répété). */
export function requeteRayon(r: ReglageRayon): string {
  const p = new URLSearchParams({
    categorie: r.categorie, perimetre_type: r.perimetre.type, perimetre_code: r.perimetre.code, cible: r.cible,
    rayon_max: String(r.rayonMax),
  });
  if (r.champ) {
    p.set('champ', r.champ);
    for (const l of lignesRetenues(r)) p.append('valeur', l.valeur);
  }
  const profil = profilRayon(r);
  if (Object.keys(profil).length > 0) p.set('profil', JSON.stringify(profil));
  return p.toString();
}

function lignesRetenues(r: Pick<ReglageRayon, 'champ' | 'lignes'>): { valeur: string; anneaux: number[] }[] {
  return r.lignes.map((l) => ({ valeur: l.valeur.trim(), anneaux: [...new Set(lireAnneaux(l.anneaux))].sort((a, b) => a - b) }))
    .filter((l) => l.valeur !== '' && (r.champ ? l.valeur !== CLE_TOUTES : l.valeur === CLE_TOUTES));
}

/** « 0-500 m », « 500 m-1 km » : la bande [anneau précédent, `anneau_m`) d'une classe, d'après le profil envoyé. */
export function libelleBande(anneaux: readonly number[], anneauM: number): string {
  const precedent = anneaux.filter((a) => a < anneauM).at(-1) ?? 0;
  return `${precedent === 0 ? '0' : distance(precedent)}-${distance(anneauM)}`;
}

function distance(m: number): string {
  return m >= 1000 ? formaterKm(m) : `${m} m`;
}
