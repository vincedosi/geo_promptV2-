/**
 * GET /api/risques/exposition/rayon/export — le classeur Excel INTERACTIF de
 * l'onglet Rayon.
 *
 * ── CE QU'IL CONTIENT ─────────────────────────────────────────────────────
 *
 * Une feuille de pilotage — menu Seuil Seveso, menu Territoire, barre de
 * défilement du rayon, cases des natures et des étiquettes — un graphique
 * Excel natif, les tableaux par région et par département, et la table de
 * couverture entière dont tout se recalcule. Voir
 * `lib/risques/export-rayon/classeur.ts`.
 *
 * ── LES PARAMÈTRES NE FILTRENT RIEN ───────────────────────────────────────
 *
 * `gravites`, `natures`, `perim_*` et `rayon_m` ne fixent que les valeurs
 * INITIALES des contrôles, pour que le classeur s'ouvre sur ce que l'écran
 * montrait. La table est exportée entière : c'est ce qui permet de changer
 * de seuil ou de territoire dans Excel sans revenir à l'application.
 *
 * ⚠ La cible est la population totale (`ind`), et elle seule : l'onglet Rayon
 * n'en montre pas d'autre, et un classeur à 24 cibles pèserait 24 fois plus.
 *
 * Coût mesuré (2026-09-28, local) : `export_couverture_rayon` 5,4 s à froid —
 * la lecture des 116 000 lignes de `couverture_rayon_risque` — puis 0,33 s ;
 * classeur de ~820 Ko. Quota 6/min, même ecart avec la route de lecture
 * (30/min) que celui déjà retenu pour `/profil/export`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { logger } from '@/lib/logger';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { liste } from '@/lib/api/parametres-requete';
import { preparerDonnees, type ReponseExportRayon } from '@/lib/risques/export-rayon/donnees';
import { construireClasseurRayon } from '@/lib/risques/export-rayon/classeur';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:exposition-rayon-export',
});

const ParamsSchema = z.object({
  gravites: z.string().max(200).optional(),
  natures: z.string().max(2000).optional(),
  perim_niveau: z.enum(['region', 'departement']).optional(),
  perim_code: z.string().regex(/^(2A|2B|\d{2,3})$/).optional(),
  rayon_m: z.coerce.number().int().min(100).max(10_000).optional(),
});

/** Portée des journaux de cette route. */
const PORTEE = 'risques/exposition/rayon/export';

/**
 * Fabrique et sert le classeur.
 *
 * @param request - Requête authentifiée ; paramètres de l'état initial.
 * @returns Le .xlsx en pièce jointe ; 400 paramètres invalides, 401 non
 *   authentifié, 409 pré-calcul absent, 429 quota, 500 lecture ou fabrication
 *   impossible — toujours avec un message en français.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Paramètres invalides.', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('export_couverture_rayon', { p_cible: 'ind' });
  if (error) {
    logger.error(PORTEE, 'lecture de la couverture', { message: error.message });
    return NextResponse.json({ error: 'Export indisponible.' }, { status: 500 });
  }
  const brut = rpcJson<ReponseExportRayon>(data);
  if (!brut?.calculable) {
    return NextResponse.json({ error: 'Export impossible.' }, { status: 400 });
  }
  if (brut.lignes.length === 0) {
    // Même garde que la courbe : un classeur vide se lirait « personne
    // n'habite près d'un site ».
    return NextResponse.json(
      {
        error: 'La couverture par rayon n’a pas encore été construite. '
          + 'Elle se calcule une fois après chaque import de sites à risque.',
        a_construire: true,
      },
      { status: 409 },
    );
  }

  let fichier: Buffer;
  try {
    fichier = await construireClasseurRayon(preparerDonnees(brut), {
      gravites: liste(p.gravites) ?? [],
      natures: liste(p.natures) ?? [],
      perim: p.perim_niveau && p.perim_code ? { niveau: p.perim_niveau, code: p.perim_code } : null,
      rayonM: p.rayon_m ?? 1000,
    });
  } catch (e) {
    // Une erreur de FABRICATION (injection du graphique), jamais de donnée :
    // sans ce garde-fou elle remontait en 500 nu, et le bouton affichait
    // « Export impossible » sans que rien ne soit journalisé.
    logger.error(PORTEE, e instanceof Error ? e : 'fabrication du classeur');
    return NextResponse.json({ error: 'Le classeur n’a pas pu être fabriqué.' }, { status: 500 });
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(fichier), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rayon-influence-seveso-${date}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
