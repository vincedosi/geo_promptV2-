import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkZoneAccess } from '@/lib/campaigns/access';
import { lireTout } from '@/lib/supabase/lire-tout';
import { refusZoneSansCodes } from '@/lib/zones/couverture';

export const dynamic = 'force-dynamic';

/** Borne de lecture des codes rattachés aux sous-zones (zone France entière : ~50 000 IRIS). */
const PLAFOND_CODES_SOUS_ZONES = 60_000;

// GET — detail (sans géométrie) + sous-zones natives + counts par sous-zone
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('custom_geo_zones')
    .select('id, name, description, org_id, source_type, source_metadata, feature_count_iris, feature_count_cp, resolved_at, created_at, updated_at, created_by, audience_stats, audience_computed_at, recette')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  }
  // Une zone pays n'a pas de codes (sql/296) : « 0 code » se lirait comme une zone vide. La recette n'est lue que pour
  // ce refus : la réponse garde ses clés d'avant.
  const { recette, ...zone } = data;
  // C21 round 1 (I-1) : une zone nationale moins zones locales non plus (sql/326) — jamais une liste vide sans le dire.
  const refusPays = await refusZoneSansCodes(supabase, id, zone.org_id, recette);
  if (refusPays) return refusPays;

  // bbox : PostGIS geometry → tableau [minLng, minLat, maxLng, maxLat] propre
  // (le client en a besoin pour fitBounds MapLibre).
  const { data: bboxRow } = await supabase.rpc('get_zone_bbox_array', { p_zone_id: id });
  const bbox = (bboxRow ?? null) as [number, number, number, number] | null;

  // Sous-zones natives + count des CPs/IRIS rattachés (1 query agrégée).
  // Le wizard Custom Bidding utilise ces données pour proposer une pondération
  // par sous-zone sans demander à l'utilisateur de saisir les CPs.
  const { data: subzonesRaw, error: szErr } = await supabase
    .from('custom_geo_zone_subzones')
    .select('id, name, source_ref, ordering, default_multiplier')
    .eq('zone_id', id)
    .order('ordering', { ascending: true });

  let subzones: Array<{
    id: string;
    name: string;
    source_ref: string | null;
    ordering: number;
    default_multiplier: number;
    cp_count: number;
    iris_count: number;
  }> = [];

  if (!szErr && subzonesRaw && subzonesRaw.length > 0) {
    // Counts par sous-zone. Lecture PAGINÉE : une requête de table est coupée
    // à 1 000 lignes (`db-max-rows`) ; une zone porte 9 834 IRIS, et les
    // comptes s'arrêtaient à 1 000 sans erreur (mesuré le 2026-10-10).
    // Ordre sur la clé primaire (zone_id, code_type, code) : pages disjointes.
    let counts: Array<{ subzone_id: string | null; code_type: string }> | null = null;
    try {
      ({ lignes: counts } = await lireTout<{ subzone_id: string | null; code_type: string }>(
        (de, a) => supabase
          .from('custom_geo_zone_codes')
          .select('subzone_id, code_type')
          .eq('zone_id', id)
          .not('subzone_id', 'is', null)
          .order('code_type')
          .order('code')
          .range(de, a),
        PLAFOND_CODES_SOUS_ZONES,
      ));
    } catch (e) {
      // Même conduite qu'avant sur erreur : sous-zones rendues sans compte.
      console.error('[custom-geo/[id]] comptes sous-zones', e instanceof Error ? e.message : String(e));
    }

    const cntMap = new Map<string, { cp: number; iris: number }>();
    if (counts) {
      for (const row of counts) {
        if (!row.subzone_id) continue; // exclu par le filtre, typé nullable par la table
        const cur = cntMap.get(row.subzone_id) ?? { cp: 0, iris: 0 };
        if (row.code_type === 'cp') cur.cp++;
        else if (row.code_type === 'iris') cur.iris++;
        cntMap.set(row.subzone_id, cur);
      }
    }
    subzones = subzonesRaw.map(sz => {
      const c = cntMap.get(sz.id) ?? { cp: 0, iris: 0 };
      return {
        id: sz.id,
        name: sz.name,
        source_ref: sz.source_ref,
        ordering: sz.ordering,
        default_multiplier: Number(sz.default_multiplier),
        cp_count: c.cp,
        iris_count: c.iris,
      };
    });
  }

  return NextResponse.json({ ...zone, bbox, subzones });
}

// PATCH — update name/description only
const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { error } = await supabase
    .from('custom_geo_zones')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error('[custom-geo/patch]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ updated: true, id });
}

// DELETE
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  // Garde-fou : interdit de supprimer une zone CITÉE. `zone_referencee` (sql/253) couvre la stratégie de bidding, le
  // jeu de zones, la composite React (`source_metadata.member_zone_ids`), la combinaison à recette (`recette.zones`)
  // et le périmètre d'une recette (`recette.perimetre`). Jusqu'au 2026-10-15, seuls la stratégie et
  // `member_zone_ids` étaient lus : un membre d'une combinaison Angular se supprimait et cassait son recalcul.
  // `par` est un code, jamais montré tel quel ; une garde en échec ne supprime rien.
  const ref = await supabase.rpc('zone_referencee', { p_zone_id: id });
  if (ref.error) {
    console.error('[custom-geo/delete] zone_referencee :', ref.error.message);
    return NextResponse.json({ error: 'Vérification des usages de la zone impossible.' }, { status: 500 });
  }
  if (typeof ref.data === 'string' && ref.data !== '') {
    return NextResponse.json({
      error: 'Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être supprimée.',
      refus: 'zone_referencee',
      par: ref.data,
    }, { status: 409 });
  }

  const { error } = await supabase
    .from('custom_geo_zones')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[custom-geo/delete]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, id });
}
