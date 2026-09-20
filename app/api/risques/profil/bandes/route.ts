/**
 * @file app/api/risques/profil/bandes/route.ts
 *
 * Population par CLASSE d'un profil de rayons, et par territoire (sql/203 pour
 * le pré-calcul, sql/204 pour la lecture). Sert l'atelier « Rayons » et le
 * tableau des bandes.
 *
 * ── CE QU'ELLE CORRIGE ───────────────────────────────────────────────────
 *
 * `/api/risques/exposition/rayon` sert une distribution MARGINALE : une courbe
 * par gravité, chacune exacte pour sa propre question, mais un carreau proche
 * d'un seuil haut ET d'un seuil bas compte dans les deux. Mesuré le
 * 2026-09-19 : 328 071 carreaux sont dans ce cas, soit 35,9 % des carreaux
 * exposés. Les deux nombres affichés ne s'additionnaient donc pas, sans
 * qu'aucun ne soit faux pris isolément.
 *
 * Ici chaque carreau porte UNE classe, décidée par
 * `lib/risques/affectation.ts` et sa transcription SQL. Toutes les sommes
 * redeviennent additives — par niveau, par bande, par territoire — et
 * `total` égale la somme de `par_classe`.
 *
 * ── POURQUOI ELLE RESTE RAPIDE ───────────────────────────────────────────
 *
 * Elle ne fait AUCUNE géométrie. Le pré-calcul a figé, pour chaque carreau, sa
 * distance au site le plus proche de chaque niveau ; appliquer un profil n'est
 * plus qu'un découpage arithmétique suivi d'une somme. Changer un anneau ne
 * relance donc pas un `ST_Buffer` sur 1 259 sites — c'était le défaut signalé
 * qui a conduit à toute cette refonte.
 *
 * ── CE QUE LE CLIENT DOIT SAVOIR LIRE ────────────────────────────────────
 *
 * `hors_zone` compte les habitants de carreaux PROCHES d'un site mais que
 * le profil courant ne retient pas — un rayon réglé trop court, par exemple.
 * Ce n'est PAS « la population non exposée de France » : la table ne contient
 * que des carreaux à moins de 10 km d'un site.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { profilDepuisCode } from '@/lib/risques/code-profil';

export const dynamic = 'force-dynamic';

/**
 * 30 par minute, comme `/exposition/rayon` : les deux ne font qu'une lecture
 * indexée. Le quota existe pour qu'un client en boucle ne martèle pas la base,
 * pas pour rationner un calcul coûteux. Compteur PARTAGÉ en base
 * (`consommer_quota`, sql/135) — une `Map` locale ne limiterait rien sur
 * plusieurs instances.
 */
const limiteur = createRateLimiter({
  max: 30,
  window: '60 s',
  prefix: 'geo:rl:risque-bandes',
});

const ParamsSchema = z.object({
  /** Le profil sous sa forme codée (`lib/risques/code-profil.ts`). */
  profil: z.string().min(3).max(128),
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  maille: z.enum(['departement', 'commune']).optional(),
  /** Code de département pour descendre d'un cran. */
  parent: z.string().regex(/^(2A|2B|\d{2,3})$/).optional(),
  limite: z.coerce.number().int().min(1).max(2000).optional(),
});

const MESSAGES: Record<string, string> = {
  cible_inconnue:
    "Cette cible n'est pas calculable. Seuls les effectifs le sont — un taux ne se prorate pas par la surface.",
  maille_non_portee:
    'Cette maille n’est pas encore disponible pour les bandes de rayon. Le département et la commune le sont.',
};

interface Unite {
  unite: string;
  total: number;
  classes: Record<string, number>;
}

interface Reponse {
  calculable: boolean;
  error?: string;
  maille: string;
  cible: string;
  parent: string | null;
  n_unites: number;
  tronquee: boolean;
  unites: Unite[];
  total: number | null;
  par_classe: Record<string, number>;
  hors_zone: number;
}

export async function GET(request: NextRequest) {
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

  /*
   * Le profil est relu et REVALIDÉ côté serveur, jamais accepté sur parole. Le
   * code vient de l'URL du client : un anneau de 50 km passerait la syntaxe et
   * demanderait à la base un découpage sur des paliers qui n'existent pas.
   */
  const profil = profilDepuisCode(p.profil);
  if (!profil) {
    return NextResponse.json(
      {
        error:
          'Profil de rayons illisible ou hors bornes. Les rayons vont de 100 m à 10 km, '
          + 'quatre anneaux au plus par niveau.',
      },
      { status: 400 },
    );
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('population_par_classe', {
    p_profil: toJson(profil),
    p_cible: p.cible ?? 'ind',
    p_maille: p.maille ?? 'departement',
    p_parent: nullableArg(p.parent ?? null),
    p_limite: p.limite ?? 200,
  });

  if (error) {
    console.error('[risques/profil/bandes]', error.message);
    return NextResponse.json({ error: 'Calcul des bandes indisponible.' }, { status: 500 });
  }

  const resultat = rpcJson<Reponse>(data);
  if (!resultat) {
    return NextResponse.json({ error: 'Calcul des bandes indisponible.' }, { status: 500 });
  }
  if (!resultat.calculable) {
    return NextResponse.json(
      { error: MESSAGES[resultat.error ?? ''] ?? 'Calcul impossible.' },
      { status: 400 },
    );
  }

  /*
   * ── UN RESULTAT VIDE A DEUX CAUSES, ET UNE SEULE SE CORRIGE ────────────
   *
   * Rendre des bandes a zero serait pire que refuser : cela se lirait
   * « personne n'habite pres d'un site a risque ». Mais le refus doit nommer
   * la BONNE cause.
   *
   *   · le pre-calcul n'a jamais ete construit -> lancer le script ;
   *   · ce territoire n'est pas CARROYE par l'INSEE -> le script n'y changera
   *     rien, jamais.
   *
   * Les deux rendaient le meme ecran jusqu'au 2026-09-20 : selectionner la
   * Guadeloupe affichait « les distances n'ont pas encore ete construites,
   * lancez node scripts/construire_carreau_risque.mjs » alors que le
   * pre-calcul portait 883 451 lignes sur 98 departements. Le carroyage
   * Filosofi 2021 a 200 m ne publie que la metropole, la Martinique et La
   * Reunion — 971, 973 et 976 n'ont AUCUN carreau, et le script ne peut pas
   * en fabriquer.
   *
   * Le message reclamait donc une action impossible, et il taisait le seul
   * fait qui compte : ces trois departements portent 603 sites a risque, dont
   * 31 Seveso, qui restent visibles sur la carte.
   */
  if (resultat.n_unites === 0 && (resultat.total ?? 0) === 0) {
    const { data: diag, error: erreurDiag } = await supabase.rpc(
      'couverture_carreau_risque',
      { p_departement: nullableArg(p.parent ?? null) },
    );
    if (erreurDiag) {
      console.error('[risques/profil/bandes] couverture :', erreurDiag.message);
    }
    const couverture = rpcJson<{
      construit: boolean; territoire_couvert: boolean;
      n_sites: number; n_seveso: number;
    }>(diag);

    // `construit === false` seulement : en cas d'echec du diagnostic, on ne
    // suppose pas qu'il faut construire — mieux vaut la phrase generique
    // qu'une consigne qui pourrait faire perdre vingt minutes.
    if (couverture && !couverture.construit) {
      return NextResponse.json(
        {
          error:
            'Les distances par carreau n’ont pas encore été construites. '
            + 'Elles se calculent une fois après chaque import de sites à risque.',
          a_construire: true,
        },
        { status: 409 },
      );
    }

    if (couverture && !couverture.territoire_couvert && p.parent) {
      return NextResponse.json(
        {
          error:
            `L’INSEE ne publie pas de carroyage à 200 m pour ce département : `
            + `la population exposée n’y est pas calculable. `
            + `${couverture.n_sites} sites à risque y sont pourtant recensés`
            + (couverture.n_seveso > 0 ? `, dont ${couverture.n_seveso} Seveso` : '')
            + `, et restent visibles sur la carte.`,
          // ⚠ PAS `a_construire` : aucune construction n'y changera quoi que
          // ce soit. Afficher la consigne ici ferait perdre du temps et
          // laisserait croire que le chiffre existera un jour.
          non_carroye: true,
          n_sites: couverture.n_sites,
          n_seveso: couverture.n_seveso,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error:
          'Aucun carreau habité ne se trouve à portée d’un site à risque sur ce '
          + 'périmètre, avec ce profil de rayons.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
