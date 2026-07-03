/**
 * GET /api/insee-variables/list
 *
 * Liste les variables socio-démo utilisables pour la pondération automatique
 * (mode "Par variable INSEE" du wizard Step 2).
 *
 * Aujourd'hui : 1 variable (abstention présidentielle 2022).
 * À terme : revenu médian Filosofi, âge moyen, % diplômés, taux chômage, etc.
 *
 * Le frontend lit cette liste pour peupler le dropdown de sélection. Chaque
 * variable porte ses bornes (min/max/median) pour pré-configurer la courbe
 * de pondération avec des seuils sensés.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface VariableMeta {
  code: string;
  label_fr: string;
  category: 'Civique' | 'Démographie' | 'Économie' | 'Logement';
  description_fr: string;
  unit: string;
  icon: string;
  source: string;
  source_year: number;
  /** Bornes calculées sur les data réelles (min/max/median des valeurs en base). */
  min: number;
  max: number;
  median: number;
  /** Nombre de CPs couverts. */
  n_cps: number;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const variables: VariableMeta[] = [];

  // ─── Variable 1 : abstention présidentielle 2022 ─────────────────────────
  const { data: abstStats, error: abstErr } = await supabase
    .rpc('get_abstention_stats')
    .single();

  if (!abstErr && abstStats) {
    const s = abstStats as { min: number; max: number; median: number; n: number };
    variables.push({
      code: 'abstention_pres_2022',
      label_fr: 'Taux d\'abstention',
      category: 'Civique',
      description_fr: 'Présidentielle 2022 — second tour. Source : Ministère de l\'Intérieur.',
      unit: '%',
      icon: '🗳️',
      source: 'data.gouv.fr',
      source_year: 2022,
      min: Number(s.min),
      max: Number(s.max),
      median: Number(s.median),
      n_cps: Number(s.n),
    });
  }

  return NextResponse.json({ variables });
}
