/**
 * GET / PUT /api/campaigns/[campaignId]/optimisation/reglages — seuils d'alerte et corrections de données de la
 * campagne (relecture de la phase 2, I3), passerelle vers `GET` / `PUT /v1/campagnes/{id}/reglages` du service Python.
 *
 * C'est l'interrupteur des corrections livrées éteintes par les tâches 2.1-2.3 :
 *  - `tableaux_depuis_plan` (tableaux par CP depuis le plan, codes jamais servis compris, sql/346) ;
 *  - `univers_methode_a` (`fige` | `referentiel`, plan méthode A sur le référentiel complet) ;
 *  - `seuils` : rythme 0,85 / 0,70 / 1,15 / 1,30, CPM × 1,25, CP sous 70 %, fuite 5 %, constats ± 20 %.
 * Défaut = comportement d'avant tant que personne ne règle la campagne.
 *
 * - Droits : ceux de l'algorithme (`lib/optimisation/droit-algo.ts`) — lire = accès à la campagne ; régler =
 *   super_admin ou membre de l'espace propriétaire ; espace seulement partagé → 403 ; autre espace → 404.
 * - Le corps `{ parametres }` REMPLACE le réglage (clé absente = défaut). Next ne valide que la forme (un objet) ; le
 *   service refuse en 422 français une clé inconnue, un nombre en texte, une borne dépassée (pourcentages ≤ 100,
 *   rythmes et facteur de CPM ≤ 10), un ordre de rythmes incohérent — relayé tel quel.
 * - Chaque changement est tracé par le service dans `optimisation_reglages_journal` (`nature = 'reglages'`).
 * - Si `tableaux_depuis_plan` change, les tableaux par CP sont RECONSTRUITS ici (`refresh_campaign_rollups`, qui lit
 *   le réglage — le rôle du service n'a pas ce droit). Coût : celui d'un import (une campagne, mesuré 0,6 s sur la
 *   démo, 10 205 lignes). Un échec de reconstruction ne défait pas le réglage : il est rendu dans `reconstruction`.
 *
 * Session : le middleware a validé le JWT (getSession, local) ; `requireAuth` rend le profil.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { lireReglagesCampagne, reglerReglagesCampagne } from '@/lib/optimisation/client';
import { lireDroitAlgo } from '@/lib/optimisation/droit-algo';
import { CAMPAGNE_INTROUVABLE, reponseErreurOptimisation } from '@/lib/optimisation/reponse-erreur';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

/** La forme seulement : les clés, types et bornes vivent dans le service (Pydantic) et en base (CHECK). */
const CorpsSchema = z.object({
  parametres: z.record(z.string().min(1).max(64), z.unknown()),
}).strict();

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

  const droit = await lireDroitAlgo(createAdminClient(), profile, campaignId);
  if (droit.acces === 'introuvable') return NextResponse.json(CAMPAGNE_INTROUVABLE, { status: 404 });

  try {
    const lu = await lireReglagesCampagne(campaignId, droit.espace);
    return NextResponse.json({ ...lu, peut_regler: droit.acces === 'reglage' });
  } catch (e) {
    return reponseErreurOptimisation(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const supabase = createAdminClient();
  const droit = await lireDroitAlgo(supabase, profile, campaignId);
  if (droit.acces === 'introuvable') return NextResponse.json(CAMPAGNE_INTROUVABLE, { status: 404 });
  if (droit.acces !== 'reglage') {
    return NextResponse.json({
      error: 'droit_insuffisant',
      message: "Seul l'espace propriétaire de la campagne (ou un super-administrateur) peut changer ses réglages.",
    }, { status: 403 });
  }

  let r;
  try {
    r = await reglerReglagesCampagne(
      campaignId, corps.valeur.parametres, { espace: droit.espace, utilisateur: profile.id, role: droit.role },
    );
  } catch (e) {
    return reponseErreurOptimisation(e);
  }

  let reconstruction: { ok: true; cp_rows: number; cp_non_servis: number } | { ok: false; message: string } | null = null;
  if (r.tableaux_a_reconstruire) {
    const { data, error } = await supabase.rpc('refresh_campaign_rollups', { p_campaign_id: campaignId });
    if (error) {
      // Message Postgres journalisé, jamais renvoyé (forme des tables).
      console.error('[optimisation/reglages] refresh_campaign_rollups:', error.message);
      reconstruction = { ok: false, message: 'Réglage enregistré, mais les tableaux par code postal n’ont pas pu être reconstruits.' };
    } else {
      const sortie = rpcJson<{ cp_rows?: number; cp_non_servis?: number }>(data);
      reconstruction = { ok: true, cp_rows: sortie?.cp_rows ?? 0, cp_non_servis: sortie?.cp_non_servis ?? 0 };
    }
  }

  return NextResponse.json({ ...r, reconstruction });
}
