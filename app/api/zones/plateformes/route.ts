/**
 * GET /api/zones/plateformes — le registre `plateformes_geo` (sql/274, lot 5, T2) : ce que chaque plateforme achète
 * comme maille, ses limites, sa doc officielle, la date du relevé et ce qui reste « à vérifier ». Lu par ⑤ à la
 * première ouverture du sélecteur, une fois par page.
 *
 * Ordre : session (401 / 403, rien en base) → UNE lecture de table, triée par `ordre`, bornée à
 * `MAX_PLATEFORMES_GEO + 1` lignes (au-delà : 500 dit, jamais une liste coupée) → chaque ligne passe le schéma.
 * Pas de quota : une lecture de ≤ 24 lignes, gardée 5 minutes par le navigateur
 * (`private` : réservée à un utilisateur connecté). La table n'appartient à aucun espace ; l'espace actif n'est exigé
 * que par cohérence avec les autres routes de ⑤.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { espaceDeZone } from '@/lib/zones/session-zones';
import { MAX_PLATEFORMES_GEO, PlateformeGeoSchema, type PlateformeGeo } from '@/lib/zones/plateformes';

export const dynamic = 'force-dynamic';

const ECHEC = 'Lecture des règles des plateformes impossible.';
const COLONNES = 'plateforme, maille, libelle, natif, disponible, limites, doc_url, releve_le, a_verifier, note, ordre';

function echec(contexte: string, detail: unknown): NextResponse {
  console.error(`[zones/plateformes] ${contexte}`, detail);
  return NextResponse.json({ error: ECHEC }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const { data, error } = await createAdminClient()
    .from('plateformes_geo')
    .select(COLONNES)
    .order('ordre', { ascending: true })
    .limit(MAX_PLATEFORMES_GEO + 1);
  if (error) return echec('lecture', error);
  const rows = data ?? [];
  if (rows.length > MAX_PLATEFORMES_GEO) return echec('borne dépassée', { lignes: rows.length });

  const lignes = z.array(PlateformeGeoSchema).safeParse(rows);
  if (!lignes.success) return echec('ligne refusée par le schéma', lignes.error.issues);

  const plateformes: PlateformeGeo[] = lignes.data;
  return NextResponse.json({ plateformes }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
