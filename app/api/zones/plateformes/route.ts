/**
 * GET /api/zones/plateformes — le registre `plateformes_geo` (sql/274, lot 5, T2) : ce que chaque plateforme achète
 * comme maille, ses limites, sa doc officielle, la date du relevé et ce qui reste « à vérifier ». Lu par ⑤ à la
 * première ouverture du sélecteur, une fois par page.
 *
 * Ordre : session (401 / 403, rien en base) → UNE lecture de table par `lireRegles` (la lecture commune du serveur) :
 * triée par `ordre`, bornée à `MAX_PLATEFORMES_GEO + 1` lignes (au-delà : 500 dit, jamais une liste coupée), chaque
 * ligne passée au schéma.
 * B9 (ARB-7) : puis les deux réglages de la maille par défaut (`reglages_conversion`, sql/315 : couverture cible,
 * écart de départage) par `lireReglagesDefaut`, rendus sous `reglages_defaut` — qui ne fait jamais échouer la route
 * (repli `REGLAGES_DEFAUT_REPLI`, dit au journal).
 * Pas de quota : une lecture de ≤ 24 lignes et une de 2, gardées 5 minutes par le navigateur
 * (`private` : réservée à un utilisateur connecté). La table n'appartient à aucun espace ; l'espace actif n'est exigé
 * que par cohérence avec les autres routes de ⑤.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth } from '@/lib/api/middleware';
import { espaceDeZone } from '@/lib/zones/session-zones';
import type { PlateformeGeo } from '@/lib/zones/plateformes';
import { lireRegles, lireReglagesDefaut } from '@/lib/zones/conversion-serveur';

export const dynamic = 'force-dynamic';

const ECHEC = 'Lecture des règles des plateformes impossible.';

function echec(contexte: string, detail: unknown): NextResponse {
  console.error(`[zones/plateformes] ${contexte}`, detail);
  return NextResponse.json({ error: ECHEC }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const s = espaceDeZone(await requireAuth(req));
  if (!s.ok) return s.reponse;

  const supabase = createAdminClient();
  let plateformes: PlateformeGeo[];
  try {
    plateformes = await lireRegles(supabase);
  } catch (e) {
    // Erreur Postgres, borne dépassée ou ligne hors schéma : le détail reste dans le journal.
    return echec('lecture', e);
  }
  const reglages_defaut = await lireReglagesDefaut(supabase);
  return NextResponse.json({ plateformes, reglages_defaut }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
