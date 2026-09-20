/**
 * D'où vient le plan géographique d'une campagne — la source unique.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * Une campagne tire son plan d'un INDICATEUR INSEE ou d'un JEU DE ZONES. Les
 * deux vivent dans la même colonne, `bidding_strategies.in_zone_weights`, sous
 * deux formes différentes. Chaque écran qui la relit de son côté finit par la
 * relire un peu autrement.
 *
 * Le Suivi en portait déjà les dégâts : faute de `variable_code`, il repliait
 * sur `abstention_pres_2022` et titrait la vignette du milieu « la variable
 * qui a servi à bâtir le plan » — en nommant une variable que personne n'avait
 * choisie, sur une campagne dont le plan venait d'anneaux autour de sites
 * classés. Un écran qui nomme faux est pire qu'un écran muet.
 *
 * ── CE QUE LA FONCTION GARANTIT ───────────────────────────────────────────
 *
 * Elle ne lève jamais et ne devine rien. `in_zone_weights` vient de la base,
 * il a été écrit par plusieurs versions du produit, et un champ manquant doit
 * rendre `'aucun'` — jamais un repli silencieux sur une valeur plausible.
 */

/** Ce qui a bâti le plan d'une campagne. */
export type SourcePlan =
  | {
    type: 'indicateur';
    /** Code de `cible_indicator_registry` / `indicator_cp_values`. */
    code: string;
  }
  | {
    type: 'jeu_zones';
    zoneSetId: string;
    nom: string;
    version: number;
    modePlan: 'pondere' | 'exclusif';
    seuilCouvertureCp: number | null;
    tauxUtile: number | null;
    partPlanEnZone: number | null;
  }
  | { type: 'aucun' };

/** Un nombre, ou `null` — jamais `NaN`, jamais une valeur inventée. */
function nombre(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Lit la source du plan dans `in_zone_weights`.
 *
 * @param inZoneWeights - La colonne, telle que la base la rend.
 * @returns La source, ou `{ type: 'aucun' }` si rien d'exploitable.
 *
 * @example
 * sourceDuPlan({ mode: 'zone_set', zone_set_id: '…', zone_set_nom: 'Seveso' })
 * // → { type: 'jeu_zones', nom: 'Seveso', … }
 */
export function sourceDuPlan(inZoneWeights: unknown): SourcePlan {
  if (!inZoneWeights || typeof inZoneWeights !== 'object') return { type: 'aucun' };
  const w = inZoneWeights as Record<string, unknown>;

  if (w.mode === 'zone_set' && typeof w.zone_set_id === 'string') {
    return {
      type: 'jeu_zones',
      zoneSetId: w.zone_set_id,
      // Un nom vide vaut mieux qu'un nom inventé : l'écran écrira
      // « jeu de zones » sans prétendre savoir lequel.
      nom: typeof w.zone_set_nom === 'string' ? w.zone_set_nom : '',
      version: nombre(w.zone_set_version) ?? 1,
      modePlan: w.mode_plan === 'exclusif' ? 'exclusif' : 'pondere',
      seuilCouvertureCp: nombre(w.seuil_couverture_cp),
      tauxUtile: nombre(w.taux_utile),
      partPlanEnZone: nombre(w.part_plan_en_zone),
    };
  }

  if (typeof w.variable_code === 'string' && w.variable_code.length > 0) {
    return { type: 'indicateur', code: w.variable_code };
  }

  return { type: 'aucun' };
}

/**
 * Le titre de la vignette du milieu du Suivi, et son sous-titre.
 *
 * ⚠ Aucun des deux n'est écrit en dur dans un composant : c'est précisément la
 * dérive que ce fichier existe pour empêcher.
 *
 * @param source - La source du plan.
 * @param libelleIndicateur - Le libellé lisible de l'indicateur, quand il y en
 *   a un. Il vient du registre, pas d'une table recopiée ici.
 */
export function libellesVignettePlan(
  source: SourcePlan,
  libelleIndicateur?: string | null,
): { titre: string; sousTitre: string } {
  if (source.type === 'jeu_zones') {
    return {
      titre: source.nom || 'Jeu de zones',
      sousTitre: 'La part du plan destinée à chaque territoire.',
    };
  }
  if (source.type === 'indicateur') {
    return {
      titre: libelleIndicateur || source.code,
      sousTitre: 'La variable qui a servi à bâtir le plan.',
    };
  }
  return {
    titre: 'Plan',
    sousTitre: 'Cette campagne n’a pas de plan géographique déclaré.',
  };
}
