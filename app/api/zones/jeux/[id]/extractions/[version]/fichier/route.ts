/**
 * @file app/api/zones/jeux/[id]/extractions/[version]/fichier/route.ts
 *
 * GET `?plateforme=<dv360|ttd|meta|tiktok>&format=<cp|sdf|cercles|polygone|territoires|pays>` — le fichier d'UNE plateforme
 * pour une extraction figée (lot 7, T2, A-6 ; écart E5). Lu dans l'extraction, jamais recalculé : ce sont les unités
 * montrées au moment de la figer. Écrit par `fichierPlateforme` (`lib/zones/fichiers-plateformes.ts`, pur).
 *
 * - Maille de la plateforme : son résumé figé (`zone_set_extractions.plateformes`). Jeu RISQUE (sans résumé) : CP
 *   seulement, et seulement DV360 et TTD (A-4) — Meta et TikTok n'achètent pas un plan CP de jeu risque.
 * - Unités : CP par `lireCpPlateforme` (les mêmes que le pré-vol et la poussée de ⑦, et que le tableau de ⑥) ;
 *   cercles, territoires et pays (⑤ finitions, T3 : les codes pays figés, six au plus) par `lireTout` sur
 *   `zone_set_extraction_unites` (préfixe de la clé primaire, plafond 7 000) ; polygone par la `forme` de
 *   l'extraction (une ligne).
 * - `plateformes_geo` (une ligne par la clé) : `a_verifier` et `releve_le`, écrits dans l'en-tête de méthode.
 * - B14 round 1 (I-2) : `&bloc=N` — une maille découpée en blocs (ARB-6, `zone_set_extraction_unites.bloc`) se
 *   télécharge bloc par bloc (`choisirBloc`) : sans `bloc` alors qu'il y en a plusieurs, 422 avec la liste `blocs` —
 *   jamais un fichier au-dessus de la limite de la plateforme ; bloc absent 404 ; `bloc` sans découpage 400.
 *
 * 400 : paramètre illisible, ou format sans objet pour la maille (« La plateforme meta n'achète pas au code postal
 * dans cette extraction. ») ; 404 : jeu d'un autre espace (chargeur) ou version absente ; 409 : « Aucune unité
 * retenue pour cette plateforme. ». Une lecture, pas une poussée : rien n'est journalisé (A-7).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireTout } from '@/lib/supabase/lire-tout';
import { messageAnomalies } from '@/lib/api/valider-corps';
import { PLAFOND_CP_PLAN } from '@/lib/zones/plan-extraction';
import { lireCpPlateforme } from '@/lib/zones/cp-plateforme';
import { MAILLES, PLATEFORMES } from '@/lib/zones/plateformes';
import {
  FORMATS_FICHIER, choisirBloc, fichierPlateforme, formatsDe, type FormatFichier, type Plateforme, type UniteFichier,
} from '@/lib/zones/fichiers-plateformes';

export const dynamic = 'force-dynamic';

/** Un téléchargement à la demande : 6 par minute suffisent à un humain et bornent une boucle. */
const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:zone-set-extraction-fichier' });

const ParametresSchema = z.object({
  version: z.coerce.number().int().min(1),
  plateforme: z.enum(PLATEFORMES),
  format: z.enum(FORMATS_FICHIER),
  bloc: z.coerce.number().int().min(1).max(32767).optional(),
});

/** Plateformes d'un jeu risque (A-4) : son plan n'est fait que de codes postaux. */
const PLATEFORMES_RISQUE: readonly Plateforme[] = ['dv360', 'ttd'];

const MESSAGE_AUCUNE_UNITE = 'Aucune unité retenue pour cette plateforme.';
const erreur = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Le 400 d'un format qui ne s'applique pas : celui du code postal nomme la plateforme, comme l'écran. */
function refusFormat(plateforme: string, maille: string, format: FormatFichier): NextResponse {
  return erreur(
    format === 'cp' || format === 'sdf'
      ? `La plateforme ${plateforme} n'achète pas au code postal dans cette extraction.`
      : `Le format ${format} ne s'applique pas à ${plateforme} à la maille ${maille} dans cette extraction.`,
    400,
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) return erreur('Aucune organisation active.', 403);

  const { id, version } = await params;
  const q = request.nextUrl.searchParams;
  const lus = ParametresSchema.safeParse({
    version, plateforme: q.get('plateforme') ?? undefined, format: q.get('format') ?? undefined, bloc: q.get('bloc') ?? undefined,
  });
  if (!lus.success) return erreur(messageAnomalies(lus.error), 400);
  const { plateforme, format } = lus.data;

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  // Sans type : les deux types de jeu ont des extractions. L'espace est vérifié par le chargeur (pas de RLS).
  const charge = await chargerJeu(supabase, id, profile.organization_id);
  if (!charge.ok) return charge.reponse;
  const jeu = charge.jeu;

  const { data: x, error: erreurX } = await supabase
    .from('zone_set_extractions')
    .select('id, version, plateformes')
    .eq('zone_set_id', id)
    .eq('version', lus.data.version)
    .maybeSingle();
  if (erreurX) {
    console.error('[zones/extraction fichier] extraction :', erreurX.message);
    return erreur('Extraction illisible.', 500);
  }
  if (!x) return erreur(`Ce jeu de zones n’a pas de version ${lus.data.version}.`, 404);

  // ── La maille de la plateforme dans CETTE extraction ──────────────────
  let maille: (typeof MAILLES)[number];
  const resumes = x.plateformes as Array<{ plateforme?: string; maille?: string }> | null;
  if (!Array.isArray(resumes)) {
    if (!PLATEFORMES_RISQUE.includes(plateforme)) return refusFormat(plateforme, 'cp', 'cp');
    maille = 'cp';
  } else {
    const resume = resumes.find((r) => r.plateforme === plateforme);
    if (!resume || !(MAILLES as readonly string[]).includes(resume.maille ?? '')) return erreur(MESSAGE_AUCUNE_UNITE, 409);
    maille = resume.maille as typeof maille;
  }
  if (!formatsDe(plateforme, maille).includes(format)) return refusFormat(plateforme, maille, format);

  // ── Le registre : fraîcheur et « à vérifier » de la règle de la plateforme ──
  const { data: regle, error: erreurRegle } = await supabase
    .from('plateformes_geo')
    .select('a_verifier, releve_le')
    .eq('plateforme', plateforme)
    .eq('maille', maille)
    .maybeSingle();
  if (erreurRegle) {
    console.error('[zones/extraction fichier] registre :', erreurRegle.message);
    return erreur('Registre des plateformes illisible.', 500);
  }

  // ── Les unités ────────────────────────────────────────────────────────
  let unites: UniteFichier[] = [];
  let forme: unknown = null;
  try {
    if (maille === 'cp') {
      const lignes = await lireCpPlateforme(supabase, x.id, plateforme);
      unites = lignes.map((l, i) => ({
        ordinal: i + 1, code: l.code_postal, nom: null, centre: null, rayon_m: null, retenu: true,
      }));
    } else if (maille === 'polygone') {
      const { data: f, error } = await supabase.from('zone_set_extractions').select('forme').eq('id', x.id).single();
      if (error) throw new Error(error.message);
      forme = f.forme;
    } else {
      // Lecture PAGINÉE (`db-max-rows = 1000`), préfixe de la clé primaire (extraction, plateforme, maille, ordinal).
      // `centre` est typé `unknown` (geometry) : PostgREST le rend en GeoJSON Point, d'où le cast plus bas.
      const { lignes } = await lireTout<Omit<UniteFichier, 'centre'> & { centre: unknown }>(
        (de, a) => supabase
          .from('zone_set_extraction_unites')
          .select('ordinal, code, nom, centre, rayon_m, retenu, bloc')
          .eq('extraction_id', x.id)
          .eq('plateforme', plateforme)
          .eq('maille', maille)
          .order('ordinal')
          .range(de, a),
        PLAFOND_CP_PLAN,
      );
      unites = lignes.map((u) => ({ ...u, centre: u.centre as UniteFichier['centre'] }));
    }
  } catch (e) {
    console.error('[zones/extraction fichier] unités :', e instanceof Error ? e.message : e);
    return erreur('Unités de l’extraction illisibles.', 500);
  }
  if (maille === 'polygone' ? !forme : !unites.some((u) => u.retenu)) return erreur(MESSAGE_AUCUNE_UNITE, 409);
  const bloc = choisirBloc(unites, lus.data.bloc);
  if (!bloc.ok) return NextResponse.json({ error: bloc.error, blocs: bloc.blocs }, { status: bloc.status });

  let fichier: ReturnType<typeof fichierPlateforme>;
  try {
    fichier = fichierPlateforme(
      {
        jeu: jeu.nom, version: x.version, plateforme, maille,
        aVerifier: regle?.a_verifier ?? false, releveLe: regle?.releve_le || null,
        ...(bloc.bloc ? { bloc: bloc.bloc } : {}),
      },
      unites, forme, format,
    );
  } catch (e) {
    console.error('[zones/extraction fichier] écriture :', e instanceof Error ? e.message : e);
    return erreur('Fichier impossible à écrire pour cette extraction.', 500);
  }

  return new Response(fichier.contenu, {
    headers: {
      'Content-Type': fichier.type,
      'Content-Disposition': `attachment; filename="${fichier.nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
