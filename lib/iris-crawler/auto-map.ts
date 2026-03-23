// Auto-détection du mapping colonnes INSEE → colonnes iris Supabase
// Basé sur les conventions de nommage INSEE (P22_POP, C21_CS3, MED21…)

export interface AutoMapResult {
  /** Colonne CSV contenant le code IRIS (9 chiffres) */
  irisKeyCol: string;
  /** Mapping suggéré : csvColName → irisDbColName */
  mapping: Record<string, string>;
  /** Colonnes non mappées (pour affichage) */
  unmapped: string[];
}

const PATTERNS: Array<{ re: RegExp; irisCol: string }> = [
  // Population totale
  { re: /^P\d{2}_POP$/,          irisCol: 'population'       },
  // Tranches d'âge
  { re: /^P\d{2}_POP0014$/,      irisCol: 'pop_0_14'         },
  { re: /^P\d{2}_POP1529$/,      irisCol: 'pop_15_29'        },
  { re: /^P\d{2}_POP3044$/,      irisCol: 'pop_30_44'        },
  { re: /^P\d{2}_POP4559$/,      irisCol: 'pop_45_59'        },
  { re: /^P\d{2}_POP6074$/,      irisCol: 'pop_60_74'        },
  { re: /^P\d{2}_POP75P$/,       irisCol: 'pop_75_plus'      },
  // Ménages
  { re: /^C\d{2}_MEN$/,          irisCol: 'nb_menages'       },
  { re: /^C\d{2}_MENPSEUL$/,     irisCol: 'nb_menages'       }, // fallback
  // CSP (catégories socioprofessionnelles)
  { re: /^C\d{2}_CS3$/,          irisCol: 'nb_csp_cadre'     }, // cadres & PIS
  { re: /^C\d{2}_CS6$/,          irisCol: 'nb_csp_employe'   }, // employés
  { re: /^C\d{2}_CS7$/,          irisCol: 'nb_csp_ouvrier'   }, // ouvriers
  // Taux chômage (Filosofi ou base-ic activité calculée)
  { re: /^TCCHO\d{2}$/,          irisCol: 'taux_chomage'     }, // Filosofi
  { re: /^TP_CHO\d{2}$/,         irisCol: 'taux_chomage'     },
  // Revenu médian (Filosofi)
  { re: /^MED\d{2}$/,            irisCol: 'rev_median'       },
  { re: /^D\d{3}_MED$/,          irisCol: 'rev_median'       },
  // Taux pauvreté → rev_median n'est pas taux pauvreté, skip
  // Propriétaires (logement)
  { re: /^P\d{2}_PROP$/,         irisCol: 'taux_proprio'     }, // count → sera divisé par résid. princ.
  // Diplômes
  { re: /^P\d{2}_NSCOL15P_DIPLMIN$/, irisCol: 'nb_diplome_aucun' },
  { re: /^P\d{2}_NSCOL15P_CAP$/,    irisCol: 'nb_diplome_bac'   }, // approx
  { re: /^P\d{2}_NSCOL15P_SUP$/,    irisCol: 'nb_diplome_sup'   },
  { re: /^P\d{2}_NSCOL15P_BAC$/,    irisCol: 'nb_diplome_bac'   },
];

const IRIS_KEY_CANDIDATES = ['IRIS', 'IRISCODGEO', 'CODE_IRIS', 'iris'];

export function autoMap(csvColumns: string[]): AutoMapResult {
  // Déterminer la colonne clé IRIS
  const irisKeyCol = csvColumns.find(c => IRIS_KEY_CANDIDATES.includes(c)) ?? 'IRIS';

  // Appliquer les patterns
  const mapping: Record<string, string> = {};
  const usedIrisCols = new Set<string>();

  for (const col of csvColumns) {
    if (col === irisKeyCol) continue;
    for (const { re, irisCol } of PATTERNS) {
      if (re.test(col) && !usedIrisCols.has(irisCol)) {
        mapping[col] = irisCol;
        usedIrisCols.add(irisCol);
        break;
      }
    }
  }

  const unmapped = csvColumns.filter(
    c => c !== irisKeyCol && !mapping[c]
  );

  return { irisKeyCol, mapping, unmapped };
}
