/**
 * @file app/api/zones/jeux/route.ts
 *
 * GET  — les jeux de zones de l'organisation.
 * POST — enregistre un jeu et le construit (géométries + codes postaux).
 *
 * ── CE QU'UN JEU DE ZONES EST ─────────────────────────────────────────────
 *
 * Le maillon qui manquait : un profil de rayons figé en objet réutilisable,
 * avec ses poids par classe et son mode de plan. C'est ce qu'une campagne
 * reçoit comme PLAN géographique — et sans lui, la campagne de démonstration
 * du 2026-09-19 a produit 2 000 codes postaux sans `planned_share`, donc un
 * score d'alignement de 100/100 qui ne mesurait rien.
 *
 * ── POURQUOI LA CONSTRUCTION EST SYNCHRONE ───────────────────────────────
 *
 * Mesuré le 2026-09-20 : **21,3 s** pour 7 classes et 1 942 codes postaux sur
 * la France entière. C'est long pour une requête, mais c'est un geste rare —
 * on enregistre un jeu, on ne le recalcule pas à chaque clic — et le rendre
 * asynchrone imposerait une table de jobs et un écran de suivi pour vingt
 * secondes.
 *
 * ⚠ Si le temps devait doubler, c'est ce raisonnement qu'il faudrait refaire,
 * pas le délai qu'il faudrait allonger.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { JeuDeZonesSchema, normaliserJeu, codeJeu } from '@/lib/zones/jeu';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute : chaque enregistrement déclenche une construction de ~21 s qui
 * croise 883 451 carreaux. Même ordre que `geo:rl:qualite-donnees`, pour la
 * même raison — le quota protège un budget d'I/O, pas un caprice.
 */
const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:zone-sets',
});

const CorpsSchema = z.object({
  /**
   * Le nom n'est exigé qu'à l'enregistrement. Un BROUILLON d'atelier n'en a
   * pas : on règle, on compare, on décide, et le nom vient en dernier.
   */
  nom: z.string().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  /**
   * `true` construit sans enregistrer. Le jeu reste hors de la liste, et un
   * brouillon déjà construit pour le MÊME profil est rendu tel quel : re-régler
   * deux fois le même profil ne doit pas coûter deux fois 21 s.
   */
  brouillon: z.boolean().optional(),
  jeu: JeuDeZonesSchema,
});

const MESSAGES: Record<string, string> = {
  jeu_introuvable: 'Ce jeu de zones n’existe pas.',
  filtre_nature_non_supporte:
    'Le filtre par nature de risque n’est pas encore applicable à un jeu de zones : '
    + 'le pré-calcul des distances porte toutes les natures. Retirez le filtre, ou '
    + 'construisez le jeu sur l’ensemble des natures.',
  precalcul_absent:
    'Les distances par carreau n’ont pas encore été construites. '
    + 'Elles se calculent une fois après chaque import de sites à risque.',
  /*
   * ⚠ Distinct de `precalcul_absent`, et la distinction n'est pas de style :
   * aucune construction ne rendra un territoire que l'INSEE ne carroie pas.
   * Sans ce refus, l'atelier enregistrait un jeu VIDE — zéro classe, zéro
   * code postal — qu'une campagne pouvait recevoir comme plan, et qui ne
   * diffusait alors nulle part sans que rien le signale.
   */
  territoire_non_carroye:
    'L’INSEE ne publie pas de carroyage à 200 m pour ce département : un jeu de '
    + 'zones n’y retiendrait aucun code postal. Les sites y restent visibles sur '
    + 'la carte, mais leur population exposée n’est pas mesurable.',
};

/**
 * Retire un jeu qui n'a pas pu être construit.
 *
 * ⚠ L'erreur de la suppression est LUE. `supabase-js` ne lève pas, il rend
 * `{ error }` : une suppression ratée passerait inaperçue et laisserait un jeu
 * fantôme que la liste afficherait sans qu'il serve à rien — un objet qu'on ne
 * peut ni utiliser ni comprendre. C'est la règle de `CLAUDE.md`, et elle vaut
 * autant pour un rollback que pour une suppression demandée.
 */
async function retirerJeu(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<void> {
  const { error } = await supabase.from('zone_sets').delete().eq('id', id);
  if (error) {
    console.error(
      `[zones/jeux] jeu ${id} non construit ET non supprime : ${error.message}. `
      + `Il reste en base sans geometrie.`,
    );
  }
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('zone_sets')
    .select('id, nom, description, version, created_at, construit_le, '
      + 'population_exposee, n_cp_retenus, taux_utile, mode_plan, seuil_couverture_cp')
    .eq('org_id', profile.organization_id)
    // Les brouillons d'atelier ne sont pas des jeux : ils n'ont pas de nom, ils
    // se purgent seuls, et les lister ferait croire à une bibliothèque pleine
    // d'objets que personne n'a créés.
    .eq('brouillon', false)
    .order('created_at', { ascending: false })
    // Borne écrite, et pas seulement par prudence : une liste présentée comme
    // exhaustive alors qu'elle est tronquée est un mensonge silencieux.
    // 200 jeux dans une organisation serait déjà un symptôme.
    .limit(200);

  if (error) {
    console.error('[zones/jeux] liste :', error.message);
    return NextResponse.json({ error: 'Liste des jeux indisponible.' }, { status: 500 });
  }

  return NextResponse.json({ jeux: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const corps = await lireCorps(request, CorpsSchema);
  // `lireCorps` ne lève jamais et rend un message français : un corps illisible
  // répond 400 au lieu du 500 que produirait `await request.json()`.
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  /*
   * Le jeu est RENORMALISÉ côté serveur, jamais accepté sur parole. Le client
   * envoie ce qu'il affiche ; le serveur décide ce qu'il stocke. Sans cette
   * étape, deux jeux équivalents mais saisis dans un ordre différent auraient
   * deux `profil_hash`, donc deux constructions de 21 s pour une seule
   * question.
   */
  let jeu;
  try {
    jeu = normaliserJeu(corps.valeur.jeu);
  } catch {
    return NextResponse.json(
      { error: 'Jeu de zones invalide : vérifiez les rayons, les poids et le seuil.' },
      { status: 400 },
    );
  }

  const brouillon = corps.valeur.brouillon === true;
  if (!brouillon && !corps.valeur.nom) {
    return NextResponse.json(
      { error: 'Donnez un nom au jeu de zones.' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const empreinte = codeJeu(jeu);

  /*
   * Un brouillon DÉJÀ construit pour ce profil est rendu tel quel, AVANT de
   * consommer le quota : l'atelier revient souvent sur un profil qu'il vient
   * de régler, et refaire 21 s de calcul pour un résultat identique serait
   * aussi inutile que coûteux. L'index unique partiel
   * `idx_zone_sets_brouillon_unique` (sql/215) garantit qu'il n'y en a qu'un.
   */
  if (brouillon) {
    const { data: deja, error: erreurBrouillon } = await supabase
      .from('zone_sets')
      .select('id, version, n_cp_retenus, taux_utile, population_exposee, seuil_couverture_cp')
      .eq('org_id', profile.organization_id)
      .eq('profil_hash', empreinte)
      .eq('brouillon', true)
      .maybeSingle();

    if (erreurBrouillon) {
      console.error('[zones/jeux] brouillon :', erreurBrouillon.message);
      return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
    }
    if (deja) {
      return NextResponse.json({
        id: deja.id,
        version: deja.version,
        deja_construit: true,
        retenus: deja.n_cp_retenus,
        taux_utile: deja.taux_utile,
        population_exposee: deja.population_exposee,
      });
    }
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  /*
   * La version : un jeu de même nom dans la même organisation est une NOUVELLE
   * version, jamais un écrasement. Une campagne fige la version au
   * rattachement — écraser ferait changer le plan sous une campagne en vol.
   */
  const { data: existants, error: erreurVersion } = await supabase
    .from('zone_sets')
    .select('version')
    .eq('org_id', profile.organization_id)
    .eq('nom', corps.valeur.nom ?? '')
    .order('version', { ascending: false })
    .limit(1);

  if (erreurVersion) {
    console.error('[zones/jeux] version :', erreurVersion.message);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
  const version = (existants?.[0]?.version ?? 0) + 1;

  const { data: cree, error: erreurCreation } = await supabase
    .from('zone_sets')
    .insert({
      // Un brouillon porte un nom vide plutôt que `null` : la colonne est
      // `not null`, et un nom vide se distingue d'un nom oublié.
      nom: corps.valeur.nom ?? '',
      description: corps.valeur.description ?? null,
      brouillon,
      org_id: profile.organization_id,
      created_by: profile.id,
      version,
      profil: toJson(jeu.profil),
      cible: jeu.cible,
      gravites: jeu.gravites,
      natures: jeu.natures,
      modes: jeu.modes,
      territoire: jeu.territoire,
      mode_plan: jeu.mode_plan,
      seuil_couverture_cp: jeu.seuil_couverture_cp,
      poids: toJson(jeu.poids),
      profil_hash: empreinte,
    })
    .select('id')
    .single();

  if (erreurCreation || !cree) {
    console.error('[zones/jeux] creation :', erreurCreation?.message);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('construire_zone_set', {
    p_zone_set_id: cree.id,
  });

  if (error) {
    console.error('[zones/jeux] construction :', error.message);
    await retirerJeu(supabase, cree.id);
    return NextResponse.json({ error: 'Construction du jeu impossible.' }, { status: 500 });
  }

  const resultat = rpcJson<{
    ok: boolean; error?: string; classes: number; codes_postaux: number;
    retenus: number; population_exposee: number; taux_utile: number | null;
    duree_ms: number;
  }>(data);

  if (!resultat?.ok) {
    await retirerJeu(supabase, cree.id);
    return NextResponse.json(
      { error: MESSAGES[resultat?.error ?? ''] ?? 'Construction du jeu impossible.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ id: cree.id, version, ...resultat }, { status: 201 });
}
