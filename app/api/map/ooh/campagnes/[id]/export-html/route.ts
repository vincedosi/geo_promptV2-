/**
 * GET /api/map/ooh/campagnes/[id]/export-html — la campagne OOH de l'espace ACTIF en UN fichier HTML autonome, à
 * envoyer au client sans accès à l'application (bible des priorités, ligne 30 ; TF4 Marine). Le document est construit
 * par `genererExportHtml` (`lib/ooh/export-html.ts`) et rendu en pièce jointe (`Content-Disposition: attachment`,
 * nom dérivé du nom de la campagne, sans accents ni espaces).
 *
 * Lecture IDENTIQUE à `GET /api/map/ooh/campagnes/[id]` : une RPC `jsonb` (`campagne_ooh_jsonb`, sql/263), donc aucune
 * troncature PostgREST (TF4 ≈ 1 253 points, au-delà des 1 000 lignes d'une RPC tabulaire) ; borne écrite
 * `BORNE_EMPLACEMENTS` = 20 000, au-delà la RPC rend `tronque` et le document le dit.
 *
 * 400 si l'identifiant n'est pas un UUID (aucune lecture) ; 404 si la campagne n'est pas dans l'espace actif — la RPC
 * rend `null` — ou sans espace actif ; 500 en français, détail au journal seulement. Les erreurs restent en JSON : le
 * bouton Angular (`mg-bouton-export`) lit leur champ `error`.
 *
 * Sécurité : la RPC tourne en service_role et fait confiance à `p_org`. Il vient UNIQUEMENT de la session
 * (`orgIdActif`, sur `getSessionOrg`), jamais de la query string, du chemin ou d'un corps ; seul `id` (chemin) est lu,
 * et validé. Protégée par le préfixe `/api/map/ooh` du middleware (`middleware.ts` inchangé). Le fichier rendu ne
 * porte aucun identifiant interne (voir l'en-tête de `lib/ooh/export-html.ts`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { orgIdActif } from '@/lib/auth/getSessionOrg';
import { genererExportHtml, nomFichierExport } from '@/lib/ooh/export-html';
import type { CampagneOohLue } from '@/types/campagne-ooh';

export const dynamic = 'force-dynamic';

/** La borne de la route `[id]` : TF4 en porte ≈ 1 253 ; RPC jsonb, `p_limite + 1` lus et `tronque`. */
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
    console.error('[map/ooh/campagnes/[id]/export-html] lecture :', error.message);
    return NextResponse.json({ error: 'Export de la campagne impossible.' }, { status: 500 });
  }
  if (data === null) return NextResponse.json({ error: 'Campagne introuvable dans cet espace de travail.' }, { status: 404 });

  const campagne = data as unknown as CampagneOohLue;
  const html = genererExportHtml(campagne, { exporteLe: new Date() });
  const nom = nomFichierExport(campagne.campagne.nom);
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nom}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
