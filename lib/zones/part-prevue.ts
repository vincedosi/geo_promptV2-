/**
 * @file lib/zones/part-prevue.ts — la PART PRÉVUE d'une unité du plan CP d'un jeu de zone (A8, amendement E5),
 * découplée du multiplicateur d'enchère.
 *
 * ── LA FORMULE (E5) ───────────────────────────────────────────────────────
 *
 *     poids(u)        = part(u) × volume(u) × classe(u)
 *     part prévue(u)  = poids(u) ÷ ( Σ_u poids(u) + poids(HORS_ZONE) )
 *
 * - `part(u)` : la couverture de l'unité (population en zone ÷ population totale, entre 0 et 1), celle que compare le
 *   seuil ;
 * - `volume(u)` : le VOLUME ATTENDU — en V1 la population totale de l'unité (Q9 = A, `VOLUME_ATTENDU`). C'est le point
 *   d'extension : un volume d'inventaire par CP le remplacera sans toucher à la formule ;
 * - `classe(u)` : le poids de classe (1 pour la classe unique `zone` d'un jeu de zone) ;
 * - `HORS_ZONE` (E3) entre dans la somme comme une unité : part 1 (elle porte toute la population de son volume),
 *   volume = populations totales des CP NON retenus du référentiel, classe = 0 en mode `strict`, le plancher national en
 *   mode `national` (`plan.ts`, `LigneHorsZone`).
 *
 * En V1, `part × volume` = population en zone : la part prévue est la part de population en zone (× classe), la
 * quantité que l'ancien mode exclusif produisait. LE MULTIPLICATEUR N'Y ENTRE PAS : un écrêtage (E4 (3)) change ce qui
 * est envoyé à la plateforme, jamais la part prévue (avant A8 : `bid_multiplier ÷ Σ bid_multiplier`, sql/113:61).
 *
 * ── L'UNITÉ DE SOMME : LE GROUPE (A2) ─────────────────────────────────────
 *
 * La somme se fait PAR UNITÉ CP (groupe de codes indiscernables), jamais par code : sommer par code faisait peser
 * Toulouse (6 codes, même multiplicateur) six fois (relecture A2, I-1). La part d'une unité est ensuite RÉPARTIE entre
 * ses codes, à parts ÉGALES (`REPARTITION_GROUPE`) : la population d'un membre n'existe pas — chaque carreau est
 * rattaché au code canonique (sql/228), `cp_population_totale` n'a qu'une ligne par groupe —, un prorata de population
 * est donc impossible par construction. La somme des membres = la part de l'unité, à l'arrondi flottant près.
 *
 * Une unité dont le volume ou la part est inconnu (liste exacte sans carreau, ARB-3) a une part prévue `null`, jamais
 * 0 : 0 se lirait « rien de prévu » et déclencherait une alerte de sous-pression qu'aucune diffusion ne lèverait.
 */

/** Q9 = A : le volume attendu d'une unité est sa population totale en V1. */
export const VOLUME_ATTENDU = 'population_totale' as const;

/** La part d'une unité se partage à parts égales entre ses codes (population d'un membre inconnue, sql/228). */
export const REPARTITION_GROUPE = 'egale' as const;

/** Une unité CP du plan, vue par la part prévue. */
export interface UnitePrevue {
  /** L'identifiant de l'unité (le code canonique). */
  code: string;
  /** Ses codes, le canonique compris. */
  membres: readonly string[];
  /** Couverture, entre 0 et 1 ; `null` si la population totale est inconnue. */
  part: number | null;
  /** Volume attendu ; `null` si inconnu. */
  volume: number | null;
  /** Poids de classe. */
  classe: number;
}

/** La ligne `HORS_ZONE`, vue par la part prévue. */
export interface HorsZonePrevue {
  part: number;
  /** Populations totales des CP non retenus du référentiel ; `null` si non lues. */
  volume: number | null;
  classe: number;
}

export interface PartsPrevues {
  /** Part prévue de chaque unité retenue (entre 0 et 1), `null` si incalculable. */
  par_unite: Map<string, number | null>;
  /** La même, répartie à parts égales entre les codes de l'unité. */
  par_code: Map<string, number | null>;
  /** Part prévue de `HORS_ZONE` ; `null` si incalculable. */
  hors_zone: number | null;
  /** Σ des poids, `HORS_ZONE` comprise ; `null` si la somme ne peut pas être formée. */
  somme: number | null;
}

/** `part × volume × classe`, ou `null` si la part ou le volume manque. */
export function poidsPrevu(part: number | null, volume: number | null, classe: number): number | null {
  if (part === null || volume === null || !Number.isFinite(part) || !Number.isFinite(volume) || volume <= 0) return null;
  return part * volume * classe;
}

/**
 * Les parts prévues des unités retenues d'un plan et de sa ligne `HORS_ZONE` (formule E5, en-tête).
 *
 * `HORS_ZONE` de classe 0 (mode strict) pèse 0 quel que soit son volume. De classe non nulle (mode national), son
 * volume est INDISPENSABLE : sans lui, la somme est fausse pour TOUTES les unités, et tout rend `null` plutôt qu'une
 * part gonflée.
 */
export function partsPrevues(unites: readonly UnitePrevue[], horsZone: HorsZonePrevue | null): PartsPrevues {
  const poids = unites.map((u) => poidsPrevu(u.part, u.volume, u.classe));
  const poidsHz = !horsZone || horsZone.classe === 0 ? 0 : poidsPrevu(horsZone.part, horsZone.volume, horsZone.classe);
  const connus = poids.reduce<number>((t, p) => t + (p ?? 0), 0);
  const somme = poidsHz === null ? null : connus + poidsHz;
  const valide = somme !== null && somme > 0;

  const par_unite = new Map<string, number | null>();
  const par_code = new Map<string, number | null>();
  unites.forEach((u, i) => {
    const p = poids[i];
    const part = valide && p !== null ? p / somme : null;
    par_unite.set(u.code, part);
    const n = Math.max(1, u.membres.length);
    for (const m of u.membres.length > 0 ? u.membres : [u.code]) par_code.set(m, part === null ? null : part / n);
  });
  return { par_unite, par_code, hors_zone: valide && poidsHz !== null ? poidsHz / somme : null, somme: valide ? somme : null };
}
