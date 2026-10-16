/**
 * GET /api/map/ooh/campagnes/[id] — une campagne OOH de l'espace ACTIF, ses lignes et ses emplacements en GeoJSON
 * (spec 2026-10-16-ooh-campagnes § 5) : la sortie de `campagne_ooh_jsonb` (sql/263).
 *
 * 400 si l'identifiant n'est pas un UUID (aucune lecture) ; 404 si la campagne n'est pas dans l'espace actif — la RPC
 * rend `null` — ou s'il n'y a pas d'espace actif ; 500 avec un message français, détail au journal seulement.
 * Borne : 20 000 emplacements (TF4 en porte ≈ 1 230) ; la RPC est `jsonb`, elle lit `p_limite + 1` et rend `tronque`.
 *
 * Sécurité : la RPC tourne en service_role et fait confiance à `p_org`. Il vient UNIQUEMENT de la session
 * (`orgIdActif`, sur `getSessionOrg`), jamais de la query string, du chemin ou d'un corps ; seul `id` (chemin) est lu, et validé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { orgIdActif } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

const BORNE_EMPLACEMENTS = 20_000;

const Parametres = z.object({ id: z.string().uuid() });
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = Parametres.safeParse(await params);
  if (!p.success) return NextResponse.json({ error: 'Identifiant de campagne invalide.' }, { status: 400 });

  const orgId = await orgIdActif(req);
  if (!orgId) return NextResponse.json({ error: 'Campagne introuvable dans cet espace de travail.' }, { status: 404 });

  const { data, error } = await createAdminClient().rpc('campagne_ooh_jsonb', {
    p_campagne: p.data.id, p_org: orgId, p_limite: BORNE_EMPLACEMENTS,
  });
  if (error) {
    console.error('[map/ooh/campagnes/[id]] lecture :', error.message);
    return NextResponse.json({ error: 'Campagne OOH indisponible.' }, { status: 500 });
  }
  if (data === null) return NextResponse.json({ error: 'Campagne introuvable dans cet espace de travail.' }, { status: 404 });
  return NextResponse.json(data);
}
