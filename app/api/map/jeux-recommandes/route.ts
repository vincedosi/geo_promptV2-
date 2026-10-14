/**
 * GET /api/map/jeux-recommandes
 * La sélection recommandée de l'espace ACTIF pour l'étape ② de la carte : `{ cles: string[] }` (spec
 * carte-en-parcours § 7.2). Super_admin compris : la carte voit comme l'espace choisi. Sans session ni espace : `[]` —
 * rien n'est révélé, et ② montre alors toutes les données communes dépliées. Lecture bornée (≤ 200 lignes par espace,
 * sql/251 — sous le plafond PostgREST de 1 000).
 *
 * Route publique ASSUMÉE (tests/unit/api/routes-publiques.test.ts), comme `/api/map/categories` : un appelant sans
 * espace reçoit `[]` sans aucune lecture, et une clé de jeu n'est pas une donnée sensible.
 * La recommandation RANGE : elle n'ouvre aucun droit et ne précharge rien.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

const Uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  const session = await getSessionOrg(req);
  const orgId = session?.orgId && Uuid.safeParse(session.orgId).success ? session.orgId : null;
  if (!orgId) return NextResponse.json({ cles: [] });

  const { data, error } = await createAdminClient()
    .from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', orgId).order('cle_jeu');
  if (error) {
    console.error('[map/jeux-recommandes] lecture :', error.message);
    return NextResponse.json({ error: 'Sélection recommandée indisponible.' }, { status: 500 });
  }
  return NextResponse.json({ cles: (data ?? []).map((l: { cle_jeu: string }) => l.cle_jeu) });
}
