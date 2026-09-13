/**
 * @file lib/qualite/verdict.ts — règle de verdict de la page « Qualité des
 * données » (2026-09-13, écrit après relecture).
 *
 * **Jumeau TypeScript de `qualite_indicateurs` (sql/152).** Le calcul de
 * production se fait en SQL, en un seul balayage d'`iris` ; ce module tient la
 * MÊME règle en TypeScript, testable sans base. Les deux doivent évoluer
 * ensemble, dans le même commit — comme `lib/analyses/score.ts` et
 * `calculer_score_composite`.
 *
 * ── Pourquoi cette règle mérite d'être écrite deux fois ────────────────────
 * La première version de cette page n'avait aucun test, et une relecture
 * indépendante y a trouvé le défaut suivant : les indicateurs dont la source
 * n'est ni `iris_column` ni journalisée — soit `pollen` et `atmo`, figés
 * depuis 72 jours — n'étaient atteints par AUCUNE branche du `CASE` (parce que
 * `m.n_lignes = 0` vaut NULL, pas TRUE, quand la ligne de journal n'existe
 * pas) et tombaient dans le `ELSE 'ok'`. La page annonçait donc « les 19
 * indicateurs actifs pointent vers des données exploitables » juste au-dessus
 * d'un encadré annonçant leur source périmée.
 *
 * C'est exactement le défaut que cette page prétend combattre. D'où la règle
 * de conception retenue ici : **aucune entrée ne doit atteindre « ok » par
 * omission**. Les cas non mesurables rendent `non_verifie`, jamais `ok` —
 * « je n'ai pas regardé » et « j'ai regardé, tout va bien » ne se disent pas
 * du même mot.
 */

/** Ce qu'on sait d'un indicateur au moment de le juger. */
export interface EntreeIndicateur {
  /** `iris_column`, `abstention`, `pollen`, `atmo`… */
  dataSource: string;
  /** La colonne source est-elle mesurable dans `information_schema` ? */
  colonneConnue: boolean;
  /** IRIS où la colonne est renseignée. `null` si non applicable. */
  nRenseignes: number | null;
  nTotal: number | null;
  /** Population couverte par les lignes renseignées. */
  popCouverte: number | null;
  popTotale: number | null;
  /** Codes postaux matérialisés dans `indicator_cp_values`. */
  nCp: number | null;
  /** Taille du référentiel `ref_codes_postaux` — jamais un nombre en dur. */
  nCpReference: number | null;
  /** Une matérialisation a-t-elle déjà été tentée (journal sql/148) ? */
  journalise: boolean;
  /** Âge de la source quotidienne, pour `pollen`/`atmo`. */
  ageSourceJours: number | null;
}

export type Verdict =
  | 'colonne_absente'
  | 'source_vide'
  | 'perime'
  | 'non_verifie'
  | 'partiel'
  | 'ok';

export interface ResultatVerdict {
  verdict: Verdict;
  /** 4 = bloquant, 0 = rien à signaler. Sert au tri : le pire se lit en premier. */
  gravite: number;
}

const GRAVITE: Record<Verdict, number> = {
  colonne_absente: 4,
  source_vide: 4,
  perime: 3,
  non_verifie: 2,
  partiel: 1,
  ok: 0,
};

/**
 * Seuil de couverture en POPULATION, et non en lignes.
 *
 * `iris` mélange 16 404 vrais IRIS (urbains) et 33 044 communes-IRIS
 * (rurales) : un ratio de lignes ne dit donc rien de l'audience, et l'audience
 * est ce qu'on achète. Mesures du 2026-09-13 : `rev_median` couvre 29 % des
 * lignes mais 57 % des habitants ; et à l'inverse une colonne renseignée sur
 * les seules communes rurales ferait 67 % des lignes pour 40 % de la
 * population — un comptage par lignes l'aurait déclarée « ok ».
 */
const COUVERTURE_POPULATION_MIN = 0.8;

/**
 * Seuil de couverture des codes postaux, en PART du référentiel.
 *
 * Le seuil précédent était un `3000` écrit en dur, soit 48 % des 6 187 codes
 * postaux : un indicateur couvrant la moitié de la France passait « ok ». Le
 * seul repère réel disponible — `abstention_pres_2022`, matérialisé sur
 * 6 186 CP sur 6 187 — montre qu'une matérialisation saine couvre ~100 %.
 */
const COUVERTURE_CP_MIN = 0.9;

/** Au-delà, une source à cadence quotidienne n'est plus « fraîche ». */
const AGE_QUOTIDIEN_MAX_JOURS = 3;

/**
 * Juge un indicateur. Voir l'en-tête pour la règle cardinale : jamais « ok »
 * par omission.
 */
export function verdictIndicateur(e: EntreeIndicateur): ResultatVerdict {
  const rendre = (verdict: Verdict): ResultatVerdict => ({ verdict, gravite: GRAVITE[verdict] });

  if (e.dataSource === 'iris_column' && !e.colonneConnue) return rendre('colonne_absente');

  if (e.dataSource === 'iris_column' && (e.nRenseignes ?? 0) === 0) return rendre('source_vide');

  if (e.nCp === 0) return rendre('source_vide');

  // Sources quotidiennes : leur fraîcheur EST leur validité.
  if (e.dataSource === 'pollen' || e.dataSource === 'atmo') {
    if (e.ageSourceJours === null) return rendre('source_vide');
    if (e.ageSourceJours > AGE_QUOTIDIEN_MAX_JOURS) return rendre('perime');
  }

  // Ni mesurable dans `iris`, ni jamais matérialisé : on n'a rien vérifié.
  if (e.dataSource !== 'iris_column' && !e.journalise) return rendre('non_verifie');

  if (
    e.dataSource === 'iris_column'
    && e.popTotale != null && e.popTotale > 0
    && e.popCouverte != null
    && e.popCouverte / e.popTotale < COUVERTURE_POPULATION_MIN
  ) return rendre('partiel');

  if (
    e.nCp != null && e.nCpReference != null && e.nCpReference > 0
    && e.nCp / e.nCpReference < COUVERTURE_CP_MIN
  ) return rendre('partiel');

  // Dernier filet : une entrée dont on ne sait rien de mesurable ne peut pas
  // être déclarée saine. C'est le cas que la version SQL d'origine laissait
  // tomber dans son `ELSE 'ok'`.
  if (
    e.dataSource !== 'iris_column'
    && e.nCp == null
    && e.ageSourceJours == null
  ) return rendre('non_verifie');

  return rendre('ok');
}
