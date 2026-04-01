// Auto-détection du mapping colonnes INSEE → colonnes iris Supabase
// Architecture hybride : core (colonnes SQL fixes) ou jsonb (indicators)
//
// Règle de mapping :
//   1. Si la colonne match un PATTERN → dbTarget = nom colonne core
//   2. Sinon → dbTarget = nom CSV original (sera stocké dans iris.indicators)

import { CORE_COLUMN_NAMES } from './db-columns';

export interface AutoMapResult {
  /** Colonne CSV contenant le code IRIS (9 chiffres) */
  irisKeyCol: string;
  /**
   * Mapping complet : csvColName → dbTarget
   *   - dbTarget est un nom de colonne core  → CORE_COLUMN_NAMES.has(dbTarget) = true
   *   - dbTarget === csvColName              → indicateur JSONB (clé = nom CSV original)
   * Toutes les colonnes non-clé sont incluses.
   */
  mapping: Record<string, string>;
  /** Colonnes sans correspondance core — iront dans iris.indicators (JSONB) */
  jsonbCols: string[];
  /** Colonnes mappées vers une colonne core */
  coreCols: string[];
}

const PATTERNS: Array<{ re: RegExp; irisCol: string }> = [
  // Population totale
  { re: /^P\d{2}_POP$/,              irisCol: 'population'       },
  // Tranches d'âge
  { re: /^P\d{2}_POP0014$/,          irisCol: 'pop_0_14'         },
  { re: /^P\d{2}_POP1529$/,          irisCol: 'pop_15_29'        },
  { re: /^P\d{2}_POP3044$/,          irisCol: 'pop_30_44'        },
  { re: /^P\d{2}_POP4559$/,          irisCol: 'pop_45_59'        },
  { re: /^P\d{2}_POP6074$/,          irisCol: 'pop_60_74'        },
  { re: /^P\d{2}_POP75P$/,           irisCol: 'pop_75_plus'      },
  // Ménages
  { re: /^C\d{2}_MEN$/,              irisCol: 'nb_menages'       },
  { re: /^C\d{2}_MENPSEUL$/,         irisCol: 'nb_menages'       },
  // CSP (format RP ≥ 2017 : C22_POP15P_CS3 etc.)
  { re: /^C\d{2}_POP15P_CS3$/,       irisCol: 'nb_csp_cadre'     },
  { re: /^C\d{2}_POP15P_CS5$/,       irisCol: 'nb_csp_employe'   },
  { re: /^C\d{2}_POP15P_CS6$/,       irisCol: 'nb_csp_ouvrier'   },
  // CSP (anciens formats)
  { re: /^C\d{2}_CS3$/,              irisCol: 'nb_csp_cadre'     },
  { re: /^C\d{2}_CS5$/,              irisCol: 'nb_csp_employe'   },
  { re: /^C\d{2}_CS6$/,              irisCol: 'nb_csp_ouvrier'   },
  // Taux chômage (valeur directe — fichiers pré-calculés)
  { re: /^TCCHO\d{2}$/,              irisCol: 'taux_chomage'     },
  { re: /^TP_CHO\d{2}$/,             irisCol: 'taux_chomage'     },
  // Sources pour calculs dérivés (l'upload route calcule la valeur finale)
  { re: /^P\d{2}_CHOM1564$/,         irisCol: '__src_chom'       },  // → taux_chomage
  { re: /^P\d{2}_ACT1564$/,          irisCol: '__src_act'        },  // → taux_chomage
  { re: /^P\d{2}_RP_PROP$/,          irisCol: '__src_prop'       },  // → taux_proprio
  { re: /^P\d{2}_RP$/,               irisCol: '__src_rp'         },  // → taux_proprio
  { re: /^P\d{2}_NSCOL15P_SUP2$/,    irisCol: '__src_sup2'       },  // → nb_diplome_sup
  { re: /^P\d{2}_NSCOL15P_SUP34$/,   irisCol: '__src_sup34'      },  // → nb_diplome_sup
  { re: /^P\d{2}_NSCOL15P_SUP5$/,    irisCol: '__src_sup5'       },  // → nb_diplome_sup
  { re: /^P\d{2}_NSCOL15P$/,         irisCol: '__src_nscol'      },  // → taux_diplome_sup
  // Revenu médian (Filosofi)
  { re: /^MED\d{2}$/,                irisCol: 'rev_median'       },
  { re: /^D\d{3}_MED$/,              irisCol: 'rev_median'       },
  { re: /^DEC_MED\d{2}$/,            irisCol: 'rev_median'       }, // BASE_TD_FILO_IRIS format
  // Déciles de revenus (Filosofi)
  { re: /^DEC_D1\d{2}$/,             irisCol: 'rev_d1'           }, // 1er décile
  { re: /^DEC_D9\d{2}$/,             irisCol: 'rev_d9'           }, // 9e décile
  // Taux de pauvreté (Filosofi) — TP60xx ou DISP_TP60xx (seuil 60% médiane)
  { re: /^DISP_TP60\d{2}$/,          irisCol: 'taux_pauvrete'    }, // revenu disponible (prioritaire)
  { re: /^TP60\d{2}$/,               irisCol: 'taux_pauvrete'    },
  // DEC_PTSAxx = part traitements/salaires → JSONB uniquement (pas core)
  // Indice de Gini (Filosofi)
  { re: /^DEC_GI\d{2}$/,             irisCol: 'indice_gini'      },
  // Emplois au lieu de travail (RP)
  { re: /^P\d{2}_EMPLT$/,            irisCol: 'nb_emplois'       },
  // Sources pour calcul taux_emploi
  { re: /^P\d{2}_ACTOCC1564$/,       irisCol: '__src_actocc'     }, // → taux_emploi
  // Sources pour indicateurs démographiques
  { re: /^P\d{2}_POP_ETR$/,          irisCol: '__src_pop_etr'    }, // → part_pop_etrangere
  // Sources pour indicateurs logement
  { re: /^P\d{2}_LOG$/,              irisCol: '__src_log'        }, // → part_residences_principales, part_appartements
  { re: /^P\d{2}_APPART$/,           irisCol: '__src_appart'     }, // → part_appartements
  { re: /^P\d{2}_RP_LOCHLMV$/,       irisCol: '__src_hlm'        }, // → part_logements_sociaux
  { re: /^P\d{2}_RP_ANEM0002$/,      irisCol: '__src_anem'       }, // → part_menages_emmenages_2ans
  // Sources pour indicateurs familles
  { re: /^C\d{2}_FAM$/,              irisCol: '__src_fam'        }, // → part_familles_monoparentales, part_couples_avec_enfants
  { re: /^C\d{2}_FAMMONO$/,          irisCol: '__src_fam_mono'   }, // → part_familles_monoparentales
  { re: /^C\d{2}_COUPENFANT$/,       irisCol: '__src_coup_enf'   }, // → part_couples_avec_enfants
  // Sources pour mobilité (activité)
  { re: /^C\d{2}_ACTOCC15P_PAS$/,    irisCol: '__src_act_pas'    }, // → part_actifs_marche_velo
  { re: /^C\d{2}_ACTOCC15P_VELO$/,   irisCol: '__src_act_velo'   }, // → part_actifs_marche_velo
  { re: /^C\d{2}_ACTOCC15P_TCOM$/,   irisCol: '__src_act_tcom'   }, // → part_actifs_transport_commun
  { re: /^C\d{2}_ACTOCC15P$/,        irisCol: '__src_act_occ15p' }, // → part_actifs_marche_velo, part_actifs_transport_commun
  // Sources pour activité par sexe
  { re: /^P\d{2}_HACT1564$/,         irisCol: '__src_h_act'      }, // → part_hommes_actifs
  { re: /^P\d{2}_H1564$/,            irisCol: '__src_h_tot'      }, // → part_hommes_actifs
  { re: /^P\d{2}_FACT1564$/,         irisCol: '__src_f_act'      }, // → part_femmes_actives
  { re: /^P\d{2}_F1564$/,            irisCol: '__src_f_tot'      }, // → part_femmes_actives
  // Propriétaires (valeur directe pré-calculée)
  { re: /^P\d{2}_PROP$/,             irisCol: 'taux_proprio'     },
  { re: /^TAUX_PROPRIO\d*$/i,        irisCol: 'taux_proprio'     },
  // Diplômes
  { re: /^P\d{2}_NSCOL15P_DIPLMIN$/, irisCol: 'nb_diplome_aucun' },
  { re: /^P\d{2}_NSCOL15P_CAP$/,     irisCol: 'nb_diplome_bac'   },
  { re: /^P\d{2}_NSCOL15P_SUP$/,     irisCol: 'nb_diplome_sup'   },
  { re: /^P\d{2}_NSCOL15P_BAC$/,     irisCol: 'nb_diplome_bac'   },
];

const IRIS_KEY_CANDIDATES = ['IRIS', 'IRISCODGEO', 'CODE_IRIS', 'iris'];

/**
 * Colonnes géographiques à ignorer lors de l'import (identifiants INSEE, pas des données).
 * Ces colonnes sont exclues du mapping par défaut.
 */
const GEO_META_IGNORE = new Set([
  'COM', 'LIBCOM', 'LIBIRIS', 'TYP_IRIS', 'TRIRIS', 'GRD_QUART',
  'UU2020', 'REG', 'DEP', 'ARR', 'CV', 'ZE2020', 'LIBEPCI', 'EPCI',
  'LIBUU2020', 'CATEAAV2020', 'LIBCATEAAV2020', 'AAV2020', 'LIBAAV2020',
]);

export function autoMap(csvColumns: string[]): AutoMapResult {
  // Déterminer la colonne clé IRIS
  const irisKeyCol = csvColumns.find(c => IRIS_KEY_CANDIDATES.includes(c)) ?? csvColumns[0];

  const mapping: Record<string, string> = {};
  const usedIrisCols = new Set<string>();
  const coreCols: string[] = [];
  const jsonbCols: string[] = [];

  for (const col of csvColumns) {
    if (col === irisKeyCol) continue;

    // Colonnes géo-méta : ignorer par défaut
    if (GEO_META_IGNORE.has(col.toUpperCase())) {
      mapping[col] = 'ignore';
      continue;
    }

    // Chercher un pattern core
    let matched = false;
    for (const { re, irisCol } of PATTERNS) {
      if (re.test(col) && !usedIrisCols.has(irisCol)) {
        mapping[col] = irisCol;
        usedIrisCols.add(irisCol);
        coreCols.push(col);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Si la colonne est déjà un nom de colonne core → la mapper directement
      if (CORE_COLUMN_NAMES.has(col.toLowerCase())) {
        mapping[col] = col.toLowerCase();
        coreCols.push(col);
      } else {
        // Indicateur JSONB : clé = nom CSV original (uppercase nettoyé)
        const jsonbKey = col.trim().replace(/\s+/g, '_');
        mapping[col] = jsonbKey;
        jsonbCols.push(col);
      }
    }
  }

  // Colonnes d'incertitude INSEE → toujours ignorer
  for (const col of csvColumns) {
    if (/INCERT/i.test(col) && mapping[col] && mapping[col] !== 'ignore') {
      mapping[col] = 'ignore';
      const idx = jsonbCols.indexOf(col);
      if (idx !== -1) jsonbCols.splice(idx, 1);
    }
  }

  return { irisKeyCol, mapping, jsonbCols, coreCols };
}
