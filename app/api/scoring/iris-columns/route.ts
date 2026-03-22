import { NextResponse } from 'next/server';

// GET /api/scoring/iris-columns
// Retourne les colonnes démographiques IRIS disponibles pour le scoring
export async function GET() {
  const columns = [
    // Population par âge
    { id: 'pop_0_14',    label: 'Population 0-14 ans',    group: 'age',     source: 'iris' },
    { id: 'pop_15_29',   label: 'Population 15-29 ans',   group: 'age',     source: 'iris' },
    { id: 'pop_30_44',   label: 'Population 30-44 ans',   group: 'age',     source: 'iris' },
    { id: 'pop_45_59',   label: 'Population 45-59 ans',   group: 'age',     source: 'iris' },
    { id: 'pop_60_74',   label: 'Population 60-74 ans',   group: 'age',     source: 'iris' },
    { id: 'pop_75_plus', label: 'Population 75+ ans',     group: 'age',     source: 'iris' },
    // Carreaux Filosofi (déjà disponibles, précision 200m)
    { id: 'ind_18_24',   label: 'Individus 18-24 ans',    group: 'age',     source: 'carreaux_filosofi' },
    { id: 'ind_25_39',   label: 'Individus 25-39 ans',    group: 'age',     source: 'carreaux_filosofi' },
    { id: 'ind_40_54',   label: 'Individus 40-54 ans',    group: 'age',     source: 'carreaux_filosofi' },
    { id: 'ind_inc',     label: 'Individus avec revenus', group: 'revenus', source: 'carreaux_filosofi' },
    // Revenus
    { id: 'rev_median',  label: 'Revenu médian (€/UC)',   group: 'revenus', source: 'iris' },
    // Diplômes
    { id: 'taux_diplome_sup', label: 'Taux diplômés sup. (%)', group: 'diplomes', source: 'iris' },
    { id: 'nb_diplome_sup',   label: 'Nb diplômés sup.',       group: 'diplomes', source: 'iris' },
    // Emploi
    { id: 'taux_chomage', label: 'Taux de chômage (%)', group: 'emploi', source: 'iris' },
    // Logement
    { id: 'taux_proprio', label: 'Taux propriétaires (%)', group: 'logement', source: 'iris' },
    // CSP
    { id: 'nb_csp_cadre',    label: 'Cadres & prof. intel.', group: 'csp', source: 'iris' },
    { id: 'nb_csp_employe',  label: 'Employés',              group: 'csp', source: 'iris' },
    { id: 'nb_csp_ouvrier',  label: 'Ouvriers',              group: 'csp', source: 'iris' },
  ];

  return NextResponse.json({ columns });
}
