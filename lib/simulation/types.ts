/**
 * Les types de la simulation de campagne (étape ⑤ du module risque).
 *
 * Une simulation fait diffuser une campagne sur le plan d'une EXTRACTION
 * (`zone_set_extraction_cp`), jour par jour, puis la recale. Rien ici ne parle
 * à la base : ces types décrivent ce que les fonctions pures de
 * `lib/simulation/` consomment et produisent, pour qu'elles se testent sans
 * conteneur.
 */

/** Un code postal d'une extraction, tel que le générateur le consomme. */
export interface CpSimulation {
  code_postal: string;
  /**
   * Le code postal qui porte la population de son groupe (sql/228). Un membre
   * non canonique partage la géométrie, la population et la part en zone de
   * son canonique : il ne compte JAMAIS dans une somme de population.
   */
  code_canonique: string;
  /** Le bassin dominant du code postal, ou `null` s'il n'en a aucun. */
  cluster_id: string | null;
  /** Retenu par le seuil de couverture : c'est « acheté en zone ». */
  retenu: boolean;
  /** Le multiplicateur du plan, tel qu'il part au DSP (moyenne ≈ 1). */
  multiplicateur: number;
  /** Population exposée du CANONIQUE (celle du groupe entier). */
  pop_en_zone: number;
  /** Population totale du CANONIQUE. */
  pop_totale: number;
  /** Part de la population du code postal qui vit en zone, de 0 à 100. */
  part_en_zone: number;
  /** Surface du code postal en km², `null` si le référentiel l'ignore. */
  surface_km2: number | null;
  /** Vrai pour un membre non canonique d'un groupe de codes postaux. */
  membre: boolean;
}

/** Un partenaire de diffusion : un nom générique, un CPM, une part du budget. */
interface Partenaire {
  nom: string;
  cpm: number;
  part: number;
}

/**
 * Les paramètres éditables d'une simulation.
 *
 * ⚠ Aucun ne fixe un résultat : l'alignement autour de 60 puis de 85 est une
 * CONSÉQUENCE de ces réglages, jamais une valeur écrite quelque part.
 */
export interface ParamsSimulation {
  /** Durée totale en jours. */
  jours: number;
  /** Premier jour diffusé sur l'extraction recalée (v2). */
  jourRecalage: number;
  /** Budget total en euros. */
  budget: number;
  /**
   * Intensité de l'effet inventaire : 1 = la diffusion suit le plan ; au-delà,
   * elle se concentre sur les codes postaux denses, où l'offre abonde.
   */
  intensite: number;
  /** Part du volume qui fuit vers les codes postaux hors zone, de 0 à 1. */
  fuite: number;
  /** Écart-type du bruit journalier multiplicatif (log-normal). */
  bruit: number;
  /** Amplitude de la dérive lente de l'inventaire, par bassin, sur la durée. */
  derive: number;
  /** Force du recalage, de 0 (aucune correction) à 1 (correction pleine). */
  amortissement: number;
  /** Sous cette part en zone (0 à 100), un code postal est « très dilué ». */
  seuilDilution: number;
  /** Facteur appliqué au multiplicateur d'un code postal très dilué. */
  baisseDilues: number;
  /** Graine du générateur : mêmes paramètres, mêmes chiffres. */
  graine: number;
  partenaires: Partenaire[];
}

/** Une ligne de diffusion : un jour, un code postal, un partenaire. */
export interface LigneDiffusion {
  jour: number;
  code_postal: string;
  partenaire: string;
  impressions: number;
  depense: number;
}
