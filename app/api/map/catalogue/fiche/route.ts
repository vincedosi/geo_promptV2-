/**
 * GET /api/map/catalogue/fiche?cle=<famille:nom>
 * La fiche d'un jeu de l'étape ② (lot « Catalogue et groupes », A-8) : propriétaire, niveau (socle / privé / partagé,
 * vu de l'espace actif), effectif (`valid_count`) et date d'import de chaque source qui porte le jeu. Lue à
 * l'ouverture de la fiche seulement ; Angular la met en cache par clé.
 *
 * `poi:<cat>` → les sources visibles de type `poi` de la catégorie. Référentiel → « référentiel système », plus les
 * sources de ses indicateurs visibles (`civique:indicateurs-cp` → l'abstention). Clé inconnue ou invisible : 404, les
 * deux indiscernables.
 *
 * Gardée par `requireAuth` et non publique comme `/api/map/categories` : sans espace, elle lirait encore les sources
 * du socle, et un nom de source ou de propriétaire est une donnée (tests/unit/api/routes-publiques.test.ts).
 *
 * Coût : au plus trois lectures, toutes bornées par construction (dizaines de lignes) — sources visibles ou
 * indicateurs visibles, puis les sources retenues, puis les noms d'espaces (ces deux-là en parallèle).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { indicateursVisiblesDeLaSession } from '@/lib/auth/perimetre-donnees';
import { RE_CLE_JEU } from '@/lib/carte/jeux-carte';
import { categorieDeCle, composerFiche, type SourceLue } from '@/lib/carte/fiche-jeu';
import { lireEspacesBruts } from '@/lib/espaces/lister-espaces';
import { nomAffiche } from '@/lib/espaces/nom-espace';

export const dynamic = 'force-dynamic';

const Requete = z.object({ cle: z.string().regex(RE_CLE_JEU) });
const INTROUVABLE = { error: 'Jeu introuvable.' };
const COLONNES = 'id, name, type, category, visibilite, organization_id, shared_with, valid_count, import_date';

export async function GET(req: NextRequest) {
  const profil = await requireAuth(req);
  if (!profil) return authUnauthorized();
  const lue = Requete.safeParse({ cle: req.nextUrl.searchParams.get('cle') });
  if (!lue.success) return NextResponse.json(INTROUVABLE, { status: 404 });
  const { cle } = lue.data;

  const session = await getSessionOrg(req);
  const categorie = categorieDeCle(cle);
  let ids: string[] = [];
  let indicateursVisibles: ReadonlySet<string> = new Set();
  if (categorie !== null) {
    ids = (await getOrgSourceIds(session, { vueEspace: true })) ?? [];
  } else {
    const ind = await indicateursVisiblesDeLaSession(session);
    indicateursVisibles = ind.visibles;
    ids = [...ind.sourceDe.values()];
  }

  const sb = createAdminClient();
  let requete = sb.from('data_sources').select(COLONNES).in('id', ids);
  if (categorie !== null) requete = requete.eq('type', 'poi').eq('category', categorie);
  // Deux lectures en parallèle au plus (règle des trois appels simultanés).
  const [{ data, error }, espaces] = await Promise.all([requete, lireEspacesBruts(sb).catch(() => null)]);
  if (error || espaces === null) {
    console.error('[map/catalogue/fiche] lecture :', error?.message ?? 'espaces');
    return NextResponse.json({ error: 'Fiche indisponible.' }, { status: 500 });
  }

  const fiche = composerFiche(cle, {
    espaceActif: session?.orgId ?? null,
    sources: (data ?? []) as SourceLue[],
    indicateursVisibles,
    nomsEspaces: new Map(espaces.map((e) => [e.id, nomAffiche(e)])),
  });
  if (!fiche) return NextResponse.json(INTROUVABLE, { status: 404 });
  return NextResponse.json(fiche);
}
