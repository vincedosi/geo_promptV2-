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


/**
 * Replie les lignes d'un même code postal en une seule.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ────────────────────────────────────────
 *
 * Depuis sql/225, `zone_set_cp` porte **une ligne par GRAPPE** : un code
 * postal à cheval sur deux bassins en a deux. Mesuré le 2026-09-22 sur le
 * profil par défaut : 2 255 lignes pour 1 942 codes postaux, **274 à cheval**,
 * jusqu'à **6 grappes** pour un seul, et **69 portent des classes différentes**
 * selon la grappe.
 *
 * Mais `bidding_zone_configs` a pour clé (strategy_id, postal_code,
 * country_code) : **un multiplicateur par code postal**. Émettre deux lignes
 * ferait échouer l'écriture du plan — ou, pire, en écraserait une par l'autre.
 *
 * ⚠ TROIS RÈGLES DE REPLI, ET UNE SEULE EST ÉVIDENTE :
 * - `pop_en_zone` se **somme** : chaque grappe apporte sa part.
 * - `pop_totale` NE SE SOMME PAS — c'est une propriété du code postal, répétée
 *   sur chacune de ses lignes. La sommer ferait peser un CP de trois bassins
 *   trois fois dans le taux d'utile.
 * - le poids devient une **moyenne pondérée par la population** des poids de
 *   classe. Pour un code postal à une seule ligne, le résultat est identique
 *   au calcul précédent — la généralisation ne change donc rien à l'existant.
 */
export function regrouperParCodePostal(cps: CpZone[], jeu: Pick<JeuDeZones, 'mode_plan' | 'poids'>): CpAgrege[] {
  return plierParCodePostal(cps).map(({ lignes, ...cp }) => ({
    ...cp,
    poids: cp.pop_en_zone > 0
      ? lignes.reduce((t, l) => t + l.pop_en_zone * poidsDeClasse(jeu, l.classe), 0) / cp.pop_en_zone
      : poidsDeClasse(jeu, cp.classe),
  }));
}

/** Un code postal replié, avec les lignes dont il vient. */
export interface CpPlie extends CpZone {
  /** Les lignes d'origine — une par grappe. */
  lignes: CpZone[];
}

/**
 * Replie les lignes par code postal, SANS toucher aux poids.
 *
 * ── POURQUOI CETTE FONCTION EST À PART ────────────────────────────────────
 *
 * Elle est la règle de repli, et elle a DEUX consommateurs qui n'ont pas les
 * mêmes besoins : le plan, qui a besoin d'un poids moyen pondéré, et
 * l'affichage par classe du panneau de l'atelier, qui n'a besoin d'aucun poids
 * et n'a pas de jeu normalisé sous la main.
 *
 * ⚠ Elle existe parce que le panneau comptait des LIGNES. Depuis sql/225,
 * `zone_set_cp` en porte une par (code postal x grappe) : le panneau
 * annonçait « 1 042 codes postaux sur 2 240 touchés » et un taux d'utile de
 * 77,1 %, à côté d'une carte qui disait « 890 sur 1 927 » et 81,6 % — les
 * deux chiffres justes étant ceux de la carte, vérifiés contre la base. Le
 * `pop_totale` sommé sur les lignes fait peser trois fois un code postal
 * présent dans trois bassins, et le taux d'utile s'effondre sans raison.
 */
export function plierParCodePostal(cps: CpZone[]): CpPlie[] {
  const par = new Map<string, CpZone[]>();
  for (const cp of cps) {
    const l = par.get(cp.code_postal);
    if (l) l.push(cp); else par.set(cp.code_postal, [cp]);
  }

  const out: CpPlie[] = [];
  for (const [code_postal, lignes] of par) {
    const pop_en_zone = lignes.reduce((t, l) => t + l.pop_en_zone, 0);
    // `max` et non une somme : la valeur est la même sur toutes les lignes.
    const pop_totale = Math.max(...lignes.map((l) => l.pop_totale));
    // `some` par tolérance : le SQL pose la même valeur sur toutes les lignes
    // d'un code postal (le seuil se décide sur leur somme), mais une donnée
    // incohérente ne doit pas faire disparaître un code postal retenu.
    const retenu = lignes.some((l) => l.retenu);
    // La classe AFFICHÉE reste la dominante, celle qui porte le plus de monde.
    const dominante = lignes.reduce((a, b) => (b.pop_en_zone > a.pop_en_zone ? b : a));
    out.push({
      code_postal, pop_en_zone, pop_totale, retenu,
      classe: dominante.classe, lignes,
    });
  }
  return out;
}

/** Un code postal replié : ses grappes fondues en une ligne. */
export interface CpAgrege extends CpZone {
  /** Moyenne des poids de classe, pondérée par la population de chaque grappe. */
  poids: number;
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

/**
 * Les codes postaux qu'un référentiel ne sait pas distinguer, par canonique.
 *
 * ── POURQUOI CETTE NOTION EXISTE ──────────────────────────────────────────
 *
 * `ref_codes_postaux` porte la MÊME géométrie pour tous les codes postaux
 * d'une commune : `ST_Equals(geom('44000'), geom('44200'))` répond `true`, et
 * les quatre codes postaux de Nantes partagent aussi leur centroïde, au bit
 * près. **71 groupes, 181 codes postaux**, jusqu'à 6 membres (sql/228).
 *
 * On ne peut donc PAS savoir dans lequel habite un exposé — l'information
 * n'est pas dans la donnée. Le rattachement retient un code CANONIQUE, et le
 * plan achète **tout le groupe** : cibler Nantes-44200 seul, c'était acheter
 * un quart d'une ville dont les exposés sont répartis sur les quatre.
 */
export type MembresParCanonique = ReadonlyMap<string, readonly string[]>;

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
export function genererPlanCp(
  entrees: CpZone[],
  jeu: Pick<JeuDeZones, 'mode_plan' | 'poids'>,
  membres?: MembresParCanonique,
): Plan {
  const exclusif = jeu.mode_plan === 'exclusif';

  // ⚠ Replié AVANT tout calcul : depuis sql/225 il y a une ligne par grappe,
  // et le DSP ne sait porter qu'un multiplicateur par code postal.
  const cps = regrouperParCodePostal(entrees, jeu);

  // Le poids brut de chaque code postal, avant normalisation.
  const bruts = cps.map((cp) => {
    // ⚠ Un code postal non retenu est traité comme hors zone, dans les DEUX
    // modes. En exclusif il est écarté ; en pondéré il garde le poids neutre.
    const classeEffective = cp.retenu ? cp.classe : HORS_ZONE;
    // Le poids moyen pondéré du code postal quand il est retenu ; le poids de
    // la classe hors-zone sinon.
    const poids = cp.retenu ? cp.poids : poidsDeClasse(jeu, classeEffective);

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
      lignes: etendreAuxGroupes(cps.map((cp) => ({
        code_postal: cp.code_postal, part_plan: 0, multiplicateur: 0,
        classe: cp.classe, retenu: cp.retenu,
      })), membres),
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
    lignes: etendreAuxGroupes(lignes, membres),
    part_plan_en_zone: Math.round(enZone * 1000) / 10,
    taux_utile: tauxUtile(cps),
    // ⚠ Compté sur les codes postaux CANONIQUES, avant l'étalement : c'est le
    // nombre de territoires retenus, pas le nombre de lignes envoyées au DSP.
    // Les compter après ferait « 1 115 retenus » là où il y a 1 112 zones.
    n_retenus: cps.filter((c) => c.retenu).length,
  };
}

/**
 * Étale chaque ligne sur tous les codes postaux de son groupe.
 *
 * ⚠ **LE MULTIPLICATEUR EST DIVISÉ PAR LE NOMBRE DE MEMBRES, et c'est le
 * point à ne pas inverser.** `refresh_campaign_rollups` normalise
 * (`planned_share = bid_multiplier / SUM(bid_multiplier) OVER ()`) : émettre
 * quatre lignes au même multiplicateur donnerait à Nantes QUATRE FOIS la part
 * qu'elle mérite, et le score d'alignement la déclarerait en sous-pression
 * permanente sans qu'aucune diffusion n'y puisse rien.
 *
 * La population du groupe est déjà portée en entier par la ligne canonique —
 * `cp_population_totale` agrège tous les carreaux de la commune sous le code
 * canonique (sql/228). Diviser préserve donc exactement la part du groupe.
 *
 * ⚠ Le plancher `MULT_MIN_NON_NUL` est ré-appliqué APRÈS la division : sur un
 * plan national, un sixième d'une part déjà faible s'arrondit à `0.000`, et le
 * code postal disparaîtrait du plan sans jamais apparaître comme exclu.
 *
 * ⚠ CHEMIN RISQUE SEULEMENT depuis A2 (2026-10-31). Le plan d'un jeu de ZONE ne
 * passe plus de `membres` : il développe ses unités CP au MÊME multiplicateur
 * (`lib/zones/unite-cp.ts`, `plan-jeu-zone.ts`), et la règle par plateforme est
 * un paramètre « à vérifier » du registre (`plateformes_geo.poids_groupe_cp`).
 */
function etendreAuxGroupes(lignes: LignePlan[], membres?: MembresParCanonique): LignePlan[] {
  if (!membres || membres.size === 0) return lignes;

  const sortie: LignePlan[] = [];
  for (const ligne of lignes) {
    const groupe = membres.get(ligne.code_postal);
    if (!groupe || groupe.length <= 1) {
      sortie.push(ligne);
      continue;
    }
    const n = groupe.length;
    const part = ligne.part_plan / n;
    const brut = Math.round((ligne.multiplicateur / n) * 1000) / 1000;
    const multiplicateur = ligne.multiplicateur > 0
      ? Math.min(MULT_MAX, Math.max(MULT_MIN_NON_NUL, brut))
      : 0;
    for (const code_postal of groupe) {
      sortie.push({ ...ligne, code_postal, part_plan: part, multiplicateur });
    }
  }
  return sortie;
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
