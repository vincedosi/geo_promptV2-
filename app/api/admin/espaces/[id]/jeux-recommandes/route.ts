/**
 * GET /api/admin/espaces/[id]/jeux-recommandes — les jeux communs recommandables de l'espace, chacun avec
 *     `recommande` : `{ jeux: JeuRecommandable[] }` (référentiels du registre, puis types de POI du socle).
 * PUT /api/admin/espaces/[id]/jeux-recommandes — remplace la sélection. Corps `{ cles: string[] }` (≤ 200 clés,
 *     chacune un référentiel du registre ou un type de POI du SOCLE) → `{ cles: string[] }` triées.
 *
 * super_admin seul (403 sinon, `adminUnauthorized`). 400 : identifiant, corps illisible, clé inconnue — un type de POI
 * absent des données communes est refusé ici, `estCleJeuConnue` ne vérifiant que la forme. 404 : espace inexistant.
 * 500 : message français fixe, le détail Postgres va en console serveur seulement.
 *
 * L'écriture passe par la RPC `remplacer_jeux_recommandes` (sql/251) : une transaction, jamais un DELETE suivi d'un
 * INSERT côté route. Une recommandation RANGE ; elle ne donne ni ne retire aucun droit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { adminUnauthorized, requireAdmin } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { MAX_JEUX_RECOMMANDES, RE_CLE_JEU, estCleJeuConnue } from '@/lib/carte/jeux-carte';
import { clesPoiInconnues, jeuxRecommandables } from '@/lib/carte/jeux-recommandables';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();
const CorpsSchema = z.object({
  cles: z.array(
    z.string().regex(RE_CLE_JEU, 'Clé de jeu invalide.').refine(estCleJeuConnue, 'Jeu inconnu de la carte.'),
  ).max(MAX_JEUX_RECOMMANDES, `Au plus ${MAX_JEUX_RECOMMANDES} jeux recommandés.`),
});

type Params = { params: Promise<{ id: string }> };

const ID_INVALIDE = 'Identifiant d\'espace invalide.';
const INTROUVABLE = 'Espace introuvable.';

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin(request))) return adminUnauthorized();
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: ID_INVALIDE }, { status: 400 });
  try {
    const reponse = await jeuxRecommandables(createAdminClient(), id);
    if (!reponse) return NextResponse.json({ error: INTROUVABLE }, { status: 404 });
    return NextResponse.json(reponse);
  } catch (e) {
    console.error('[admin/espaces/jeux-recommandes] lecture :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Sélection recommandée indisponible.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin(request))) return adminUnauthorized();
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: ID_INVALIDE }, { status: 400 });
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { cles } = corps.valeur;

  const supabase = createAdminClient();
  try {
    const { data: org, error: eOrg } = await supabase.from('organizations').select('id').eq('id', id).maybeSingle();
    if (eOrg) throw new Error(`lecture de l'espace : ${eOrg.message}`);
    if (!org) return NextResponse.json({ error: INTROUVABLE }, { status: 404 });

    const inconnues = await clesPoiInconnues(cles);
    if (inconnues.length > 0) {
      return NextResponse.json(
        { error: `Type de POI absent des données communes : ${inconnues.join(', ')}.` }, { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc('remplacer_jeux_recommandes', { p_organization_id: id, p_cles: cles });
    if (error) throw new Error(`remplacer_jeux_recommandes : ${error.message}`);
    return NextResponse.json(data as { cles: string[] });
  } catch (e) {
    console.error('[admin/espaces/jeux-recommandes] écriture :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Enregistrement de la sélection impossible.' }, { status: 500 });
  }
}
