/**
 * GET / PUT /api/campaigns/[campaignId]/optimisation/algo — l'algorithme de correction de la campagne (tâche 2.7,
 * plan § 16.2), passerelle vers `GET` / `PUT /v1/campagnes/{id}/algo` du service Python.
 *
 * - Un seul algorithme de correction actif par campagne ; défaut « uniformiser au global » (le service le dit quand
 *   aucune ligne n'existe). Changeable EN COURS de campagne (décision du propriétaire du 05/11) : l'effet est au cycle
 *   suivant, rien n'est recalculé ici. Chaque changement est tracé par le service dans `optimisation_reglages_journal`.
 * - Droits (`lib/optimisation/droit-algo.ts`) : lire = quiconque accède à la campagne ; régler = super_admin ou membre
 *   de l'espace propriétaire. Autre espace → 404 (jamais 403, comme toutes les routes de campagne) ; espace avec qui la
 *   campagne est seulement partagée → 403 en écriture.
 * - Next vérifie le droit ; Python vérifie le CHOIX et répond 422 en français, relayé tel quel : algorithme inconnu
 *   (`algo_inconnu`), réservé au simulateur (`algo_non_proposable`), d'une autre famille (`algo_autre_famille`),
 *   paramètre inconnu ou hors bornes (`parametre_invalide`). Next ne garde AUCUNE copie du catalogue.
 * - Le corps est un REMPLACEMENT : `{ algo_id, parametres? }`, `parametres` = surcharges complètes (absent = défauts).
 *
 * Session : le middleware a validé le JWT (getSession, local) ; `requireAuth` rend le profil. Défaillance du service :
 * 503 / 504 / 502 selon le motif, jamais masquée.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import {
  ErreurOptimisation, lireAlgoCampagne, reglerAlgoCampagne, type MotifErreur,
} from '@/lib/optimisation/client';
import { lireDroitAlgo } from '@/lib/optimisation/droit-algo';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

/**
 * La forme seulement : les noms d'algorithme et de paramètres, leurs bornes, vivent dans le catalogue du service.
 * `.strict()` : une clé inconnue est refusée, pas retirée en silence (le service la refuserait de toute façon).
 */
const CorpsSchema = z.object({
  algo_id: z.string().min(1).max(64),
  parametres: z.record(z.string().min(1).max(64), z.number().finite()).optional(),
}).strict();

const STATUT_PAR_MOTIF: Record<MotifErreur, number> = {
  configuration: 503,
  reseau: 503,
  indisponible: 503,
  delai: 504,
  refus: 502,
  serveur: 502,
  reponse: 502,
};

const INTROUVABLE = { error: 'Campagne introuvable.' };

function erreurService(e: unknown): NextResponse {
  if (!(e instanceof ErreurOptimisation)) throw e;
  // 404 du service : la campagne n'appartient pas à l'espace transmis — rendu comme notre propre 404.
  if (e.statut === 404) return NextResponse.json(INTROUVABLE, { status: 404 });
  // 422 du service : le choix est refusé ; message français et code stable relayés.
  if (e.statut === 422) return NextResponse.json({ error: e.refus ?? 'refus', message: e.message }, { status: 422 });
  return NextResponse.json({ error: e.message, motif: e.motif }, { status: STATUT_PAR_MOTIF[e.motif] });
}

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
  if (droit.acces === 'introuvable') return NextResponse.json(INTROUVABLE, { status: 404 });

  try {
    const lu = await lireAlgoCampagne(campaignId, droit.espace);
    return NextResponse.json({ ...lu, peut_regler: droit.acces === 'reglage' });
  } catch (e) {
    return erreurService(e);
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

  const droit = await lireDroitAlgo(createAdminClient(), profile, campaignId);
  if (droit.acces === 'introuvable') return NextResponse.json(INTROUVABLE, { status: 404 });
  if (droit.acces !== 'reglage') {
    return NextResponse.json({
      error: 'droit_insuffisant',
      message: "Seul l'espace propriétaire de la campagne (ou un super-administrateur) peut changer son algorithme.",
    }, { status: 403 });
  }

  try {
    const r = await reglerAlgoCampagne(
      campaignId,
      { algo_id: corps.valeur.algo_id, parametres: corps.valeur.parametres ?? {} },
      { espace: droit.espace, utilisateur: profile.id, role: droit.role },
    );
    return NextResponse.json(r);
  } catch (e) {
    return erreurService(e);
  }
}
