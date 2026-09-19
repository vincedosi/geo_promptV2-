/**
 * POST /api/bidding/strategies/[id]/publier — fige l'état d'une stratégie
 * GET  /api/bidding/strategies/[id]/publier — dit si elle a dérivé depuis
 *
 * Tâche 19 (2026-09-13).
 *
 * ── Le problème ───────────────────────────────────────────────────────────
 * Une stratégie publiée est FIGÉE : ses enchères sont parties au DSP avec une
 * liste de codes postaux issue de zones, à un instant donné. Si l'une de ces
 * zones est modifiée ensuite — et le lot Zones vient justement d'ajouter cinq
 * façons de les modifier — la campagne en vol diffuse sur un périmètre qui
 * n'est plus celui qu'affiche la carte. **Rien ne le signalait.**
 *
 * D'où l'empreinte de CONTENU prise à la publication : `{ zone_id: hachage }`,
 * où le hachage porte sur la géométrie ET sur les comptes de CP/IRIS résolus
 * (`empreinte_zones`, sql/159). Le GET la compare à l'état courant et rend les
 * zones qui ont bougé ; la comparaison vit dans
 * `lib/campaigns/version-strategie.ts`, testée sans base.
 *
 * **Ce n'était PAS `updated_at`, et le corriger a compté** : renommer une zone
 * — seul UPDATE que `PATCH /api/custom-geo/[id]` autorise — bougeait la date et
 * bloquait l'activation pour un geste purement cosmétique, tandis que la vraie
 * dérive (une géométrie qui change) n'était atteignable par aucun chemin.
 *
 * ── Ce que cette route ne fait PAS ────────────────────────────────────────
 * Elle ne pousse rien vers un DSP et ne modifie pas la stratégie. Publier, ici,
 * c'est **enregistrer un point de repère** — l'état exact qui a été validé, et
 * auquel on pourra comparer. Le push reste le geste séparé qu'il était.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { zonesModifiees, type EmpreinteZones } from '@/lib/campaigns/version-strategie';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

/** Corps vide accepté : publier ne demande aucun paramètre. */
const CorpsSchema = z.object({});

/**
 * Charge la stratégie, vérifie l'accès par sa campagne, et rend l'empreinte
 * COURANTE de ses zones.
 *
 * Une stratégie référence ses zones de deux façons : `zone_id` (périmètre
 * `custom_zone`) et les sous-zones de `bidding_strategy_subzones`. Les
 * secondes ne portent pas d'uuid de zone custom — ce sont des listes de codes
 * postaux figées à la création, donc déjà insensibles à une modification de
 * zone. Seul `zone_id` peut dériver, et c'est lui qu'on empreinte.
 */
async function chargerContexte(
  supabase: ReturnType<typeof createAdminClient>,
  profile: { id: string; role: string; organization_id: string | null },
  strategieId: string,
) {
  const { data: strategie, error } = await supabase
    .from('bidding_strategies')
    .select('id, name, campaign_id, zone_id, scope_type, status, in_zone_weights, out_zone_weights, updated_at')
    .eq('id', strategieId)
    .maybeSingle();

  if (error) return { erreur: 'db' as const, message: error.message };
  if (!strategie) return { erreur: 'introuvable' as const };

  // Le cloisonnement passe par la CAMPAGNE : une stratégie n'a pas d'org_id
  // propre. 404 et jamais 403 — contrat de `lib/campaigns/access.ts`, pour ne
  // pas divulguer l'existence d'une stratégie à une autre organisation.
  //
  // Écrit de façon à échouer FERMÉ. La forme précédente était
  // `if (strategie.campaign_id) { …contrôle… }` : `campaign_id` est `NOT NULL`
  // en base aujourd'hui, donc le garde était toujours pris et il n'y avait pas
  // d'IDOR — mais le jour où la colonne deviendrait nullable, la route
  // serait devenue publique EN SILENCE. Une stratégie sans campagne n'est
  // rattachable à aucune organisation : elle est donc introuvable, point.
  if (!strategie.campaign_id) return { erreur: 'introuvable' as const };
  const acces = await checkCampaignAccess(supabase, profile, strategie.campaign_id);
  if (acces !== 'ok') return { erreur: 'introuvable' as const };

  // L'empreinte porte sur le CONTENU de la zone (hachage de la géométrie plus
  // les comptes de CP/IRIS résolus), pas sur son `updated_at` — corrigé après
  // relecture. `updated_at` produisait deux défauts opposés : un simple
  // RENOMMAGE, seul UPDATE que `PATCH /api/custom-geo/[id]` autorise, bougeait
  // la date et bloquait l'activation ; et comme aucun chemin applicatif ne
  // modifie la géométrie d'une zone existante, la dérive que cette
  // fonctionnalité prétend détecter n'était atteignable par rien.
  //
  // Une zone SUPPRIMÉE depuis la publication n'apparaît pas dans le résultat :
  // `zonesModifiees` la signalera comme retirée, ce qui est le bon message —
  // la stratégie cible un périmètre qui n'existe plus.
  let empreinte: EmpreinteZones = {};
  if (strategie.zone_id) {
    const { data, error: erreurEmpreinte } = await supabase.rpc('empreinte_zones', {
      p_zone_ids: [strategie.zone_id],
    });
    if (erreurEmpreinte) return { erreur: 'db' as const, message: erreurEmpreinte.message };
    empreinte = (rpcJson<EmpreinteZones>(data) ?? {});
  }

  return { strategie, empreinte };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const ctx = await chargerContexte(supabase, profile, id);
  if ('erreur' in ctx) {
    if (ctx.erreur === 'db') {
      console.error('[GET publier]', ctx.message);
      return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Stratégie introuvable.' }, { status: 404 });
  }

  const { data: derniere, error: erreurVersion } = await supabase
    .from('strategie_versions')
    .select('id, version, publiee_le, publiee_par, empreinte_zones')
    .eq('strategie_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erreurVersion) {
    console.error('[GET publier] versions:', erreurVersion.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  if (!derniere) {
    return NextResponse.json(
      { publiee: false, version: null, zones_modifiees: [], a_derive: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const modifiees = zonesModifiees(
    (derniere.empreinte_zones ?? {}) as EmpreinteZones,
    ctx.empreinte,
  );

  return NextResponse.json(
    {
      publiee: true,
      version: derniere.version,
      publiee_le: derniere.publiee_le,
      zones_modifiees: modifiees,
      // Le booléen est dérivé de la liste, jamais stocké : un drapeau figé
      // mentirait dès la modification suivante.
      a_derive: modifiees.length > 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const corps = await lireCorps(request, CorpsSchema, { corpsAbsentTolere: true });
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const supabase = createAdminClient();
  const ctx = await chargerContexte(supabase, profile, id);
  if ('erreur' in ctx) {
    if (ctx.erreur === 'db') {
      console.error('[POST publier]', ctx.message);
      return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Stratégie introuvable.' }, { status: 404 });
  }

  // Le numéro de version est attribué EN BASE, sous `pg_advisory_xact_lock`
  // (sql/159). La première version de ce commentaire affirmait que l'attribuer
  // « dans la même instruction que l'insertion » suffisait à éviter la course —
  // c'était faux : un `INSERT … SELECT max(version)+1` sans verrou est
  // exactement aussi exposé qu'un `SELECT max` suivi d'un `INSERT`.
  //
  // La RPC est aussi IDEMPOTENTE : republier sans rien avoir changé rend la
  // version existante (`deja_publiee: true`) au lieu d'en créer une jumelle,
  // qui viderait de son sens le numéro affiché par le pré-vol.
  const { data, error } = await supabase.rpc('publier_strategie', {
    p_strategie_id: id,
    p_publiee_par: profile.id,
    p_empreinte: toJson(ctx.empreinte),
    p_charge_utile: toJson(ctx.strategie as unknown as Record<string, unknown>),
  });
  if (error) {
    console.error('[POST publier] rpc:', error.message);
    return NextResponse.json({ error: 'Publication impossible.' }, { status: 500 });
  }

  const version = rpcJson<{ id: string; version: number; publiee_le: string; n_zones: number }>(data);
  return NextResponse.json({ ...version, zones_modifiees: [], a_derive: false }, { status: 201 });
}
