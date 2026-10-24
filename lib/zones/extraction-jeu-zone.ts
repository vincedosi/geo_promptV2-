/**
 * @file lib/zones/extraction-jeu-zone.ts — l'extraction d'un jeu de ZONE (lot 5, T8 ; arbitrages A-2, A-11). Appelé
 * par `POST /api/zones/jeux/[id]/extractions` quand le jeu est de type `zone` (le jeu risque garde son chemin).
 *
 * LE SERVEUR REJOUE TOUT (Review Focus 3). Le client n'envoie que l'origine et un commentaire ; les unités de chaque
 * plateforme sont recalculées ici à partir du jeu ENREGISTRÉ (zone, cible, mode de plan, choix par plateforme) :
 * - maille territoriale (`cp`, `commune`, `departement`, `iris`) : `couverture_zone` (servie du cache tant que la zone
 *   et la base n'ont pas changé) puis `appliquerSeuil` — la MÊME fonction que l'écran (A-5) ; toutes les unités
 *   touchées partent, marquées `retenu` par `estRetenue` ;
 * - cercle : `paver_cercles` aux limites de la plateforme (seules les cellules retenues sont rendues) ;
 * - polygone : rien à calculer, une unité sans code — la forme de la zone est copiée par la RPC (`forme`).
 * Les conversions sont SÉQUENTIELLES (jamais en parallèle : chacune peut lire ≈ 100 000 accès), et un découpage lu
 * pour une plateforme sert les suivantes (deux plateformes au CP ne lisent la couverture qu'une fois).
 *
 * LE PLAN CP (décision du contrôleur, sql/278). Chaque plateforme au CP garde SES codes postaux dans les unités ; le
 * plan de `zone_set_extraction_cp` est calculé au seuil le PLUS BAS des plateformes au CP (leur sur-ensemble), par
 * `genererPlanCp` (classe `zone`, poids 1, `mode_plan` du jeu) — la fonction qui produit aussi le plan poussé au DSP.
 * Un code postal indiscernable (`cp_groupe`) est acheté avec tout son groupe, le multiplicateur DIVISÉ par le nombre
 * de membres (piège 2 de `project_conversion_cp_phases` : le même multiplicateur sur quatre lignes donnerait à Nantes
 * quatre fois sa part).
 *
 * Une plateforme qui ne retient AUCUNE unité refuse l'extraction (422) : un plan figé qui n'achète rien pour une
 * plateforme choisie se lirait comme un plan valable.
 */
import { NextResponse } from 'next/server';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { HORS_ZONE } from '@/lib/risques/affectation';
import { formaterNombre } from '@/lib/format/nombre';
import { MESSAGES_REFUS_COUVERTURE, repondreCouverture, type LigneCouverture } from './couverture';
import { MESSAGES_CONVERSION, appliquerSeuil, estRetenue, exactitude, verifierLimites, type Avertissement, type ResumeMaille } from './conversion';
import { lireRegles, paverPourPlateforme, refusDuChoix } from './conversion-serveur';
import { genererPlanCp, type CpZone, type MembresParCanonique } from './plan';
import { lireGroupesCp } from './groupes';
import { lireRecette } from './recette-schema';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from './recette';

type ClientAdmin = ReturnType<typeof createAdminClient>;
type LigneJeu = Tables<'zone_sets'>;
type ModePlan = 'pondere' | 'exclusif';

/** La classe unique des codes postaux retenus d'un jeu de zone (`MOTIF_CLASSE`) ; poids 1 (`poidsDeClasse`). */
const CLASSE_ZONE = 'zone';

const ECHEC = 'Extraction impossible.';

/** Le choix d'une plateforme, tel que `zone_set_plateformes` l'enregistre. */
interface Choix { plateforme: string; maille: string; seuil: number; rayon_m: number | null }

/** Une unité telle que `creer_extraction_jeu_zone` la reçoit (sql/278) ; un cercle ou le polygone n'a pas de code. */
interface Unite {
  plateforme: string; maille: string; retenu: boolean;
  code?: string; nom?: string | null; lon?: number; lat?: number; rayon_m?: number;
  pop_en_zone?: number; pop_totale?: number | null; part?: number | null;
}

/** Le bilan d'une plateforme, figé dans `zone_set_extractions.plateformes` (la RPC y ajoute maille, seuil, rayon). */
type ResumePlateforme = { plateforme: string; exacte: boolean; n_unites: number; avertissements: Avertissement[] }
  & Partial<Omit<ResumeMaille, 'exacte' | 'n_unites'> & { population: number }>;

type Issue = { ok: true; unites: Unite[]; resume: ResumePlateforme } | { ok: false; reponse: NextResponse };

/** Ce que `couverture_zone` rend d'utile ici. */
interface Couverture { population: number; lignes: LigneCouverture[] }

/** Ce que `paver_cercles` rend d'utile ici. */
interface Pavage {
  n_candidates: number; n_cercles: number; population: number; couverte: number; manques: number; hors_zone: number;
  achetee: number; taux_utile: number | null; motif_vide: string | null;
  cercles: { lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }[];
}

const erreur = (message: string, status: number) => ({ ok: false as const, reponse: NextResponse.json({ error: message }, { status }) });

function panne(contexte: string, detail: unknown) {
  console.error(`[zones/extractions] ${contexte} :`, detail instanceof Error ? detail.message : detail);
  return erreur(ECHEC, 500);
}

/** Un refus de RPC (déjà traduit par `repondreCouverture`) préfixé de la plateforme qui l'a provoqué, même statut. */
async function refusDe(plateforme: string, reponse: NextResponse) {
  const corps = (await reponse.json()) as Record<string, unknown>;
  return {
    ok: false as const,
    reponse: NextResponse.json({ ...corps, plateforme, error: `${plateforme} — ${String(corps.error)}` }, { status: reponse.status }),
  };
}

const aucuneUnite = (c: Choix) =>
  erreur(`${c.plateforme} — aucune unité retenue au seuil de ${formaterNombre(c.seuil)} % : baissez le seuil ou changez de maille.`, 422);

/**
 * Le plan CP d'un jeu de zone : `genererPlanCp` sur les CP de la couverture, retenus au seuil donné. Les populations
 * et la part sont celles du code CANONIQUE, `null` sur un membre de groupe (sa population est portée en entier par la
 * ligne canonique ; un 0 se lirait « personne »). Pure : testée sans base.
 */
export function planCpDeZone(lignes: readonly LigneCouverture[], seuil: number, mode_plan: ModePlan, groupes: MembresParCanonique) {
  const cps: CpZone[] = lignes.map((l) => {
    const retenu = estRetenue(l, seuil);
    return { code_postal: l.code, classe: retenu ? CLASSE_ZONE : HORS_ZONE, pop_en_zone: l.pop_en_zone, pop_totale: l.pop_totale ?? 0, retenu };
  });
  const plan = genererPlanCp(cps, { mode_plan, poids: {} }, groupes);
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const canoniqueDe = new Map<string, string>();
  for (const [canonique, membres] of groupes) for (const m of membres) canoniqueDe.set(m, canonique);

  return {
    lignes: plan.lignes.map((l) => {
      const canonique = canoniqueDe.get(l.code_postal) ?? l.code_postal;
      const source = l.code_postal === canonique ? parCode.get(canonique) : undefined;
      return {
        code_postal: l.code_postal, code_canonique: canonique, classe: l.classe, retenu: l.retenu, multiplicateur: l.multiplicateur,
        pop_en_zone: source?.pop_en_zone ?? null, pop_totale: source?.pop_totale ?? null, part_en_zone: source?.part ?? null,
      };
    }),
    resume: {
      n_cp: cps.length,
      n_retenus: plan.n_retenus,
      taux_utile: plan.taux_utile,
      part_plan_en_zone: plan.part_plan_en_zone,
      population_exposee: cps.filter((c) => c.retenu).reduce((t, c) => t + c.pop_en_zone, 0),
    },
  };
}

/** Le contexte d'une conversion : le jeu, la recette de sa zone (pour l'exactitude), le cache des découpages. */
interface Contexte { supabase: ClientAdmin; jeu: LigneJeu; recette: Recette | null; couvertures: Map<string, Couverture> }

/** Une maille territoriale : la couverture du découpage (lue une fois par extraction), puis le seuil. */
async function convertirTerritoire(ctx: Contexte, c: Choix, regle: PlateformeGeo, exacte: boolean): Promise<Issue> {
  let couverture = ctx.couvertures.get(c.maille);
  if (!couverture) {
    const r = await ctx.supabase.rpc('couverture_zone', {
      p_zone_id: ctx.jeu.custom_geo_zone_id ?? '', p_org_id: ctx.jeu.org_id, p_cible: ctx.jeu.cible, p_decoupage: c.maille,
    });
    const o = rpcJson<Couverture & { refus?: string }>(r.data);
    if (r.error || !o || o.refus !== undefined || !Array.isArray(o.lignes)) {
      return refusDe(c.plateforme, repondreCouverture(r, MESSAGES_REFUS_COUVERTURE, 'zones/extractions couverture', ECHEC));
    }
    couverture = { population: o.population, lignes: o.lignes };
    ctx.couvertures.set(c.maille, couverture);
  }
  const bilan = appliquerSeuil(couverture.lignes, couverture.population, c.seuil);
  if (bilan.n_unites === 0) return aucuneUnite(c);
  return {
    ok: true,
    unites: couverture.lignes.map((l) => ({
      plateforme: c.plateforme, maille: c.maille, code: l.code, nom: l.nom,
      pop_en_zone: l.pop_en_zone, pop_totale: l.pop_totale, part: l.part, retenu: estRetenue(l, c.seuil),
    })),
    resume: { ...bilan, plateforme: c.plateforme, exacte, population: couverture.population, avertissements: verifierLimites(bilan, regle) },
  };
}

/** Le cercle : `paver_cercles` aux limites de la plateforme ; seules les cellules retenues sont rendues. */
async function convertirCercles(ctx: Contexte, c: Choix, regle: PlateformeGeo, exacte: boolean): Promise<Issue> {
  // `rayon_m` est posé pour un cercle (CHECK `zsp_rayon_cercle`).
  const rayon_m = c.rayon_m ?? 0;
  const r = await paverPourPlateforme(ctx.supabase, {
    zoneId: ctx.jeu.custom_geo_zone_id ?? '', orgId: ctx.jeu.org_id, cible: ctx.jeu.cible, rayon_m, seuil: c.seuil,
  }, regle);
  const o = rpcJson<Pavage & { refus?: string }>(r.data);
  if (r.error || !o || o.refus !== undefined || !Array.isArray(o.cercles)) {
    return refusDe(c.plateforme, repondreCouverture(r, MESSAGES_CONVERSION, 'zones/extractions cercles', ECHEC, 'Rayon ou seuil hors des bornes du calcul.'));
  }
  if (o.n_cercles === 0) return aucuneUnite(c);
  const bilan: ResumeMaille = {
    exacte: false, n_unites: o.n_cercles, n_touchees: o.n_candidates, couverte: o.couverte, achetee: o.achetee,
    manques: o.manques, hors_zone: o.hors_zone, taux_utile: o.taux_utile,
  };
  return {
    ok: true,
    unites: o.cercles.map((k) => ({
      plateforme: c.plateforme, maille: 'cercle', lon: k.lon, lat: k.lat, rayon_m,
      pop_en_zone: k.pop_en_zone, pop_totale: k.pop_totale, part: k.part, retenu: true,
    })),
    resume: { ...bilan, plateforme: c.plateforme, exacte, population: o.population, avertissements: verifierLimites(bilan, regle) },
  };
}

/** Une plateforme : la règle relue (la table a pu changer depuis l'enregistrement), puis sa maille. */
function convertir(ctx: Contexte, c: Choix, regles: readonly PlateformeGeo[]): Promise<Issue> | Issue {
  const regle = regles.find((l) => l.plateforme === c.plateforme && l.maille === c.maille);
  const refus = refusDuChoix(c, regle);
  if (refus || !regle) return erreur(`${refus} Réglez à nouveau le jeu avant d’extraire.`, 422);
  // Sans recette lisible (zone d'avant le lot 3), seule la forme exacte est exacte.
  const exacte = ctx.recette ? exactitude(ctx.recette, regle.maille, regle) === 'exacte' : regle.maille === 'polygone';
  if (c.maille === 'polygone') {
    return { ok: true, unites: [{ plateforme: c.plateforme, maille: 'polygone', retenu: true }], resume: { plateforme: c.plateforme, exacte, n_unites: 1, avertissements: [] } };
  }
  return c.maille === 'cercle' ? convertirCercles(ctx, c, regle, exacte) : convertirTerritoire(ctx, c, regle, exacte);
}

/** Les messages des codes métier de `creer_extraction_jeu_zone` : un code brut ne dit rien à qui lit l'écran. */
const MESSAGES_RPC: Record<string, string> = {
  jeu_introuvable: 'Ce jeu de zones est introuvable.',
  type_non_zone: 'Ce jeu de zones se gère dans le module risque.',
  plan_vide: 'Ce jeu ne produit aucun plan : il n’y a rien à extraire.',
  unites_hors_choix: 'Le choix des plateformes a changé pendant l’extraction : relancez-la.',
};

/**
 * POST d'une extraction de jeu de zone, APRÈS session, corps, quota et chargement du jeu (la route les fait).
 * 201 la version créée, 200 `deja_extraite` (même contenu qu'une version existante), 409 / 422 / 500 sinon.
 */
export async function extraireJeuZone(
  supabase: ClientAdmin, jeu: LigneJeu, corps: { origine: string; commentaire: string }, userId: string,
): Promise<NextResponse> {
  // Deux lectures légères en parallèle (≤ 3, CLAUDE.md) : les choix, la recette de la zone.
  const [choixLus, zoneLue] = await Promise.all([
    supabase.from('zone_set_plateformes').select('plateforme, maille, seuil, rayon_m').eq('zone_set_id', jeu.id).order('plateforme'),
    supabase.from('custom_geo_zones').select('recette').eq('id', jeu.custom_geo_zone_id ?? '').eq('org_id', jeu.org_id).maybeSingle(),
  ]);
  if (choixLus.error) return panne('choix', choixLus.error.message).reponse;
  // La zone ne peut manquer (clé étrangère `on delete restrict`) : son absence est une anomalie.
  if (zoneLue.error || !zoneLue.data) return panne('zone du jeu', zoneLue.error?.message ?? 'absente').reponse;
  const choix: Choix[] = (choixLus.data ?? []).map((c) => ({ ...c, seuil: Number(c.seuil) }));
  if (choix.length === 0) return erreur('Ce jeu n’a aucune plateforme : il n’y a rien à extraire.', 409).reponse;

  let regles: PlateformeGeo[];
  try {
    regles = await lireRegles(supabase, choix.map((c) => c.plateforme));
  } catch (e) {
    return panne('règles', e).reponse;
  }
  const lue = lireRecette(zoneLue.data.recette);
  const ctx: Contexte = { supabase, jeu, recette: lue.ok ? lue.recette : null, couvertures: new Map() };

  const unites: Unite[] = [];
  const resumes: ResumePlateforme[] = [];
  for (const c of choix) {
    // SÉQUENTIEL, à dessein (en-tête) : une conversion à la fois.
    const issue = await convertir(ctx, c, regles);
    if (!issue.ok) return issue.reponse;
    unites.push(...issue.unites);
    resumes.push(issue.resume);
  }

  const auCp = choix.filter((c) => c.maille === 'cp');
  let plan: ReturnType<typeof planCpDeZone> | null = null;
  if (auCp.length > 0) {
    let groupes: MembresParCanonique;
    try {
      groupes = await lireGroupesCp(supabase);
    } catch (e) {
      return panne('groupes de CP', e).reponse;
    }
    // La couverture CP a été lue par la boucle (au moins une plateforme au CP).
    plan = planCpDeZone(ctx.couvertures.get('cp')?.lignes ?? [], Math.min(...auCp.map((c) => c.seuil)), jeu.mode_plan as ModePlan, groupes);
  }

  const { data: brut, error } = await supabase.rpc('creer_extraction_jeu_zone', {
    p_zone_set_id: jeu.id,
    p_cp: toJson(plan?.lignes ?? []),
    p_unites: toJson(unites),
    p_resume: toJson({ ...(plan?.resume ?? {}), plateformes: resumes }),
    p_origine: corps.origine,
    p_commentaire: corps.commentaire,
    p_created_by: userId,
  });
  if (error) return panne('création', error.message).reponse;
  const data = rpcJson<{ ok: boolean; error?: string; deja_extraite?: boolean }>(brut);
  if (!data?.ok) return erreur(MESSAGES_RPC[data?.error ?? ''] ?? ECHEC, 409).reponse;
  return NextResponse.json(data, { status: data.deja_extraite ? 200 : 201 });
}
