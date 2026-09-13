/**
 * GET  /api/analyses?type=
 *   Liste des analyses enregistrées de l'org courante, triées par date
 *   décroissante. Colonnes légères seulement (pas `parametres`/`perimetre`/
 *   `resultat`) : c'est la liste affichée par Calques > Mes analyses
 *   (`PanneauCalques.tsx`), appelée au montage du groupe — elle doit rester
 *   bornée et indexée (contrainte I/O Nano). Bornée à 50 lignes, via
 *   `idx_analyses_org_date` (sql/145) : `EXPLAIN ANALYZE` mesuré Index Scan,
 *   < 0.1 ms, voir le rapport de tâche.
 *
 * POST /api/analyses
 *   Enregistre un lancement d'analyse (nom, paramètres complets, maillage,
 *   périmètre). C'est ce qui rend l'analyse rejouable — voir
 *   `POST /api/analyses/[id]/rejouer`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { TYPES_ANALYSE, STATUTS_ANALYSE } from '@/lib/analyses/types';
import type { AnalyseEnregistree, TypeAnalyse, StatutAnalyse } from '@/lib/analyses/types';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';

/** Une page de la liste au maximum — Nano, pas de scan/liste illimités. */
const LIMITE_LISTE = 50;

const QuerySchema = z.object({
  type: z.enum(TYPES_ANALYSE).optional(),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const { type } = parsed.data;

  const supabase = createAdminClient();
  let requete = supabase
    .from('analyses')
    .select('id, type, nom, maillage, statut, created_at, updated_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_LISTE);

  if (type) requete = requete.eq('type', type);

  const { data, error } = await requete;
  if (error) {
    console.error('[GET /api/analyses]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  // Colonnes générées en `string` par le générateur Supabase (CHECK non vu) —
  // resserrées ici en unions littérales, source de vérité `lib/analyses/types.ts`.
  type AnalyseResume = Pick<AnalyseEnregistree, 'id' | 'type' | 'nom' | 'maillage' | 'statut' | 'created_at' | 'updated_at'>;
  return NextResponse.json(
    { analyses: (data ?? []) as AnalyseResume[] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const EnregistrerSchema = z.object({
  type: z.enum(TYPES_ANALYSE),
  nom: z.string().min(1),
  parametres: z.record(z.unknown()),
  maillage: z.string().min(1).optional(),
  perimetre: z.record(z.unknown()).optional(),
  resultat: z.record(z.unknown()).optional(),
  statut: z.enum(STATUTS_ANALYSE).optional(),
  erreur: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const corps = await lireCorps(request, EnregistrerSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { nom, parametres, maillage, perimetre, resultat, erreur } = corps.valeur;
  const type: TypeAnalyse = corps.valeur.type;
  const statut: StatutAnalyse = corps.valeur.statut ?? 'termine';

  const supabase = createAdminClient();

  const ligne: TableInsert<'analyses'> = {
    org_id: orgId,
    created_by: profile.id,
    type,
    nom,
    parametres: toJson(parametres),
    maillage: maillage ?? null,
    perimetre: perimetre ? toJson(perimetre) : null,
    resultat: resultat ? toJson(resultat) : null,
    statut,
    erreur: erreur ?? null,
  };

  const { data, error } = await supabase.from('analyses').insert(ligne).select().single();
  if (error) {
    console.error('[POST /api/analyses]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  return NextResponse.json({ analyse: data as AnalyseEnregistree }, { status: 201 });
}
