/**
 * feature-themes.ts — Définition des thématiques de variables Filosofi
 * Source de vérité partagée entre le wizard et la page résultats.
 * DOIT rester en sync avec FEATURE_THEMES dans scripts/clustering_poi_filosofi.py
 */

export const FEATURE_THEMES = {
  demographie: {
    id: 'demographie',
    label: 'Démographie',
    description: 'Structure par âge de la population',
    color: '#3b82f6',
    features: ['pct_0_17', 'pct_18_39', 'pct_40_54', 'pct_55_79', 'pct_80p'],
  },
  revenus: {
    id: 'revenus',
    label: 'Revenus & Précarité',
    description: 'Niveau de vie et taux de pauvreté',
    color: '#f59e0b',
    features: ['revenu_moyen', 'taux_pauvrete'],
  },
  logement: {
    id: 'logement',
    label: 'Logement',
    description: "Statut d'occupation, type de logement, surface",
    color: '#10b981',
    features: [
      'taux_proprietaires', 'taux_collectif', 'taux_hlm',
      'taux_ancien', 'taux_recent', 'surface_moyenne',
    ],
  },
  menages: {
    id: 'menages',
    label: 'Ménages',
    description: 'Structure des ménages : isolés, familles, monoparentaux',
    color: '#8b5cf6',
    features: ['taux_isoles', 'taux_grandes_fam', 'taux_mono_parental'],
  },
} as const;

export type ThemeId = keyof typeof FEATURE_THEMES;

export const ALL_THEME_IDS: ThemeId[] = ['demographie', 'revenus', 'logement', 'menages'];

export const ALL_FEATURES: string[] = ALL_THEME_IDS.flatMap(t => [...FEATURE_THEMES[t].features]);

// Presets de sélection rapide
export const FEATURE_PRESETS = {
  all: {
    label: 'Toutes',
    description: 'Les 16 variables combinées',
    themes: ALL_THEME_IDS,
  },
  socio_demo: {
    label: 'Socio-démo',
    description: 'Démographie + Revenus',
    themes: ['demographie', 'revenus'] as ThemeId[],
  },
  habitat: {
    label: 'Habitat',
    description: 'Logement + Ménages',
    themes: ['logement', 'menages'] as ThemeId[],
  },
} as const;

// Labels lisibles par feature
export const FEATURE_LABELS: Record<string, string> = {
  pct_0_17:           '% 0–17 ans',
  pct_18_39:          '% 18–39 ans',
  pct_40_54:          '% 40–54 ans',
  pct_55_79:          '% 55–79 ans',
  pct_80p:            '% 80 ans et +',
  revenu_moyen:       'Indice revenu',
  taux_pauvrete:      'Taux de pauvreté',
  taux_proprietaires: '% propriétaires',
  taux_collectif:     '% logement collectif',
  taux_hlm:           '% HLM',
  taux_ancien:        '% logement ancien',
  taux_recent:        '% logement récent',
  surface_moyenne:    'Surface moyenne',
  taux_isoles:        '% personnes isolées',
  taux_grandes_fam:   '% grandes familles',
  taux_mono_parental: '% monoparentaux',
};

/**
 * Résout une liste de features sélectionnées en noms de thématiques actives.
 * Utilisé pour l'affichage et le stockage dans feature_themes.
 */
export function resolveThemesFromFeatures(features: string[]): ThemeId[] {
  return ALL_THEME_IDS.filter(tid => {
    const themeFeats = FEATURE_THEMES[tid].features as readonly string[];
    return themeFeats.some(f => features.includes(f));
  });
}

/**
 * Résout les thématiques actives en label lisible pour l'UI.
 * Ex: ['demographie'] → "Démographie (5 vars)"
 *     ['demographie', 'revenus'] → "Démographie + Revenus & Précarité (7 vars)"
 *     [] → "Personnalisé (N vars)" si aucune thématique complète
 */
export function featureSelectionLabel(features: string[]): string {
  const activeThemes = ALL_THEME_IDS.filter(tid => {
    const themeFeats = FEATURE_THEMES[tid].features as readonly string[];
    return themeFeats.every(f => features.includes(f));
  });

  if (activeThemes.length > 0 && activeThemes.length === ALL_THEME_IDS.length) {
    return `Toutes les variables (${features.length})`;
  }
  if (activeThemes.length > 0) {
    const labels = activeThemes.map(t => FEATURE_THEMES[t].label).join(' + ');
    return `${labels} (${features.length} vars)`;
  }
  return `Personnalisé (${features.length} vars)`;
}
