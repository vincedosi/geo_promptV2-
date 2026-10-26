/**
 * MAGELIAN — POST /api/admin/dsp/dv360/targeting/push
 * Pousse le ciblage géo d'une zone custom (codes postaux → geo IDs Google)
 * sur un line item DV360 via bulkEditAssignedTargetingOptions.
 *
 * Additif : n'efface pas le ciblage géo existant du line item.
 * Renvoie 403/502 tant que le compte connecté n'a pas de droits DV360
 * (blocage droits Google en cours — voir /admin/api/dv360).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { pousserCiblageDv360 } from '@/lib/dsp/dv360/pousser-ciblage';
import { lireCodesDeZone } from '@/lib/custom-geo/codes-zone';

export const dynamic = 'force-dynamic';

const PushSchema = z.object({
  zone_id: z.string().uuid(),
  advertiser_id: z.string().regex(/^\d+$/),
  line_item_id: z.string().regex(/^\d+$/),
});

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = PushSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { zone_id, advertiser_id, line_item_id } = parsed.data;

  const supabase = createAdminClient();

  // La zone doit appartenir à l'org du demandeur (client admin = pas de RLS).
  const { data: zone, error: zoneErr } = await supabase
    .from('custom_geo_zones')
    .select('id, name, org_id')
    .eq('id', zone_id)
    .single();
  if (zoneErr || !zone || zone.org_id !== orgId) {
    return NextResponse.json({ error: 'Zone introuvable.' }, { status: 404 });
  }

  // Lecture paginée : PostgREST coupe une table à 1 000 lignes (`db-max-rows`),
  // l'ancien `.limit(100000)` poussait 1 000 CP d'une zone de 1 641 sans
  // erreur (lib/custom-geo/codes-zone.ts).
  let cps: string[];
  try {
    cps = await lireCodesDeZone(supabase, zone_id, 'cp');
  } catch (e) {
    console.error('[dv360/targeting/push] codes', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Connexion, mapping, plafond, appel Google et journal : `lib/dsp/dv360/pousser-ciblage.ts` (lot 7, A-2), partagé
  // avec la poussée d'une campagne. Toujours en réel ici : cette route ne connaît pas de campagne de démo.
  const issue = await pousserCiblageDv360({
    supabase, orgId, cps, advertiserId: advertiser_id, lineItemId: line_item_id,
    libelle: `zone « ${zone.name} »`, mode: 'reel', detail: { zone_id },
  });
  if (!issue.ok) return NextResponse.json({ error: issue.error }, { status: issue.status });
  return NextResponse.json(issue);
}
