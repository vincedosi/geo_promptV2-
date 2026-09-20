/**
 * @file app/api/zones/jeux/[id]/route.ts
 *
 * GET    — le jeu, ses classes et leurs chiffres.
 * PATCH  — enregistre un brouillon, ou en modifie les réglages.
 * DELETE — retire le jeu (géométries et codes postaux suivent en cascade).
 *
 * ── POURQUOI PATCH NE RECONSTRUIT JAMAIS ─────────────────────────────────
 *
 * Une construction coûte 21,3 s (7 classes, 1 942 codes postaux). Mais ni le
 * nom, ni la description, ni les poids par classe, ni le mode de plan ne
 * changent une géométrie : ils ne décident que de ce qu'on en fait.
 *
 * Le seuil de couverture non plus, et c'est moins évident : il ne fait que
 * trancher, code postal par code postal, à partir de quelle part en zone on
 * achète. `appliquer_seuil_zone_set` (sql/215) le rejoue en 22 ms — mesuré,
 * contre 21,3 s pour une reconstruction.
 *
 * Le SEUL changement qui impose une reconstruction est le profil lui-même, et
 * il passe par `POST /api/zones/jeux`, qui crée alors une nouvelle version.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { lireTout } from '@/lib/supabase/lire-tout';
import { POIDS_MIN, POIDS_MAX, MODES_PLAN, MOTIF_CLASSE } from '@/lib/zones/jeu';

export const dynamic = 'force-dynamic';

/** Au-delà, la lecture des codes postaux échoue plutôt que de rendre un début. */
const PLAFOND_CP = 8000;

/*
 * ⚠ UNE SEULE chaîne littérale, et non une concaténation de trois morceaux.
 * supabase-js déduit le TYPE des lignes rendues de la valeur littérale passée
 * à `.select()` : une concaténation lui donne `string`, il retombe alors sur
 * `GenericStringError` et toute lecture de propriété échoue à la compilation.
 * Le découper pour tenir la largeur de ligne casse donc le typage.
 */
const CHAMPS_JEU = 'id, nom, description, version, brouillon, created_at, construit_le, profil, profil_hash, cible, gravites, natures, modes, territoire, mode_plan, seuil_couverture_cp, poids, population_exposee, n_cp_retenus, taux_utile';

const CorpsSchema = z.object({
  nom: z.string().min(1).max(120).optional(),
  description: z.string().max(600).nullable().optional(),
  mode_plan: z.enum(MODES_PLAN).optional(),
  seuil_couverture_cp: z.number().min(0).max(100).optional(),
  poids: z.record(
    z.string().regex(MOTIF_CLASSE),
    z.number().min(POIDS_MIN).max(POIDS_MAX),
  ).optional(),
  /** Passer un brouillon à l'état enregistré. Jamais l'inverse. */
  enregistrer: z.boolean().optional(),
});

interface LigneCp {
  code_postal: string;
  classe: string;
  pop_en_zone: number | null;
  pop_totale: number | null;
  part_en_zone: number | null;
  retenu: boolean;
}

/**
 * Ce qu'une classe pèse, une fois ses codes postaux regroupés.
 *
 * NON exportée : le client porte sa propre déclaration dans
 * `components/risques/use-jeux-zones.ts`. Deux noms identiques exportés depuis
 * deux modules invitent à importer le mauvais, et une route Next ne devrait de
 * toute façon exporter que ses gestionnaires.
 */
interface ClasseJeu {
  classe: string;
  n_cp: number;
  n_cp_retenus: number;
  population_en_zone: number;
  population_achetee: number;
}

function regrouperParClasse(lignes: LigneCp[]): ClasseJeu[] {
  const par = new Map<string, ClasseJeu>();
  for (const l of lignes) {
    const c = par.get(l.classe) ?? {
      classe: l.classe,
      n_cp: 0,
      n_cp_retenus: 0,
      population_en_zone: 0,
      population_achetee: 0,
    };
    c.n_cp += 1;
    c.population_en_zone += Number(l.pop_en_zone ?? 0);
    if (l.retenu) {
      c.n_cp_retenus += 1;
      c.population_achetee += Number(l.pop_totale ?? 0);
    }
    par.set(l.classe, c);
  }
  // Tri par population visée : la classe qui porte le plus d'habitants se lit
  // en premier, quel que soit l'ordre alphabétique des codes de classe.
  return [...par.values()].sort((a, b) => b.population_en_zone - a.population_en_zone);
}

/**
 * Charge le jeu et vérifie qu'il appartient à l'organisation de l'appelant.
 *
 * ⚠ Le contrôle de propriété est fait ICI et non par RLS : les routes parlent
 * à Supabase par `createAdminClient()`, qui contourne toute policy
 * (`ARCHITECTURE.md` § « RLS — DORMANTES »). Sans ce filtre, connaître
 * l'identifiant d'un jeu suffirait à lire celui d'une autre organisation.
 */
async function chargerJeu(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  orgId: string,
) {
  return supabase
    .from('zone_sets')
    .select(CHAMPS_JEU)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: jeu, error } = await chargerJeu(supabase, id, profile.organization_id);
  if (error) {
    console.error('[zones/jeux/id] lecture :', error.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeu) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }

  let lignes: LigneCp[];
  try {
    ({ lignes } = await lireTout<LigneCp>(
      (de, a) => supabase
        .from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, part_en_zone, retenu')
        .eq('zone_set_id', id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP,
    ));
  } catch (e) {
    /*
     * ⚠ `lireTout` LÈVE plutôt que de rendre un début : PostgREST plafonne
     * toute requête de table à 1 000 lignes CÔTÉ SERVEUR, et un jeu national
     * en porte près de 2 000. Un taux d'utile calculé sur la moitié des codes
     * postaux serait parfaitement plausible, et faux.
     */
    console.error('[zones/jeux/id] codes postaux :', (e as Error).message);
    return NextResponse.json({ error: 'Codes postaux du jeu illisibles.' }, { status: 500 });
  }

  return NextResponse.json(
    { jeu, classes: regrouperParClasse(lignes), codes_postaux: lignes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: jeu, error: erreurLecture } = await chargerJeu(
    supabase, id, profile.organization_id,
  );
  if (erreurLecture) {
    console.error('[zones/jeux/id] PATCH lecture :', erreurLecture.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeu) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }

  const v = corps.valeur;

  if (v.enregistrer && !v.nom && !jeu.nom) {
    return NextResponse.json(
      { error: 'Donnez un nom au jeu de zones avant de l’enregistrer.' },
      { status: 400 },
    );
  }

  /*
   * Le seuil d'abord, et par la RPC : elle réécrit `retenu` code postal par
   * code postal PUIS recalcule `n_cp_retenus` et `taux_utile` dans la même
   * transaction. Écrire le seuil dans l'en-tête sans rejouer les codes postaux
   * laisserait un jeu qui annonce un seuil et en applique un autre.
   */
  if (v.seuil_couverture_cp !== undefined) {
    const { data, error } = await supabase.rpc('appliquer_seuil_zone_set', {
      p_zone_set_id: id,
      p_seuil: v.seuil_couverture_cp,
    });
    if (error) {
      console.error('[zones/jeux/id] seuil :', error.message);
      return NextResponse.json({ error: 'Seuil non appliqué.' }, { status: 500 });
    }
    const r = rpcJson<{ ok?: boolean }>(data);
    if (!r?.ok) {
      return NextResponse.json(
        { error: 'Le seuil doit être une part comprise entre 0 et 100 %.' },
        { status: 400 },
      );
    }
  }

  const maj: Record<string, unknown> = {};
  if (v.nom !== undefined) maj.nom = v.nom;
  if (v.description !== undefined) maj.description = v.description;
  if (v.mode_plan !== undefined) maj.mode_plan = v.mode_plan;
  if (v.poids !== undefined) maj.poids = toJson(v.poids);
  // Un brouillon s'enregistre ; un jeu enregistré ne redevient JAMAIS
  // brouillon — une campagne peut déjà l'avoir reçu comme plan.
  if (v.enregistrer) maj.brouillon = false;

  if (Object.keys(maj).length > 0) {
    const { error } = await supabase.from('zone_sets').update(maj).eq('id', id);
    if (error) {
      console.error('[zones/jeux/id] PATCH :', error.message);
      return NextResponse.json({ error: 'Modification impossible.' }, { status: 500 });
    }
  }

  const { data: apres } = await chargerJeu(supabase, id, profile.organization_id);
  return NextResponse.json({ jeu: apres });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  /*
   * `{ count: 'exact' }` n'est pas décoratif : sans l'option, supabase-js rend
   * `count: null` et la route répondrait « supprimé » pour un identifiant
   * inexistant ou appartenant à une autre organisation — exactement le défaut
   * constaté sur `/api/admin/sources/[id]` (`CLAUDE.md`).
   */
  const { error, count } = await supabase
    .from('zone_sets')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('org_id', profile.organization_id);

  if (error) {
    console.error('[zones/jeux/id] DELETE :', error.message);
    return NextResponse.json({ error: 'Suppression impossible.' }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, supprimes: count });
}
