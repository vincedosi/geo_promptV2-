import { NextResponse } from 'next/server';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

// Colonnes Filosofi carreaux 200m — table distincte (carreaux_filosofi), pas iris
const CARREAUX_COLUMNS = [
  { id: 'ind_18_24', label: 'Individus 18-24 ans',    group: 'age',     source: 'carreaux_filosofi' },
  { id: 'ind_25_39', label: 'Individus 25-39 ans',    group: 'age',     source: 'carreaux_filosofi' },
  { id: 'ind_40_54', label: 'Individus 40-54 ans',    group: 'age',     source: 'carreaux_filosofi' },
  { id: 'ind_inc',   label: 'Individus avec revenus', group: 'revenus', source: 'carreaux_filosofi' },
] as const;

// Mapping groupe IRIS_DB_COLUMNS → groupe scoring
const GROUP_MAP: Record<string, string> = {
  'Population': 'age',
  'Âge':        'age',
  'Revenus':    'revenus',
  'Diplômes':   'diplomes',
  'CSP':        'csp',
};

// GET /api/scoring/iris-columns
// Retourne les colonnes IRIS + carreaux disponibles pour le scoring
// Source de vérité : lib/iris-crawler/db-columns.ts
export async function GET() {
  const irisColumns = IRIS_DB_COLUMNS.map(col => ({
    id:     col.name,
    label:  col.label,
    group:  GROUP_MAP[col.group] ?? col.group.toLowerCase(),
    source: 'iris' as const,
  }));

  return NextResponse.json({ columns: [...irisColumns, ...CARREAUX_COLUMNS] });
}
