/**
 * Les libellés des 16 variables Filosofi du clustering — COPIE VERBATIM de `FEAT_SHORT` / `FEAT_LABEL`
 * (`components/ClusterRadar.tsx:12-48`, lot 4, T19), verrouillée par `tests/unit/angular/carte-logique-paritaire.test.ts`.
 *
 * Défaut React corrigé : `ClusterPanel.tsx:76-93` tenait une SECONDE table `FEAT_SHORT` aux noms de variables d'une
 * version antérieure du script (`pct_40_59`, `pct_60_74`, `pct_75p`, `pct_hlm`…). Sur les modèles en base, la moitié
 * des axes de son radar retombaient sur le nom brut tronqué (« pct_40_54 », « taux_pauv »). Une seule table ici, celle
 * des 16 variables que le script calcule réellement (`feature_names` des deux modèles).
 */
export const FEAT_SHORT: Record<string, string> = {
  pct_0_17:           '0-17',
  pct_18_39:          '18-39',
  pct_40_54:          '40-54',
  pct_55_79:          '55-79',
  pct_80p:            '80+',
  revenu_moyen:       'Revenu',
  taux_pauvrete:      'Précarité',
  taux_proprietaires: 'Proprios',
  taux_collectif:     'Collectif',
  taux_hlm:           'HLM',
  taux_isoles:        'Isolés',
  taux_grandes_fam:   'Gdes fam',
  taux_mono_parental: 'Mono-par',
  taux_ancien:        'Anc 1945',
  taux_recent:        'Rés 1990+',
  surface_moyenne:    'Surface',
};

export const FEAT_LABEL: Record<string, string> = {
  pct_0_17:           '% 0-17 ans',
  pct_18_39:          '% 18-39 ans',
  pct_40_54:          '% 40-54 ans',
  pct_55_79:          '% 55-79 ans',
  pct_80p:            '% 80 ans et +',
  revenu_moyen:       'Revenu moyen / ind',
  taux_pauvrete:      'Taux de pauvreté',
  taux_proprietaires: 'Taux propriétaires',
  taux_collectif:     'Taux logement collectif',
  taux_hlm:           'Taux HLM / social',
  taux_isoles:        'Taux ménages isolés',
  taux_grandes_fam:   'Taux grandes familles',
  taux_mono_parental: 'Taux mono-parental',
  taux_ancien:        'Taux logements avant 1945',
  taux_recent:        'Taux logements après 1990',
  surface_moyenne:    'Surface moyenne logement (m²)',
};

/** Le libellé court d'un axe ; à défaut, les 9 premiers caractères du nom (`FEAT_SHORT[k] ?? k.slice(0, 9)`). */
export function libelleCourtAxe(cle: string): string {
  return FEAT_SHORT[cle] ?? cle.slice(0, 9);
}

/** Le libellé court d'une ligne de tableau ; à défaut, le nom entier (`FEAT_SHORT[k] ?? k`). */
export function libelleCourt(cle: string): string {
  return FEAT_SHORT[cle] ?? cle;
}
