/**
 * GET /api/map/ooh/campagnes — les campagnes de l'espace ACTIF ayant au moins une ligne OOH, pour le sélecteur de
 * « Autres » → « Panneaux OOH et DOOH » (spec 2026-10-16-ooh-campagnes § 5, § 6) :
 * `{ campagnes: [{ id, nom, annonceur, vague, date_debut, date_fin, lignes: [{ id, ordre, media, regie, reseau,
 * territoire, nb_ecrans, nb_places, nb_non_places }] }], tronque }`.
 *
 * UNE RPC `jsonb` (`campagnes_ooh_jsonb`, sql/263) : aucune troncature PostgREST, borne écrite ci-dessous et `tronque`.
 * Sans espace actif (ou un espace qui n'est pas un UUID) : liste vide SANS lecture — rien n'est révélé.
 *
 * Sécurité : la RPC tourne en service_role (RLS contournée) et fait confiance à `p_org`. Il vient donc UNIQUEMENT de
 * la session (`getSessionOrg`) — jamais de la query string, du chemin ou d'un corps : aucun paramètre de l'appelant
 * n'est lu. Protégée par le middleware (préfixe `/api/map/ooh`, `middleware.ts` inchangé). Super_admin compris : la
 * carte voit comme l'espace choisi.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

/** Un espace a peu de campagnes (une par vague) : 200 suffit ; au-delà, la RPC le dit (`tronque`). */
const BORNE_CAMPAGNES = 200;

const Uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  const session = await getSessionOrg(req);
  const orgId = session?.orgId && Uuid.safeParse(session.orgId).success ? session.orgId : null;
  if (!orgId) return NextResponse.json({ campagnes: [], tronque: false });

  const { data, error } = await createAdminClient().rpc('campagnes_ooh_jsonb', { p_org: orgId, p_limite: BORNE_CAMPAGNES });
  if (error) {
    console.error('[map/ooh/campagnes] lecture :', error.message);
    return NextResponse.json({ error: 'Campagnes OOH indisponibles.' }, { status: 500 });
  }
  return NextResponse.json(data);
}
