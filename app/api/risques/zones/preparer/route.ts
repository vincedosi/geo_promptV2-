/**
 * @file app/api/risques/zones/preparer/route.ts
 *
 * POST — construit (ou retrouve) la géométrie des zones d'un profil de rayons,
 * pour que la couche MVT ait quelque chose à servir (sql/205).
 *
 * ── POURQUOI UNE ROUTE DE PRÉPARATION, ET PAS UNE CONSTRUCTION PARESSEUSE ─
 *
 * Construire à la première tuile demandée serait tentant. Mais un panoramique
 * demande des dizaines de tuiles EN PARALLÈLE : elles déclencheraient chacune
 * la même construction, et les dernières attendraient les premières sans
 * qu'aucune ne le sache. Un geste explicite, une fois, avant d'allumer la
 * couche.
 *
 * ── POURQUOI PAS DE FLUX DE PROGRESSION ──────────────────────────────────
 *
 * `CLAUDE.md` impose une barre de progression sur tout traitement batch. Celui-ci
 * n'en est pas un, et c'est mesuré : **2 805 ms** pour les sept classes du
 * profil par défaut sur la France entière (1 259 sites, unions, différences ET
 * lissage compris). Une barre de progression sur moins de trois secondes
 * ajouterait du bruit sans rien apprendre.
 *
 * ⚠ C'était **1 326 ms jusqu'au 2026-09-21**, avant que sql/223 n'ajoute la
 * fermeture morphologique et `quad_segs=16`. La mesure a donc bien été REFAITE
 * plutôt que la règle contournée — et le seuil de décision était posé
 * d'avance : au-delà de 3 s, on branche l'indicateur de chargement. Si un
 * prochain changement fait franchir ce seuil, c'est ce qu'il faudra faire.
 *
 * ── IDEMPOTENTE ──────────────────────────────────────────────────────────
 *
 * Un profil déjà construit est rendu tel quel, avec `deja_construit: true`. La
 * clé est le CODE du profil — réversible, sans collision possible. Une
 * empreinte au sens strict pourrait servir les zones d'un profil sous la
 * légende d'un autre, en silence : le défaut que sql/196 a dû corriger sur
 * `exposition_cache`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { profilDepuisCode, codeProfil, codeZonesRisque } from '@/lib/risques/code-profil';

export const dynamic = 'force-dynamic';

/**
 * 12 par minute : c'est une CONSTRUCTION, pas une lecture. Même ordre que les
 * quotas d'analyse (`geo:rl:analyse-score`). Compteur PARTAGÉ en base
 * (`consommer_quota`, sql/135) — une `Map` locale ne limiterait rien sur
 * plusieurs instances.
 */
const limiteur = createRateLimiter({
  max: 12,
  window: '60 s',
  prefix: 'geo:rl:zones-risque',
});

const CorpsSchema = z.object({
  /** Le profil sous sa forme codée (`lib/risques/code-profil.ts`). */
  profil: z.string().min(3).max(128),
  /**
   * Natures de risque retenues. Vide = toutes.
   *
   * ⚠ Elles entrent dans la CLÉ DE CACHE, pas seulement dans le calcul : depuis
   * sql/220 la géométrie dépend du filtre, et deux vues qui n'en diffèrent que
   * par lui partageraient sinon une entrée — la première construite servirait
   * ses zones à la seconde, sous la légende de la seconde.
   */
  natures: z.array(z.string().max(120)).max(30).optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const corps = await lireCorps(request, CorpsSchema);
  // `lireCorps` ne lève jamais et rend un message en français : un corps
  // illisible répond 400 au lieu du 500 que produirait `await request.json()`.
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  /*
   * Le profil est relu et REVALIDÉ côté serveur, jamais accepté sur parole : le
   * code vient du client, et un anneau de 50 km passerait la syntaxe tout en
   * demandant un tampon que le pré-calcul ne couvre pas.
   */
  const profil = profilDepuisCode(corps.valeur.profil);
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

  /*
   * On recalcule le code à partir du profil NORMALISÉ plutôt que de reprendre
   * celui reçu. Les deux coïncident presque toujours — mais « presque » suffit
   * à créer deux entrées de cache pour une seule question, et la couche
   * demanderait alors des tuiles sous une clé que rien n'a construite.
   */
  const natures = corps.valeur.natures ?? [];
  /*
   * ⚠ La clé porte le profil ET les natures, par la MÊME fonction que la route
   * de tuiles — c'est la seule chose qui garantisse que la couche demande des
   * tuiles sous la clé qui vient d'être construite.
   *
   * Sans nature retenue, la clé est celle du profil seul : les caches bâtis
   * avant ce filtre restent valides, et rien n'est à reconstruire.
   */
  const code = codeZonesRisque(codeProfil(profil), natures);

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  const { data: existant, error: erreurLecture } = await supabase
    .from('zones_risque_cache')
    .select('classe, surface_km2')
    .eq('profil_code', code);

  if (erreurLecture) {
    console.error('[risques/zones/preparer] lecture :', erreurLecture.message);
    return NextResponse.json({ error: 'Cache des zones illisible.' }, { status: 500 });
  }

  if (existant && existant.length > 0) {
    return NextResponse.json({
      profil: code,
      classes: existant.length,
      deja_construit: true,
      surface_km2: existant.reduce((t, c) => t + Number(c.surface_km2 ?? 0), 0),
    });
  }

  const { data, error } = await supabase.rpc('construire_zones_risque', {
    p_profil: toJson(profil),
    p_code: code,
    p_natures: (natures.length > 0 ? natures : null) as never,
  });

  if (error) {
    console.error('[risques/zones/preparer] construction :', error.message);
    return NextResponse.json({ error: 'Construction des zones impossible.' }, { status: 500 });
  }

  const resultat = rpcJson<{ ok: boolean; classes: number; duree_ms: number }>(data);
  if (!resultat?.ok) {
    return NextResponse.json({ error: 'Construction des zones impossible.' }, { status: 500 });
  }

  /*
   * Zéro classe n'est PAS une erreur : un profil dont tous les niveaux sont
   * vides ne dessine rien, ce qui est le comportement attendu. Le dire
   * explicitement évite que la couche attende indéfiniment des tuiles qui ne
   * viendront jamais.
   */
  return NextResponse.json({
    profil: code,
    classes: resultat.classes,
    deja_construit: false,
    duree_ms: resultat.duree_ms,
  });
}
