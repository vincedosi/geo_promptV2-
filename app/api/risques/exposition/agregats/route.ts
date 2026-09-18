/**
 * @file app/api/risques/exposition/agregats/route.ts
 *
 * Population exposée agrégée par région / département / code postal (sql/185).
 * Sert l'overlay « Analyser la population à risque ».
 *
 * ── CE QUE LE CLIENT DOIT SAVOIR LIRE, ET QUE LA ROUTE LUI DONNE ──────────
 *
 * Trois nombres qui ne se comportent pas pareil, et qu'il ne faut pas
 * confondre à l'écran :
 *
 *   `total_exposee`    ÉGALE la somme de toutes les lignes. Un carreau de
 *                      200 m appartient à une seule unité, donc aucune
 *                      population n'est partagée entre deux lignes.
 *   `total_sites`      NE l'égale PAS. Un site dont la zone déborde sur deux
 *                      départements compte dans les deux.
 *   `total_indicatifs` combien de ces sites reposent sur un rayon CHOISI et
 *                      non sur une servitude publiée.
 *
 * ── LE COÛT, ET POURQUOI IL N'Y A PAS DE CACHE ICI ───────────────────────
 *
 * Mesuré le 2026-09-18 : ~3 s sur la base locale, après deux réécritures
 * (54,6 s puis 23,5 s — voir l'en-tête de sql/185). C'est un calcul
 * analytique, pas un affichage de carte : l'utilisateur change de cible ou de
 * dimension quelques fois par session, pas quelques fois par seconde.
 *
 * Un cache serait prématuré tant qu'on n'a pas vu l'usage réel — et il
 * poserait la question de son invalidation à chaque changement de rayon, de
 * filtre ou d'import. Le quota ci-dessous protège le budget d'I/O en
 * attendant ; il vit EN BASE (`consommer_quota`, sql/135), jamais dans une Map
 * de processus qui ne limiterait rien sur Vercel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { formaterNombre } from '@/lib/format/nombre';

export const dynamic = 'force-dynamic';

/**
 * 20 calculs par minute et par utilisateur. Compteur PARTAGÉ en base
 * (`consommer_quota`, sql/135), jamais une Map de processus — sur Vercel,
 * chaque invocation peut être une instance différente, et un compteur local
 * ne limiterait rien.
 */
const limiteur = createRateLimiter({
  max: 20,
  window: '60 s',
  prefix: 'geo:rl:exposition-agregats',
});

const DIMENSIONS = ['region', 'departement', 'code_postal'] as const;
const MODES = ['pprt', 'buffer'] as const;

const ParamsSchema = z.object({
  dimension: z.enum(DIMENSIONS).optional(),
  /** Code d'une cible de `cibles_exposition`. Validée EN BASE, pas ici. */
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  /** Niveaux réglementaires, séparés par des virgules. Défaut : les deux Seveso. */
  gravites: z.string().max(200).optional(),
  /** Libellés de nature. Le regroupement en 4 types vit côté client. */
  natures: z.string().max(2000).optional(),
  modes: z.string().max(40).optional(),
  /** Rayon des sites sans PPRT. Absent = rayon déduit des périmètres réels. */
  rayon_m: z.coerce.number().int().min(50).max(20000).optional(),
  limite: z.coerce.number().int().min(1).max(7000).optional(),
  /** Périmètre d'étude : 'region' | 'departement'. Absent = France entière. */
  /*
   * Impose le cercle a TOUS les sites, y compris ceux couverts par un PPRT.
   * Sans lui, `rayon_m` ne touchait que les sites sans servitude : demander
   * « 5 km autour de chaque site » etait impossible. `p_modes=['buffer']` ne
   * repond pas a la meme question — il EXCLUT les sites qui ont un plan, donc
   * rend un total plus PETIT au lieu d'un total recalcule.
   */
  forcer_rayon: z.enum(['0', '1']).optional(),
  perim_niveau: z.enum(['region', 'departement']).optional(),
  /** Codes du périmètre, séparés par des virgules. */
  perim_codes: z.string().max(600).optional(),
});

interface Ligne {
  cle: string;
  nom: string;
  exposee: number;
  n_sites: number;
  n_indicatifs: number;
  carreaux: number;
  pop_totale: number | null;
  surface_km2: number | null;
  part_pct: number | null;
  densite: number | null;
}

interface Agregat {
  calculable: boolean;
  error?: string;
  dimension?: string;
  cible?: string;
  rayon_m?: number;
  rayon_deduit?: boolean;
  n_unites?: number;
  total_exposee?: number;
  total_sites?: number;
  total_indicatifs?: number;
  total_carreaux?: number;
  tronquee?: boolean;
  perim_niveau?: string | null;
  perim_codes?: string[];
  lignes?: Ligne[];
  calcule_le?: string;
}

/** Un code d'erreur de la base ne repart jamais tel quel au client. */
const MESSAGES: Record<string, string> = {
  dimension_inconnue: 'Dimension inconnue. Attendu : région, département ou code postal.',
  cible_inconnue:
    "Cette cible n'est pas calculable. Seuls les effectifs le sont — un taux ne se prorate pas par la surface.",
};

/** 'a,b , c' → ['a','b','c'] ; chaîne vide ou absente → null (= pas de filtre). */
function liste(brut: string | undefined): string[] | null {
  if (!brut) return null;
  const v = brut.split(',').map((s) => s.trim()).filter(Boolean);
  return v.length > 0 ? v : null;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Ce calcul croise les carreaux de 200 m : il ne doit pas pouvoir être lancé
  // en boucle depuis un onglet laissé ouvert.
  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const modes = liste(p.modes)?.filter((m): m is (typeof MODES)[number] =>
    (MODES as readonly string[]).includes(m),
  );

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('population_exposee_agregee', {
    p_dimension: p.dimension ?? 'departement',
    p_cible: p.cible ?? 'ind',
    p_gravites: nullableArg(liste(p.gravites)),
    p_natures: nullableArg(liste(p.natures)),
    p_modes: nullableArg(modes && modes.length > 0 ? modes : null),
    p_rayon_m: nullableArg(p.rayon_m ?? null),
    p_limite: p.limite ?? 200,
    // Le périmètre filtre les SITES, pas les carreaux : un site du périmètre
    // dont la zone déborde juste au-delà apporte quand même sa population.
    // C'est le comportement attendu d'une étude locale — on étudie les
    // installations d'un territoire, pas un découpage de la population.
    p_perim_niveau: nullableArg(p.perim_codes ? (p.perim_niveau ?? 'departement') : null),
    p_perim_codes: nullableArg(liste(p.perim_codes)),
    p_forcer_rayon: p.forcer_rayon === '1',
  });

  if (error) {
    console.error('[risques/exposition/agregats]', error.message);
    return NextResponse.json({ error: 'Calcul indisponible.' }, { status: 500 });
  }

  const resultat = rpcJson<Agregat>(data);
  if (!resultat) {
    return NextResponse.json({ error: 'Calcul indisponible.' }, { status: 500 });
  }
  if (!resultat.calculable) {
    /*
     * `trop_de_sites` est le SEUL refus qui doit citer des chiffres, parce
     * que c'est le seul que l'utilisateur peut lever lui-meme : lui dire
     * « trop de sites » sans dire combien, ni combien sont admis, ni comment
     * descendre, c'est un mur. Le message nomme donc les deux nombres et la
     * sortie — restreindre le territoire, ou retirer un regime.
     *
     * Il n'est pas dans MESSAGES parce que MESSAGES est une table de
     * constantes, et que celui-ci depend du resultat.
     */
    if (resultat.error === 'trop_de_sites') {
      const r = resultat as unknown as { n_sites?: number; max_sites?: number };
      const n = formaterNombre(r.n_sites ?? 0);
      const max = formaterNombre(r.max_sites ?? 0);
      return NextResponse.json(
        {
          error:
            `Ce filtre retient ${n} sites, au-dela des ${max} que le calcul traite ` +
            `dans un temps d'ecran. Choisissez un territoire dans « Territoire etudie », ` +
            `ou retirez un regime (Seveso seul reste calculable sur la France entiere).`,
          n_sites: r.n_sites,
          max_sites: r.max_sites,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: MESSAGES[resultat.error ?? ''] ?? 'Calcul impossible.' },
      { status: 400 },
    );
  }

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
