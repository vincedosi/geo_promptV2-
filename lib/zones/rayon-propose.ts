/**
 * @file lib/zones/rayon-propose.ts — B10 : le plus petit rayon qui passe sous le plafond de cercles d'une plateforme
 * (`max_unites` de `plateformes_geo`), proposé quand le pavage au rayon demandé est refusé `trop_de_cercles` — au lieu
 * du seul « augmentez le rayon ». Rien n'est appliqué : la proposition est rendue à l'écran, qui la montre avec l'avant
 * (cercles au rayon demandé) et l'après (cercles au rayon proposé), et l'utilisateur la prend ou non (commun.md, règle 5).
 *
 * Logique PURE : le pavage est injecté (`essayer`, `paverAvecProposition` dans `conversion-serveur.ts` lui passe
 * `paver_cercles`), comme la garde (quota et temps, tour 1). Aucune limite de plateforme ici : le plafond vient du
 * refus (lui-même tiré de la ligne lue), le rayon maximal de la ligne ; à défaut, la borne de SÉCURITÉ de la RPC.
 *
 * Contrainte I/O (CLAUDE.md, § Disk I/O) : au plus `ESSAIS_RAYON_PROPOSE` pavages, UN À LA FOIS (chaque essai attend le
 * précédent), seulement après un refus `trop_de_cercles`, et chacun paie un jeton du quota de la route.
 */

/**
 * Au plus six pavages par recherche (brief B10 : « recherche dichotomique sur 6 valeurs au plus »). Une estimation puis
 * des bissections : entre le minimum (1 km) et le maximum (80 km) de Meta, six essais suffisent à tomber au pas de 500 m
 * quand l'estimation encadre la réponse (mesuré dans `tests/integration/rayon-defaut-surface.test.ts` : 30 000 km²
 * depuis 5 km, 4 essais). La DURÉE n'est pas bornée par ce nombre (le coût d'un pavage monte avec le rayon) mais par le
 * budget de temps de la route (`BUDGET_RECHERCHE_RAYON_MS`) ; le volume, par le quota que chaque essai consomme.
 */
export const ESSAIS_RAYON_PROPOSE = 6;

/**
 * Le pas des rayons essayés : celui de la réglette de rayon de ⑤ (`PAS_RAYON_M`, `mailles-url.ts` côté Angular ;
 * égalité verrouillée par `tests/unit/zones/rayon-propose.test.ts`). Un rayon proposé se règle donc tel quel.
 */
export const PAS_RAYON_PROPOSE_M = 500;

/**
 * Le rayon maximal de `paver_cercles` (sql/276, borne de SÉCURITÉ, pas une règle de plateforme) : le plafond de la
 * recherche pour une plateforme dont la ligne ne pose pas de `rayon_max_m`. Au-delà, la RPC lève 22023.
 */
export const RAYON_SECURITE_MAX_M = 200_000;

/**
 * Marge de l'estimation : le nombre de cercles retenus décroît à peu près comme 1 / r² (une cellule hexagonale de rayon
 * r couvre ≈ 2,6 r²), mais pas exactement (bords, seuil) ; viser 10 % au-dessus évite un essai gaspillé juste sous la
 * réponse.
 */
const MARGE_ESTIMATION = 1.1;

/** Ce qu'un essai de pavage rend : le nombre de cercles retenus, et le refus s'il y en a un. `null` : la RPC a échoué. */
export interface EssaiPavage { n_cercles: number; refus?: string }

/** Le rayon proposé : `au_pas` = le rayon un pas plus bas a été essayé et refusé (c'est bien le plus petit). */
interface RayonPropose { rayon_m: number; n_cercles: number; au_pas: boolean; essais: number }

/** Pourquoi rien n'est proposé, avec le plus grand rayon que la recherche pouvait essayer et le nombre d'essais faits. */
interface SansProposition {
  motif: 'aucun_sous_plafond' | 'essais_epuises' | 'aucun_cercle' | 'refus' | 'echec' | 'interrompue';
  rayon_max_m: number;
  essais: number;
}

/**
 * Tour 1 (I-1) : la recherche arrêtée par sa garde — quota épuisé (`quota`) ou temps restant sous le coût du dernier
 * essai (`temps`) —, avec le dernier rayon essayé et ses cercles (le rayon de départ si aucun essai n'a eu lieu).
 * L'écran le dit tel quel ; le meilleur rayon admis déjà trouvé reste proposé.
 */
interface Interruption { cause: 'quota' | 'temps'; dernier_rayon_m: number; dernier_n_cercles: number }

export type Proposition = (
  | { rayon_propose: RayonPropose; sans_proposition?: undefined }
  | { rayon_propose: null; sans_proposition: SansProposition }
) & { interrompue?: Interruption };

/**
 * La garde de la recherche (tour 1, I-1) : `consommer` prend UN jeton de quota avant chaque essai (`false` : quota
 * épuisé) ; `reste_ms` est le temps qui reste au budget de la requête. Sans garde : ni quota ni limite de temps (tests
 * du seul algorithme) — la route en passe toujours une.
 */
export interface GardeRecherche { reste_ms: () => number; consommer: () => Promise<boolean> }
const SANS_GARDE: GardeRecherche = { reste_ms: () => Number.POSITIVE_INFINITY, consommer: async () => true };

/** Le multiple du pas immédiatement au-dessus (ou égal), borné par le maximum. */
function auPas(r: number, max: number): number {
  return Math.min(max, Math.ceil(r / PAS_RAYON_PROPOSE_M) * PAS_RAYON_PROPOSE_M);
}

/**
 * Cherche le plus petit rayon (au pas) dont le pavage passe sous `plafond`, en partant d'un rayon refusé
 * (`depart.rayon_m`, `depart.n_cercles` cercles, `depart.duree_ms` le coût de ce pavage). Tant qu'aucun rayon ne
 * passe : estimation en 1 / r² depuis le dernier refus (au moins un pas de plus), jusqu'au maximum ; un maximum refusé
 * clôt la recherche (`aucun_sous_plafond`). Puis bissection entre le plus grand refusé et le plus petit admis, jusqu'à
 * un pas d'écart (`au_pas`). Un essai en échec (`echec`), un autre refus (`refus` : arrêt prudent — `zone_trop_vaste`
 * est une borne de coût qui ne se lève pas en grandissant ; `trop_de_candidates` pourrait se lever, la recherche ne le
 * tente pas) ou un pavage vide (`aucun_cercle`) arrêtent la recherche ; le meilleur rayon admis est alors proposé.
 *
 * GARDE, avant chaque essai : si le temps restant ne couvre pas le coût de l'essai précédent (le coût MONTE avec le
 * rayon, et la recherche ne fait que monter tant que rien ne passe), arrêt `temps`, sans jeton consommé ; sinon un
 * jeton de quota, et s'il est refusé, arrêt `quota`. Les deux arrêts sont rendus dans `interrompue`.
 */
export async function chercherRayonPropose(
  essayer: (rayon_m: number) => Promise<EssaiPavage | null>,
  depart: { rayon_m: number; n_cercles: number; plafond: number; duree_ms?: number },
  limites: { rayon_max_m?: number },
  garde: GardeRecherche = SANS_GARDE,
): Promise<Proposition> {
  const max = limites.rayon_max_m ?? RAYON_SECURITE_MAX_M;
  let bas = depart.rayon_m;
  let nBas = depart.n_cercles;
  let admis: { rayon_m: number; n_cercles: number } | null = null;
  let essais = 0;
  let dernier = { rayon_m: depart.rayon_m, n_cercles: depart.n_cercles, duree_ms: depart.duree_ms ?? 0 };
  const fin = (motif: SansProposition['motif'], cause?: Interruption['cause']): Proposition => ({
    ...(admis
      ? { rayon_propose: { ...admis, au_pas: admis.rayon_m - bas <= PAS_RAYON_PROPOSE_M, essais } }
      : { rayon_propose: null, sans_proposition: { motif, rayon_max_m: max, essais } }),
    ...(cause ? { interrompue: { cause, dernier_rayon_m: dernier.rayon_m, dernier_n_cercles: dernier.n_cercles } } : {}),
  });

  if (bas >= max) return fin('aucun_sous_plafond');
  while (essais < ESSAIS_RAYON_PROPOSE) {
    let r: number;
    if (!admis) {
      const estime = bas * Math.sqrt(Math.max(nBas, depart.plafond) / depart.plafond) * MARGE_ESTIMATION;
      r = auPas(Math.max(estime, bas + PAS_RAYON_PROPOSE_M), max);
    } else {
      if (admis.rayon_m - bas <= PAS_RAYON_PROPOSE_M) break;
      r = auPas((bas + admis.rayon_m) / 2, max);
      if (r >= admis.rayon_m) r = admis.rayon_m - PAS_RAYON_PROPOSE_M;
    }
    const reste = garde.reste_ms();
    if (reste < dernier.duree_ms) return fin('interrompue', 'temps');
    if (!(await garde.consommer())) return fin('interrompue', 'quota');
    // UN pavage à la fois : l'essai suivant dépend de celui-ci.
    const e = await essayer(r);
    essais += 1;
    if (!e) return fin('echec');
    dernier = { rayon_m: r, n_cercles: e.n_cercles, duree_ms: Math.max(0, reste - garde.reste_ms()) };
    if (e.refus && e.refus !== 'trop_de_cercles') return fin('refus');
    if (!e.refus && e.n_cercles === 0) return fin('aucun_cercle');
    if (!e.refus && e.n_cercles <= depart.plafond) {
      admis = { rayon_m: r, n_cercles: e.n_cercles };
      continue;
    }
    bas = r;
    nBas = e.n_cercles;
    if (!admis && r >= max) return fin('aucun_sous_plafond');
  }
  return fin('essais_epuises');
}
