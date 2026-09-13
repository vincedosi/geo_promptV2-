/**
 * GET /api/campaigns/[campaignId]/activation/historique — ce qui a été poussé, et quand
 *
 * Tâche 20 (2026-09-13). Le push DV360 existait mais **nu** : aucune trace de
 * ce qui était parti, vers quels line items, avec quel résultat. Un push raté à
 * moitié était donc indiscernable d'un push réussi.
 *
 * Borné à 50 lots — c'est un historique consulté, pas un journal exhaustif, et
 * une liste illimitée est interdite (CLAUDE.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();
const LIMITE_LOTS = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  const { data: lots, error } = await supabase
    .from('activation_lots')
    .select('id, canal, version_strategie, statut, lance_le, termine_le, lance_par')
    .eq('campaign_id', campaignId)
    .order('lance_le', { ascending: false })
    .limit(LIMITE_LOTS);
  if (error) {
    console.error('[activation/historique] lots:', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  if (!lots?.length) {
    return NextResponse.json({ lots: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Compteurs par lot en UNE requête, jamais une par lot : trois COUNT par
  // campagne ont déjà provoqué un timeout et une boucle infinie côté client
  // (CLAUDE.md, incident du 08/04).
  const { data: cibles, error: erreurCibles } = await supabase
    .from('activation_cibles')
    .select('lot_id, statut')
    .in('lot_id', lots.map((l) => l.id));
  if (erreurCibles) console.error('[activation/historique] cibles:', erreurCibles.message);

  const compteurs = new Map<string, Record<string, number>>();
  for (const c of cibles ?? []) {
    const par = compteurs.get(c.lot_id) ?? {};
    par[c.statut] = (par[c.statut] ?? 0) + 1;
    compteurs.set(c.lot_id, par);
  }

  return NextResponse.json(
    {
      lots: lots.map((l) => ({
        ...l,
        cibles: compteurs.get(l.id) ?? {},
        n_cibles: Object.values(compteurs.get(l.id) ?? {}).reduce((a, b) => a + b, 0),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
