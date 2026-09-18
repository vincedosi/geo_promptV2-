/**
 * @file app/api/risques/[siteId]/exposition/route.ts
 *
 * Population exposée d'un site à risque industriel (sql/180).
 *
 * ── LE CACHE EST LU D'ABORD, ET IL PEUT ÊTRE VIDE ─────────────────────────
 *
 * `seveso_exposition` sert de cache. Il est alimenté à la demande : au premier
 * clic sur un site, la RPC calcule et la route écrit le résultat. Les clics
 * suivants sur le même site ne paient plus rien.
 *
 * Ce n'est PAS un pré-calcul de masse. Lancer les 96 427 sites d'un coup
 * coûterait 96 427 × ~300 ms d'intersections sur `carreaux_filosofi`
 * (2,3 M lignes) — soit la famille exacte de l'incident du 28/03. Un média
 * planner ne consulte qu'une poignée de sites ; on calcule ceux-là.
 *
 * ── `indicatif` EST LA SEULE CHOSE QUI NE DOIT JAMAIS SE PERDRE ───────────
 *
 * `false` → la zone est la servitude PPRT publiée par l'État.
 * `true`  → la zone est un rayon que MAGELIAN a choisi.
 *
 * Le nombre d'habitants se lit pareil dans les deux cas ; ce qu'il vaut, non.
 * Un chiffre « 2 126 personnes exposées » repris dans une recommandation
 * client n'a pas le même statut selon l'origine de la zone, et l'écran doit
 * porter la différence.
 *
 * ── `force-dynamic` ET `no-store` ────────────────────────────────────────
 *
 * Convention du projet : le Data Cache de Next pollue les SELECT de
 * supabase-js, et un cache HTTP sur une donnée qui vient d'être calculée
 * masquerait le premier résultat derrière l'absence de cache précédente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  /** Force le recalcul même si le cache porte déjà une réponse. */
  recalculer: z.enum(['0', '1']).optional(),
});

/** Un palier tel que la RPC le rend. */
interface Palier {
  palier: string;
  libelle: string;
  ordre: number;
  pop_exposee: number;
  pop_couronne: number;
  nb_carreaux: number;
  surface_km2: number | null;
}

interface Exposition {
  site_id?: string;
  site_nom?: string;
  mode?: 'pprt' | 'buffer';
  indicatif?: boolean;
  calculable: boolean;
  error?: string;
  pprt_id?: string | null;
  pprt_nom?: string | null;
  paliers?: Palier[];
  calcule_le?: string;
}

/** Messages français : un code brut de la base ne part jamais tel quel au client. */
const MESSAGES: Record<string, string> = {
  site_introuvable: "Ce site n'existe pas, ou n'est pas une installation classée.",
  site_sans_coordonnees:
    "Ce site n'a pas de coordonnées exploitables — la population exposée n'est pas calculable.",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { siteId } = await params;
  if (!z.string().uuid().safeParse(siteId).success) {
    return NextResponse.json({ error: 'Identifiant de site invalide.' }, { status: 400 });
  }

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 },
    );
  }
  const recalculer = parsed.data.recalculer === '1';
  const supabase = createAdminClient();

  // ── 1. Le cache ───────────────────────────────────────────────────────
  if (!recalculer) {
    const { data: cache, error: erreurCache } = await supabase
      .from('seveso_exposition')
      .select('mode, palier, indicatif, pop_exposee, pop_couronne, nb_carreaux, surface_km2, calcule_le')
      .eq('site_id', siteId);

    // Une erreur de lecture du cache ne doit pas faire échouer la route : on
    // retombe sur le calcul. Mais elle se journalise — un cache silencieusement
    // illisible ferait recalculer à chaque clic sans que personne le voie.
    if (erreurCache) {
      console.error('[risques/exposition] lecture du cache', erreurCache.message);
    } else if (cache && cache.length > 0) {
      const paliers = cache
        .map((l) => ({
          palier: l.palier,
          libelle: l.palier === 'perimetre' ? 'Périmètre PPRT' : libelleRayon(l.palier),
          ordre: l.palier === 'perimetre' ? 1 : Number(l.palier),
          pop_exposee: Number(l.pop_exposee),
          pop_couronne: Number(l.pop_couronne),
          nb_carreaux: l.nb_carreaux,
          surface_km2: l.surface_km2 === null ? null : Number(l.surface_km2),
        }))
        .sort((a, b) => a.ordre - b.ordre);

      return NextResponse.json(
        {
          site_id: siteId,
          mode: cache[0].mode,
          indicatif: cache[0].indicatif,
          calculable: true,
          paliers,
          calcule_le: cache[0].calcule_le,
          depuis_cache: true,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  // ── 2. Le calcul ──────────────────────────────────────────────────────
  const { data, error } = await supabase.rpc('population_exposee_site', {
    p_site_id: siteId,
  });

  if (error) {
    console.error('[risques/exposition]', error.message);
    return NextResponse.json({ error: 'Calcul indisponible.' }, { status: 500 });
  }

  const resultat = rpcJson<Exposition>(data);
  if (!resultat) {
    return NextResponse.json({ error: 'Calcul indisponible.' }, { status: 500 });
  }

  if (!resultat.calculable) {
    return NextResponse.json(
      { error: MESSAGES[resultat.error ?? ''] ?? 'Population exposée non calculable.' },
      { status: 404 },
    );
  }

  // ── 3. Alimenter le cache ─────────────────────────────────────────────
  // Un échec d'écriture ne fait PAS échouer la réponse : le chiffre est juste,
  // il sera simplement recalculé au prochain clic. Mais il se journalise —
  // supabase-js ne lève pas, il rend `{ error }`, et une écriture qui échoue
  // en silence transformerait le cache en décor.
  const lignes = (resultat.paliers ?? []).map((p) => ({
    site_id: siteId,
    mode: resultat.mode as 'pprt' | 'buffer',
    palier: p.palier,
    indicatif: resultat.indicatif ?? true,
    pop_exposee: p.pop_exposee,
    pop_couronne: p.pop_couronne,
    nb_carreaux: p.nb_carreaux,
    surface_km2: p.surface_km2,
  }));

  if (lignes.length > 0) {
    const { error: erreurEcriture } = await supabase
      .from('seveso_exposition')
      .upsert(lignes, { onConflict: 'site_id,mode,palier' });
    if (erreurEcriture) {
      console.error('[risques/exposition] ecriture du cache', erreurEcriture.message);
    }
  }

  return NextResponse.json(
    { ...resultat, depuis_cache: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** '500' → '500 m', '2000' → '2 km'. Miroir exact du libellé rendu par sql/180. */
function libelleRayon(palier: string): string {
  const n = Number(palier);
  if (!Number.isFinite(n)) return palier;
  return n < 1000 ? `${n} m` : `${n / 1000} km`;
}
