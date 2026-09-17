import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { CATEGORIE_ICPE } from '@/lib/import/georisques/classement';
import { NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';

export const dynamic = 'force-dynamic';

// GET /api/map/poi-natures?categorie=lycee
// Retourne les valeurs distinctes de metadata->>'libelle_nature' pour une catégorie POI

/**
 * ⚠ POURQUOI `risque_industriel` A SON PROPRE CHEMIN
 *
 * Le chemin générique plus bas pagine TOUTES les lignes de la catégorie, mille
 * par mille, en tirant la colonne `metadata` entière, puis déduplique en
 * mémoire. Sur quelques centaines de lycées c'est indolore. Sur les
 * **138 423 installations classées**, c'est 138 requêtes qui rapatrient ~140 Mo
 * de jsonb pour en extraire quinze chaînes de caractères — la famille exacte de
 * l'incident du 28/03 (budget d'I/O épuisé, Auth en 504, application au tapis).
 *
 * Or pour cette catégorie la réponse est connue d'avance : les natures sont les
 * libellés du registre `icpe_rubrique_familles`, quinze lignes bornées, plus le
 * libellé de repli des sites sans rubrique exploitable (70 % d'entre eux au
 * premier import réel). On lit donc le registre, pas les POI.
 *
 * Les natures sont rendues par gravité décroissante et non par ordre
 * alphabétique : dans une liste de filtre, « Toxicité aiguë » doit arriver
 * avant « Agroalimentaire et divers ».
 */
async function naturesDepuisRegistre() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('icpe_rubrique_familles')
    .select('libelle, rang_gravite')
    .order('rang_gravite', { ascending: false });

  if (error) {
    return NextResponse.json({ natures: [], error: error.message }, { status: 500 });
  }

  const natures = [...(data ?? []).map((f) => f.libelle), NATURE_NON_PRECISEE];
  return NextResponse.json({ natures });
}

export async function GET(req: NextRequest) {
  const categorie = req.nextUrl.searchParams.get('categorie');
  if (!categorie) return NextResponse.json({ natures: [] });

  if (categorie === CATEGORIE_ICPE) return naturesDepuisRegistre();

  const supabase = createAdminClient();
  const PAGE = 1000;
  const naturesSet = new Set<string>();

  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('poi_france')
      .select('metadata')
      .eq('categorie', categorie)
      .not('metadata', 'is', null)
      .range(from, from + PAGE - 1);

    if (error || !data?.length) break;

    for (const row of data) {
      const nature = (row.metadata as Record<string, string>)?.libelle_nature;
      if (nature && typeof nature === 'string') naturesSet.add(nature);
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return NextResponse.json({ natures: Array.from(naturesSet).sort() });
}
