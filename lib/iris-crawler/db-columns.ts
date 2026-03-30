// ── Colonnes de la table public.iris ─────────────────────────────────────────
// Architecture hybride :
//   - Colonnes CORE  = colonnes SQL fixes, indexées, requêtables directement
//   - Indicateurs    = stockés dans iris.indicators (JSONB), merge additif
//
// classifyTarget(dbTarget) → 'core' | 'jsonb' | 'ignore'
//   'core'   → dbTarget est un nom de colonne SQL fixe → upsert direct
//   'jsonb'  → dbTarget est une clé JSONB (nom CSV original) → merge indicators
//   'ignore' → ignorer cette colonne

// ── Format existant (conservé pour rétrocompatibilité) ────────────────────────
export interface IrisDbColumn {
  name:  string;
  label: string;
  type:  'integer' | 'float';
  /** Groupe d'affichage (dropdown choroplèthe, system prompt) */
  group: 'Population' | 'Âge' | 'Revenus' | 'Diplômes' | 'CSP' | 'Emploi' | 'Logement' | 'Mobilité' | 'Familles';
}

/** Toutes les colonnes CORE (SQL fixes) de la table iris */
export const IRIS_DB_COLUMNS: IrisDbColumn[] = [
  { name: 'population',       label: 'Population totale',          type: 'integer', group: 'Population' },
  { name: 'nb_menages',       label: 'Nombre de ménages',          type: 'integer', group: 'Population' },
  { name: 'pop_0_14',         label: 'Pop 0–14 ans',               type: 'integer', group: 'Âge'        },
  { name: 'pop_15_29',        label: 'Pop 15–29 ans',              type: 'integer', group: 'Âge'        },
  { name: 'pop_30_44',        label: 'Pop 30–44 ans',              type: 'integer', group: 'Âge'        },
  { name: 'pop_45_59',        label: 'Pop 45–59 ans',              type: 'integer', group: 'Âge'        },
  { name: 'pop_60_74',        label: 'Pop 60–74 ans',              type: 'integer', group: 'Âge'        },
  { name: 'pop_75_plus',      label: 'Pop 75 ans+',                type: 'integer', group: 'Âge'        },
  { name: 'rev_median',       label: 'Revenu médian (€)',          type: 'float',   group: 'Revenus'    },
  { name: 'taux_chomage',     label: 'Taux de chômage (%)',        type: 'float',   group: 'Revenus'    },
  { name: 'taux_proprio',     label: 'Taux de propriétaires (%)',  type: 'float',   group: 'Revenus'    },
  { name: 'nb_diplome_aucun', label: 'Sans diplôme',               type: 'integer', group: 'Diplômes'   },
  { name: 'nb_diplome_bac',   label: 'Bac ou équivalent',          type: 'integer', group: 'Diplômes'   },
  { name: 'nb_diplome_sup',   label: 'Diplôme supérieur',          type: 'integer', group: 'Diplômes'   },
  { name: 'taux_diplome_sup', label: 'Taux diplôme sup (%)',       type: 'float',   group: 'Diplômes'   },
  { name: 'nb_csp_cadre',     label: 'CSP — Cadres',               type: 'integer', group: 'CSP'        },
  { name: 'nb_csp_employe',   label: 'CSP — Employés',             type: 'integer', group: 'CSP'        },
  { name: 'nb_csp_ouvrier',   label: 'CSP — Ouvriers',             type: 'integer', group: 'CSP'        },
  // Revenus — indicateurs Filosofi complémentaires
  { name: 'rev_d1',           label: '1er décile revenus (€)',     type: 'float',   group: 'Revenus'    },
  { name: 'rev_d9',           label: '9e décile revenus (€)',      type: 'float',   group: 'Revenus'    },
  { name: 'taux_pauvrete',    label: 'Taux de pauvreté (%)',       type: 'float',   group: 'Revenus'    },
  { name: 'indice_gini',      label: 'Indice de Gini',             type: 'float',   group: 'Revenus'    },
  // Emploi
  { name: 'nb_emplois',       label: 'Emplois au lieu de travail', type: 'integer', group: 'Emploi'     },
  { name: 'taux_emploi',      label: "Taux d'emploi (%)",          type: 'float',   group: 'Emploi'     },
  // Démographie dérivée
  { name: 'densite_pop',               label: 'Densité (hab/km²)',                   type: 'float',   group: 'Population' },
  { name: 'indice_jeunesse',           label: 'Indice de jeunesse',                  type: 'float',   group: 'Âge'        },
  { name: 'part_pop_etrangere',        label: 'Pop. étrangère (%)',                  type: 'float',   group: 'Population' },
  { name: 'part_pop_moins_18',         label: 'Pop. moins de 18 ans (%)',            type: 'float',   group: 'Âge'        },
  { name: 'part_pop_65_plus',          label: 'Pop. 65 ans et plus (%)',             type: 'float',   group: 'Âge'        },
  // Logement
  { name: 'part_residences_principales', label: 'Résidences principales (%)',        type: 'float',   group: 'Logement'   },
  { name: 'part_appartements',         label: 'Appartements (%)',                    type: 'float',   group: 'Logement'   },
  { name: 'part_logements_sociaux',    label: 'Logements sociaux HLM (%)',           type: 'float',   group: 'Logement'   },
  { name: 'part_menages_emmenages_2ans', label: 'Ménagés emménagés < 2 ans (%)',     type: 'float',   group: 'Logement'   },
  // Familles
  { name: 'part_familles_monoparentales', label: 'Familles monoparentales (%)',      type: 'float',   group: 'Familles'   },
  { name: 'part_couples_avec_enfants', label: 'Couples avec enfants (%)',            type: 'float',   group: 'Familles'   },
  // Mobilité
  { name: 'part_actifs_marche_velo',   label: 'Actifs marche/vélo (%)',              type: 'float',   group: 'Mobilité'   },
  { name: 'part_actifs_transport_commun', label: 'Actifs transports en commun (%)', type: 'float',   group: 'Mobilité'   },
  // Emploi par sexe
  { name: 'part_hommes_actifs',        label: 'Hommes actifs 15-64 (%)',             type: 'float',   group: 'Emploi'     },
  { name: 'part_femmes_actives',       label: 'Femmes actives 15-64 (%)',            type: 'float',   group: 'Emploi'     },
  // Diplômes dérivé
  { name: 'part_sans_diplome',         label: 'Sans diplôme (%)',                    type: 'float',   group: 'Diplômes'   },
  // Emploi communal (imputation)
  { name: 'nb_emplois_commune',        label: 'Emplois commune (imputés)',           type: 'float',   group: 'Emploi'     },
];

// ── Sets de noms (lookup O(1)) ────────────────────────────────────────────────

/** Noms des colonnes core — alias de IRIS_DB_COLUMN_NAMES pour rétrocompatibilité */
export const IRIS_DB_COLUMN_NAMES = new Set(IRIS_DB_COLUMNS.map(c => c.name));

/** Même set, nom explicite pour la logique hybride */
export const CORE_COLUMN_NAMES: ReadonlySet<string> = IRIS_DB_COLUMN_NAMES;

// ── Classifieur ───────────────────────────────────────────────────────────────

/**
 * Détermine si un dbTarget va dans une colonne SQL fixe, dans le JSONB indicators,
 * ou doit être ignoré.
 *
 * Règles :
 *   'ignore'          → ignorer
 *   CORE_COLUMN_NAMES → 'core'
 *   tout le reste     → 'jsonb'  (la valeur est la clé JSONB, ex: 'DEC_D121')
 */
export function classifyTarget(
  dbTarget: string,
): 'core' | 'jsonb' | 'ignore' {
  if (dbTarget === 'ignore') return 'ignore';
  if (CORE_COLUMN_NAMES.has(dbTarget)) return 'core';
  return 'jsonb';
}

/** Retourne le type core d'une colonne, ou null si ce n'est pas une colonne core */
export function getCoreColumnType(dbTarget: string): 'integer' | 'float' | null {
  return IRIS_DB_COLUMNS.find(c => c.name === dbTarget)?.type ?? null;
}
