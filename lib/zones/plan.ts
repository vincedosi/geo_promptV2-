/**
 * La génération du plan de campagne depuis un jeu de zones.
 *
 * ── CE QUE CE FICHIER DÉCIDE ──────────────────────────────────────────────
 *
 * La part de budget de chaque code postal. C'est le seul endroit du produit où
 * une erreur ne fait pas afficher un mauvais chiffre : elle fait dépenser au
 * mauvais endroit.
 *
 * ── LA CONTRAINTE QUI FAÇONNE LA SORTIE ──────────────────────────────────
 *
 * Le plan atterrit dans `bidding_zone_configs.bid_multiplier`, un
 * `numeric(6,3)` — plafonné à 999,999 — qui vaut 0 à 1,6 sur les données
 * réelles (mesuré le 2026-09-20 sur 11 435 lignes). C'est un MULTIPLICATEUR,
 * pas une population : émettre `population × poids` déborderait la colonne dès
 * le premier code postal peuplé, et l'insert du lot entier échouerait.
 *
 * `refresh_campaign_rollups` normalise ensuite
 * (`planned_share = bid_multiplier / SUM(bid_multiplier) OVER ()`), donc seule
 * la PROPORTION compte. On centre les multiplicateurs sur 1 — la valeur neutre
 * — pour qu'ils restent lisibles par un humain qui ouvrirait la table.
 *
 * ── LE POINT DUR DU PRODUIT ───────────────────────────────────────────────
 *
 * Le DSP achète au CODE POSTAL, et un anneau de 1 km est bien plus petit qu'un
 * code postal. Retenir un code postal couvert à 2 %, c'est acheter 98 % de
 * hors-cible. `taux_utile` rapporte la population exposée à celle des codes
 * postaux retenus : sans lui, on croit cibler 11 000 habitants alors qu'on en
 * achète 20 000.
 */
import { poidsDeClasse, type JeuDeZones } from '@/lib/zones/jeu';
import { HORS_ZONE } from '@/lib/risques/affectation';

/** Un code postal, vu par le jeu de zones. Une ligne de `zone_set_cp`. */
export interface CpZone {
  code_postal: string;
  /** Classe dominante du code postal, ou `'hors'` si aucun carreau en zone. */
  classe: string;
  /** Population de ce code postal qui tombe dans une classe de risque. */
  pop_en_zone: number;
  /** Population totale du code postal. */
  pop_totale: number;
  /** Le code postal franchit-il `seuil_couverture_cp` ? */
  retenu: boolean;
}

/** Une ligne de plan, prête pour `bidding_zone_configs`. */
interface LignePlan {
  code_postal: string;
  /** Part du plan, entre 0 et 1. Somme à 1 sur l'ensemble, ou 0 si plan vide. */
  part_plan: number;
  /** Ce qui part en base, dans les bornes de `numeric(6,3)`. */
  multiplicateur: number;
  classe: string;
  retenu: boolean;
}

export interface Plan {
  lignes: LignePlan[];
  /**
   * Part du plan qui tombe sur des codes postaux en zone, en pourcentage.
   * `null` quand le plan est vide — zéro sur zéro n'est pas zéro.
   */
  part_plan_en_zone: number | null;
  /**
   * Population exposée rapportée à la population des codes postaux retenus,
   * en pourcentage. `null` si aucun code postal n'est retenu.
   */
  taux_utile: number | null;
  n_retenus: number;
}

/** Plafond de `bidding_zone_configs.bid_multiplier` (`numeric(6,3)`). */
const MULT_MAX = 999.999;

/**
 * Plancher d'un multiplicateur NON NUL.
 *
 * ⚠ Sans lui, un code postal peu peuplé d'un plan national peut avoir une part
 * si faible qu'elle s'arrondit à `0.000` — il disparaît alors du plan en
 * silence, sans jamais apparaître comme exclu. Un zéro DÉCIDÉ (mode exclusif,
 * poids nul) reste zéro ; un zéro d'arrondi devient 0,001.
 */
const MULT_MIN_NON_NUL = 0.001;

/**
 * Traduit un jeu de zones en plan à la maille code postal.
 *
 * **Mode `'exclusif'`** : seuls les codes postaux retenus reçoivent une part,
 * au prorata de `population en zone × poids de la classe`. Hors zone, la part
 * est exactement zéro — pas une miette résiduelle, qui laisserait partir du
 * budget là où on a décidé de ne pas aller.
 *
 * **Mode `'pondere'`** : tous les codes postaux reçoivent une part, au prorata
 * de `population totale × poids de la classe`. Un code postal NON RETENU pèse
 * comme un hors-zone, sans quoi le seuil de couverture n'aurait aucun effet
 * dans ce mode — un code postal couvert à 2 % recevrait le poids de sa classe
 * comme s'il l'était entièrement.
 *
 * @param cps - Les codes postaux du jeu, tels que `zone_set_cp` les porte.
 * @param jeu - Le jeu normalisé, avec ses poids et son mode.
 * @returns Le plan, et les deux chiffres qui doivent voyager avec lui.
 *
 * @example
 * genererPlanCp(cps, jeu).taux_utile // 55 — on achète 20 000 habitants pour en viser 11 000
 */
export function genererPlanCp(cps: CpZone[], jeu: JeuDeZones): Plan {
  const exclusif = jeu.mode_plan === 'exclusif';

  // Le poids brut de chaque code postal, avant normalisation.
  const bruts = cps.map((cp) => {
    // ⚠ Un code postal non retenu est traité comme hors zone, dans les DEUX
    // modes. En exclusif il est écarté ; en pondéré il garde le poids neutre.
    const classeEffective = cp.retenu ? cp.classe : HORS_ZONE;
    const poids = poidsDeClasse(jeu, classeEffective);

    if (exclusif) {
      return cp.retenu && classeEffective !== HORS_ZONE ? cp.pop_en_zone * poids : 0;
    }
    return cp.pop_totale * poids;
  });

  const total = bruts.reduce((t, x) => t + x, 0);

  // Aucun poids : pas de plan. Surtout PAS de repli uniforme — une campagne
  // dont le plan serait devenu uniforme sans prévenir diffuserait partout en
  // croyant cibler.
  if (total <= 0) {
    return {
      lignes: cps.map((cp) => ({
        code_postal: cp.code_postal, part_plan: 0, multiplicateur: 0,
        classe: cp.classe, retenu: cp.retenu,
      })),
      part_plan_en_zone: null,
      taux_utile: tauxUtile(cps),
      n_retenus: cps.filter((c) => c.retenu).length,
    };
  }

  const n = cps.length;
  const lignes: LignePlan[] = cps.map((cp, i) => {
    const part = bruts[i] / total;
    // Centré sur 1 : la moyenne des multiplicateurs vaut 1, la valeur neutre.
    const brut = part * n;
    const arrondi = Math.round(brut * 1000) / 1000;
    const multiplicateur = part > 0
      ? Math.min(MULT_MAX, Math.max(MULT_MIN_NON_NUL, arrondi))
      : 0;
    return {
      code_postal: cp.code_postal,
      part_plan: part,
      multiplicateur,
      classe: cp.classe,
      retenu: cp.retenu,
    };
  });

  const enZone = cps.reduce(
    (t, cp, i) => t + (cp.retenu && cp.classe !== HORS_ZONE ? lignes[i].part_plan : 0),
    0,
  );

  return {
    lignes,
    part_plan_en_zone: Math.round(enZone * 1000) / 10,
    taux_utile: tauxUtile(cps),
    n_retenus: cps.filter((c) => c.retenu).length,
  };
}

/**
 * Population exposée rapportée à la population des codes postaux retenus.
 *
 * `null` et non zéro quand rien n'est retenu : zéro sur zéro n'est pas zéro, et
 * afficher 0 % se lirait « on n'achète que du hors-cible » alors qu'on
 * n'achète rien.
 */
function tauxUtile(cps: CpZone[]): number | null {
  const retenus = cps.filter((c) => c.retenu);
  if (retenus.length === 0) return null;
  const totale = retenus.reduce((t, c) => t + c.pop_totale, 0);
  if (totale <= 0) return null;
  const exposee = retenus.reduce((t, c) => t + c.pop_en_zone, 0);
  return Math.round((exposee / totale) * 1000) / 10;
}
