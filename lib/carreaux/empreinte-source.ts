/**
 * @file lib/carreaux/empreinte-source.ts
 *
 * Détection de péremption des bornes nationales de `lib/carreaux/bornes.ts`.
 *
 * ── Le problème ─────────────────────────────────────────────────────────────
 *
 * Les 28 bornes de `bornes.ts` sont un **instantané** des données Filosofi
 * mesuré le 2026-09-10. Elles sont écrites en dur dans le code, et c'est ce
 * qui rend deux territoires comparables : une densité donne la même couleur
 * où qu'on soit sur la carte.
 *
 * Mais le jour où quelqu'un ré-importe Filosofi — nouveau millésime, correction
 * d'un lot, reconstruction d'un agrégat — ces bornes décrivent une distribution
 * qui n'existe plus. **Et rien ne le signale.** Aucune erreur, aucun test rouge,
 * aucune couche vide. La carte reste parfaitement plausible : elle est
 * simplement fausse. C'est la pire forme de défaut, celle qu'on ne trouve qu'en
 * se demandant par hasard si un chiffre est crédible.
 *
 * Ce module ne corrige pas les bornes. Il rend leur péremption **visible**.
 *
 * ── Pourquoi cette empreinte-là ─────────────────────────────────────────────
 *
 * `carreaux_5km` (22 058 lignes) est dérivée du même import Filosofi que tout
 * le reste, et son balayage est trivial — quelques millisecondes, aucun risque
 * pour le budget I/O de Supabase Nano. Son nombre de lignes et ses totaux de
 * population et de ménages bougent dès que la source bouge.
 *
 * On ajoute le nombre de lignes de `carreaux_filosofi` **estimé par le
 * planificateur** (`pg_class.reltuples`). C'est gratuit — aucun scan des
 * 2,3 millions de lignes — et cela couvre le cas qu'une empreinte fondée sur
 * les seuls agrégats manquerait : un ré-import du 200 m sans reconstruction
 * des paliers dérivés. En contrepartie l'estimation est approximative, d'où la
 * tolérance ci-dessous.
 *
 * Ce qu'on ne fait PAS : un `count(*)` exact sur `carreaux_filosofi`, ni un
 * `sum()` sur ses 2,3 M de lignes. Une vérification de fraîcheur qui coûterait
 * un full scan serait désactivée au premier incident I/O, donc inutile.
 */

/** Tolérance sur l'estimation du planificateur, qui n'est pas un compte exact. */
const TOLERANCE_ESTIMATION = 0.02;

/**
 * État de la source au moment où les bornes de `bornes.ts` ont été mesurées.
 *
 * À mettre à jour EN MÊME TEMPS que les bornes, jamais séparément — c'est le
 * couple qui a du sens. Les requêtes de mesure sont dans
 * `sql/123_carreaux_bornes_nationales.sql`.
 */
export const EMPREINTE_MESURE = {
  mesureLe: '2026-09-10',
  carreaux5km: {
    lignes: 22_058,
    population: 62_592_659,
    menages: 28_279_067,
  },
  /** Estimation du planificateur, pas un compte exact — voir TOLERANCE_ESTIMATION. */
  carreauxFilosofiEstime: 2_298_582,
} as const;

/** Empreinte relevée en base, à comparer à `EMPREINTE_MESURE`. */
export interface EmpreinteRelevee {
  carreaux5kmLignes: number;
  carreaux5kmPopulation: number;
  carreaux5kmMenages: number;
  carreauxFilosofiEstime: number;
}

export interface DivergenceBornes {
  perimees: boolean;
  /** Une ligne par écart constaté, en clair. Vide si tout concorde. */
  ecarts: string[];
  mesureLe: string;
}

/**
 * Compare l'état actuel de la source à celui qui a servi à mesurer les bornes.
 *
 * Les trois valeurs de `carreaux_5km` sont comparées à l'identique : ce sont
 * des comptes et des sommes exacts, toute différence est réelle. L'estimation
 * du 200 m, elle, tolère 2 % — `reltuples` n'est rafraîchi qu'à l'ANALYZE et
 * dérive naturellement.
 */
export function comparerEmpreinte(relevee: EmpreinteRelevee): DivergenceBornes {
  const ecarts: string[] = [];
  const m = EMPREINTE_MESURE;

  if (relevee.carreaux5kmLignes !== m.carreaux5km.lignes) {
    ecarts.push(
      `carreaux_5km : ${relevee.carreaux5kmLignes} lignes contre ${m.carreaux5km.lignes} à la mesure`,
    );
  }
  if (relevee.carreaux5kmPopulation !== m.carreaux5km.population) {
    ecarts.push(
      `population : ${relevee.carreaux5kmPopulation} contre ${m.carreaux5km.population} à la mesure`,
    );
  }
  if (relevee.carreaux5kmMenages !== m.carreaux5km.menages) {
    ecarts.push(
      `ménages : ${relevee.carreaux5kmMenages} contre ${m.carreaux5km.menages} à la mesure`,
    );
  }

  const attendu = m.carreauxFilosofiEstime;
  const derive = Math.abs(relevee.carreauxFilosofiEstime - attendu) / attendu;
  if (derive > TOLERANCE_ESTIMATION) {
    ecarts.push(
      `carreaux_filosofi : ~${relevee.carreauxFilosofiEstime} lignes contre ~${attendu} à la mesure `
      + `(${(derive * 100).toFixed(1)} % d'écart, tolérance ${TOLERANCE_ESTIMATION * 100} %)`,
    );
  }

  return { perimees: ecarts.length > 0, ecarts, mesureLe: m.mesureLe };
}

/**
 * Nom de la RPC qui relève l'empreinte.
 *
 * Son corps vit dans la migration (`sql/130`), pas ici : recopier la requête
 * dans le code en ferait une seconde définition, libre de diverger de celle
 * que la base exécute réellement. Le module ne garde que la valeur de
 * référence et la règle de comparaison.
 */
export const RPC_RELEVE_EMPREINTE = 'releve_empreinte_carreaux' as const;
