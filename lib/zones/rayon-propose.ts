/**
 * @file lib/zones/rayon-propose.ts — B10 : le plus petit rayon qui passe sous le plafond de cercles d'une plateforme
 * (`max_unites` de `plateformes_geo`), proposé quand le pavage au rayon demandé est refusé `trop_de_cercles` — au lieu
 * du seul « augmentez le rayon ». Rien n'est appliqué : la proposition est rendue à l'écran, qui la montre avec l'avant
 * (cercles au rayon demandé) et l'après (cercles au rayon proposé), et l'utilisateur la prend ou non (commun.md, règle 5).
 *
 * Logique PURE : le pavage est injecté (`essayer`, `paverAvecProposition` dans `conversion-serveur.ts` lui passe
 * `paver_cercles`). Aucune limite de plateforme ici : le plafond vient du refus (lui-même tiré de la ligne lue), le
 * rayon maximal de la ligne ; à défaut, la borne de SÉCURITÉ de la RPC.
 *
 * Contrainte I/O (CLAUDE.md, § Disk I/O) : au plus `ESSAIS_RAYON_PROPOSE` pavages, UN À LA FOIS (chaque essai attend le
 * précédent, jamais de `Promise.all`), et seulement après un refus `trop_de_cercles`.
 */

/**
 * Au plus six pavages par recherche (brief B10 : « recherche dichotomique sur 6 valeurs au plus »). Une estimation puis
 * des bissections : entre le minimum (1 km) et le maximum (80 km) de Meta, six essais suffisent à tomber au pas de 500 m
 * quand l'estimation encadre la réponse (mesuré dans `tests/integration/rayon-defaut-surface.test.ts`). Au pire mesuré
 * d'un pavage depuis A6 (ARA à 40 km, 5,6 s, sql/311), ≈ 40 s pour une requête (le pavage refusé et six essais) — sous
 * le `maxDuration` de 60 s de la route ; mesuré le 02/11 : 30 000 km² depuis 5 km, 4 essais, 5,8 s au total.
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
  motif: 'aucun_sous_plafond' | 'essais_epuises' | 'aucun_cercle' | 'refus' | 'echec';
  rayon_max_m: number;
  essais: number;
}

export type Proposition =
  | { rayon_propose: RayonPropose; sans_proposition?: undefined }
  | { rayon_propose: null; sans_proposition: SansProposition };

/** Le multiple du pas immédiatement au-dessus (ou égal), borné par le maximum. */
function auPas(r: number, max: number): number {
  return Math.min(max, Math.ceil(r / PAS_RAYON_PROPOSE_M) * PAS_RAYON_PROPOSE_M);
}

/**
 * Cherche le plus petit rayon (au pas) dont le pavage passe sous `plafond`, en partant d'un rayon refusé
 * (`depart.rayon_m`, `depart.n_cercles` cercles). Tant qu'aucun rayon ne passe : estimation en 1 / r² depuis le dernier
 * refus (au moins un pas de plus), jusqu'au maximum ; un maximum refusé clôt la recherche (`aucun_sous_plafond`). Puis
 * bissection entre le plus grand refusé et le plus petit admis, jusqu'à un pas d'écart (`au_pas`). Un essai en échec
 * (`echec`), un autre refus (`refus` : une borne de coût, qui ne se lève pas en grandissant) ou un pavage vide
 * (`aucun_cercle`) arrêtent la recherche ; le meilleur rayon admis déjà trouvé est alors proposé, s'il y en a un.
 */
export async function chercherRayonPropose(
  essayer: (rayon_m: number) => Promise<EssaiPavage | null>,
  depart: { rayon_m: number; n_cercles: number; plafond: number },
  limites: { rayon_max_m?: number },
): Promise<Proposition> {
  const max = limites.rayon_max_m ?? RAYON_SECURITE_MAX_M;
  let bas = depart.rayon_m;
  let nBas = depart.n_cercles;
  let admis: { rayon_m: number; n_cercles: number } | null = null;
  let essais = 0;
  const fin = (motif: SansProposition['motif']): Proposition => (admis
    ? { rayon_propose: { ...admis, au_pas: admis.rayon_m - bas <= PAS_RAYON_PROPOSE_M, essais } }
    : { rayon_propose: null, sans_proposition: { motif, rayon_max_m: max, essais } });

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
    // UN pavage à la fois : l'essai suivant dépend de celui-ci.
    const e = await essayer(r);
    essais += 1;
    if (!e) return fin('echec');
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
