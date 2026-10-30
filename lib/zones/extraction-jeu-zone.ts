/**
 * @file lib/zones/extraction-jeu-zone.ts — l'extraction d'un jeu de ZONE (lot 5, T8 ; arbitrages A-2, A-11). Appelé
 * par `POST /api/zones/jeux/[id]/extractions` quand le jeu est de type `zone` (le jeu risque garde son chemin).
 *
 * LE SERVEUR REJOUE TOUT (Review Focus 3). Le client n'envoie que l'origine et un commentaire ; les unités de chaque
 * plateforme sont recalculées ici à partir du jeu ENREGISTRÉ (zone, cible, mode de plan, choix par plateforme) :
 * - maille EXACTE pour la recette (`exactitude`, A-6 ; ruling du contrôleur, relecture T8) : la géométrie de la
 *   RECETTE est figée, sans calcul ni seuil — le polygone (la forme est copiée par la RPC), LE cercle d'un
 *   `rayon_point` (si le rayon choisi est absent ou égal à celui de la recette), la LISTE d'une recette
 *   `codes_postaux` au CP ; résumé à zéro perte (`resumeExact`), chiffré par la population de la zone (`forme`) ;
 * - maille territoriale calculée (`cp`, `commune`, `departement`, `iris`) : `couverture_zone` (servie du cache tant
 *   que la zone et la base n'ont pas changé) puis `appliquerSeuil` — la MÊME fonction que l'écran (A-5) ; toutes les
 *   unités touchées partent, marquées `retenu` par `estRetenue` ;
 * - cercle calculé : `paver_cercles` aux limites de la plateforme (seules les cellules retenues sont rendues).
 * Les conversions sont SÉQUENTIELLES (jamais en parallèle : chacune peut lire ≈ 100 000 accès), et un découpage lu
 * pour une plateforme sert les suivantes (deux plateformes au CP ne lisent la couverture qu'une fois).
 *
 * LE PLAN CP (décision du contrôleur, sql/278). Chaque plateforme au CP garde SES codes postaux dans les unités ; le
 * plan de `zone_set_extraction_cp` est calculé au seuil le PLUS BAS des plateformes au CP (leur sur-ensemble), ou sur
 * la liste de la recette quand le CP est exact (toutes les plateformes au CP le sont alors : même recette) —
 * `planCpDeZone` (`plan-jeu-zone.ts`).
 *
 * Une plateforme calculée qui ne retient AUCUNE unité refuse l'extraction (422) : un plan figé qui n'achète rien pour
 * une plateforme choisie se lirait comme un plan valable.
 */
import { NextResponse } from 'next/server';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { formaterNombre } from '@/lib/format/nombre';
import { MESSAGES_REFUS_COUVERTURE, MESSAGE_ZONE_PAYS_PLATEFORMES, repondreCouverture, type LigneCouverture } from './couverture';
import {
  MESSAGES_CONVERSION, appliquerSeuil, estRetenue, exactitude, resumeExact, verifierLimites, type Avertissement, type Resume,
} from './conversion';
import { lireRegles, paverPourPlateforme, refusDuChoix } from './conversion-serveur';
import { MESSAGE_JEU_INTROUVABLE, OU_SE_GERE } from './charger-jeu';
import type { MembresParCanonique } from './plan';
import { planCpDeZone } from './plan-jeu-zone';
import { lireGroupesCp } from './groupes';
import { lireRecette } from './recette-schema';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from './recette';

type ClientAdmin = ReturnType<typeof createAdminClient>;
type LigneJeu = Tables<'zone_sets'>;
type ModePlan = 'pondere' | 'exclusif';

const ECHEC = 'Extraction impossible.';

/** Le choix d'une plateforme, tel que `zone_set_plateformes` l'enregistre. */
interface Choix { plateforme: string; maille: string; seuil: number; rayon_m: number | null }

/** Une unité telle que `creer_extraction_jeu_zone` la reçoit (sql/278) ; un cercle ou le polygone n'a pas de code. */
interface Unite {
  plateforme: string; maille: string; retenu: boolean;
  code?: string; nom?: string | null; lon?: number; lat?: number; rayon_m?: number;
  pop_en_zone?: number; pop_totale?: number | null; part?: number | null;
}

/**
 * Le bilan d'une plateforme, figé dans `zone_set_extractions.plateformes` (la RPC y ajoute maille, seuil, rayon).
 * Les compteurs n'ont pas le même sens selon la maille, d'où des champs distincts :
 * - `n_unites` : ce qui est ACHETÉ — territoires retenus, cercles retenus, codes de la liste, ou 1 (polygone, cercle
 *   de la recette) ;
 * - `n_touchees` (maille territoriale calculée) : territoires touchés par la zone, retenus ou non ;
 * - `n_candidates` (cercles calculés) : cellules hexagonales du pavage examinées — pas des territoires.
 */
interface ResumePlateforme {
  plateforme: string; exacte: boolean; n_unites: number; avertissements: Avertissement[];
  n_touchees?: number; n_candidates?: number; population: number; surface_km2?: number;
  couverte: number; achetee: number; manques: number; hors_zone: number; taux_utile: number | null;
}

type Echec = { ok: false; reponse: NextResponse };
type Issue = { ok: true; unites: Unite[]; resume: ResumePlateforme } | Echec;

/** Ce que `couverture_zone` rend d'utile ici (`lignes` vide pour le découpage `forme`). */
interface Couverture { population: number; surface_km2: number; lignes: LigneCouverture[] }

/** Ce que `paver_cercles` rend d'utile ici. */
interface Pavage {
  n_candidates: number; n_cercles: number; population: number; couverte: number; manques: number; hors_zone: number;
  achetee: number; taux_utile: number | null;
  cercles: { lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }[];
}

const erreur = (message: string, status: number): Echec => ({ ok: false, reponse: NextResponse.json({ error: message }, { status }) });

function panne(contexte: string, detail: unknown): Echec {
  console.error(`[zones/extractions] ${contexte} :`, detail instanceof Error ? detail.message : detail);
  return erreur(ECHEC, 500);
}

/** Un refus de RPC (déjà traduit par `repondreCouverture`) préfixé de la plateforme qui l'a provoqué, même statut. */
async function refusDe(plateforme: string, reponse: NextResponse): Promise<Echec> {
  const corps = (await reponse.json()) as Record<string, unknown>;
  return {
    ok: false,
    reponse: NextResponse.json({ ...corps, plateforme, error: `${plateforme} — ${String(corps.error)}` }, { status: reponse.status }),
  };
}

const aucuneUnite = (c: Choix) =>
  erreur(`${c.plateforme} — aucune unité retenue au seuil de ${formaterNombre(c.seuil)} % : baissez le seuil ou changez de maille.`, 422);

/** Le contexte d'une conversion : le jeu, la recette de sa zone (pour l'exactitude), les lectures mémorisées. */
interface Contexte {
  supabase: ClientAdmin; jeu: LigneJeu; recette: Recette | null;
  /** Un découpage lu pour une plateforme sert les suivantes (et le plan CP). */
  couvertures: Map<string, Couverture>;
}

const estEchec = (v: Couverture | Echec): v is Echec => 'ok' in v;

/** La couverture d'un découpage, lue une fois par extraction ; un refus est préfixé de la plateforme qui l'a demandée. */
async function lireCouverture(ctx: Contexte, plateforme: string, decoupage: string): Promise<Couverture | Echec> {
  const deja = ctx.couvertures.get(decoupage);
  if (deja) return deja;
  const r = await ctx.supabase.rpc('couverture_zone', {
    p_zone_id: ctx.jeu.custom_geo_zone_id ?? '', p_org_id: ctx.jeu.org_id, p_cible: ctx.jeu.cible, p_decoupage: decoupage,
  });
  const o = rpcJson<Couverture & { refus?: string }>(r.data);
  if (r.error || !o || o.refus !== undefined || typeof o.population !== 'number' || !Array.isArray(o.lignes)) {
    return refusDe(plateforme, repondreCouverture(r, MESSAGES_REFUS_COUVERTURE, 'zones/extractions couverture', ECHEC));
  }
  const couverture = { population: o.population, surface_km2: o.surface_km2, lignes: o.lignes };
  ctx.couvertures.set(decoupage, couverture);
  return couverture;
}

/**
 * Une maille EXACTE : la géométrie de la recette, sans calcul ni seuil. Le résumé est celui de la zone telle quelle
 * (`resumeExact` : couverte = achetée = population, aucune perte), chiffré par le découpage `forme`.
 */
async function convertirExacte(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  const forme = await lireCouverture(ctx, c.plateforme, 'forme');
  if (estEchec(forme)) return forme;
  const r = ctx.recette;
  const toute = { pop_en_zone: forme.population, pop_totale: forme.population, part: 100, retenu: true };
  let unites: Unite[];
  if (c.maille === 'cp' && r?.type === 'codes_postaux') {
    // La liste de la recette, seuil ignoré ; leurs populations sont portées par le plan CP (par canonique).
    unites = [...new Set(r.codes)].map((code) => ({ plateforme: c.plateforme, maille: 'cp', code, retenu: true }));
  } else if (c.maille === 'cercle' && r?.type === 'rayon_point') {
    unites = [{ plateforme: c.plateforme, maille: 'cercle', lon: r.lon, lat: r.lat, rayon_m: r.rayon_m, ...toute }];
  } else {
    // Le polygone : une unité sans code, la forme est copiée par la RPC.
    unites = [{ plateforme: c.plateforme, maille: 'polygone', ...toute }];
  }
  const bilan = resumeExact(forme.population, forme.surface_km2, unites.length);
  return { ok: true, unites, resume: { ...bilan, plateforme: c.plateforme, avertissements: verifierLimites(bilan, regle) } };
}

/** Une maille territoriale calculée : la couverture du découpage, puis le seuil. */
async function convertirTerritoire(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
  const couverture = await lireCouverture(ctx, c.plateforme, c.maille);
  if (estEchec(couverture)) return couverture;
  const bilan = appliquerSeuil(couverture.lignes, couverture.population, c.seuil);
  if (bilan.n_unites === 0) return aucuneUnite(c);
  return {
    ok: true,
    unites: couverture.lignes.map((l) => ({
      plateforme: c.plateforme, maille: c.maille, code: l.code, nom: l.nom,
      pop_en_zone: l.pop_en_zone, pop_totale: l.pop_totale, part: l.part, retenu: estRetenue(l, c.seuil),
    })),
    resume: { ...bilan, plateforme: c.plateforme, population: couverture.population, avertissements: verifierLimites(bilan, regle) },
  };
}

/** Le cercle calculé : `paver_cercles` aux limites de la plateforme ; seules les cellules retenues sont rendues. */
async function convertirCercles(ctx: Contexte, c: Choix, regle: PlateformeGeo): Promise<Issue> {
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
  const chiffres = {
    n_unites: o.n_cercles, couverte: o.couverte, achetee: o.achetee, manques: o.manques, hors_zone: o.hors_zone, taux_utile: o.taux_utile,
  };
  // `verifierLimites` lit un `Resume` ; `n_touchees` y vaut les cellules, et le résumé figé le nomme `n_candidates`.
  const bilan: Resume = { exacte: false, n_touchees: o.n_candidates, ...chiffres };
  return {
    ok: true,
    unites: o.cercles.map((k) => ({
      plateforme: c.plateforme, maille: 'cercle', lon: k.lon, lat: k.lat, rayon_m,
      pop_en_zone: k.pop_en_zone, pop_totale: k.pop_totale, part: k.part, retenu: true,
    })),
    resume: {
      ...chiffres, plateforme: c.plateforme, exacte: false, n_candidates: o.n_candidates, population: o.population,
      avertissements: verifierLimites(bilan, regle),
    },
  };
}

/** Une plateforme : la règle relue (la table a pu changer depuis l'enregistrement), l'exactitude, puis sa maille. */
function convertir(ctx: Contexte, c: Choix, regles: readonly PlateformeGeo[]): Promise<Issue> | Issue {
  const regle = regles.find((l) => l.plateforme === c.plateforme && l.maille === c.maille);
  const refus = refusDuChoix(c, regle);
  if (refus || !regle) return erreur(`${refus} Réglez à nouveau le jeu avant d’extraire.`, 422);
  // Sans recette lisible (zone d'avant le lot 3), seule la forme exacte est exacte.
  const exacte = ctx.recette
    ? exactitude(ctx.recette, regle.maille, regle, c.rayon_m ?? undefined) === 'exacte'
    : regle.maille === 'polygone';
  if (exacte) return convertirExacte(ctx, c, regle);
  return c.maille === 'cercle' ? convertirCercles(ctx, c, regle) : convertirTerritoire(ctx, c, regle);
}

/**
 * Les messages des codes métier de `creer_extraction_jeu_zone` : un code brut ne dit rien à qui lit l'écran. Les deux
 * premiers sont ceux du chargeur (`charger-jeu.ts`) : la même situation se dit par la même phrase.
 */
const MESSAGES_RPC: Record<string, string> = {
  jeu_introuvable: MESSAGE_JEU_INTROUVABLE,
  type_non_zone: OU_SE_GERE.risque,
  plan_vide: 'Ce jeu ne produit aucun plan : il n’y a rien à extraire.',
  unites_hors_choix: 'Le choix des plateformes a changé pendant l’extraction : relancez-la.',
};

/** Le plan CP, si une plateforme achète au CP : groupes indiscernables, couverture CP, liste exacte éventuelle. */
async function planCp(ctx: Contexte, auCp: readonly Choix[]): Promise<ReturnType<typeof planCpDeZone> | null | Echec> {
  if (auCp.length === 0) return null;
  let groupes: MembresParCanonique;
  try {
    groupes = await lireGroupesCp(ctx.supabase);
  } catch (e) {
    return panne('groupes de CP', e);
  }
  // Déjà lue par la boucle pour un CP calculé ; pour un CP exact, lue ici (le plan a besoin des populations).
  const cp = await lireCouverture(ctx, auCp[0].plateforme, 'cp');
  if (estEchec(cp)) return cp;
  const r = ctx.recette;
  const liste = r?.type === 'codes_postaux' && exactitude(r, 'cp') === 'exacte' ? r.codes : undefined;
  return planCpDeZone(cp.lignes, Math.min(...auCp.map((c) => c.seuil)), ctx.jeu.mode_plan as ModePlan, groupes, liste);
}

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
  const lue = lireRecette(zoneLue.data.recette);
  // Une zone pays (sql/296) : le ciblage France natif des plateformes n'est pas encore là (A-5) — refusée avant toute
  // autre lecture (règles, couverture).
  if (lue.ok && lue.recette.type === 'pays') return erreur(MESSAGE_ZONE_PAYS_PLATEFORMES, 422).reponse;
  const choix: Choix[] = (choixLus.data ?? []).map((c) => ({ ...c, seuil: Number(c.seuil) }));
  if (choix.length === 0) return erreur('Ce jeu n’a aucune plateforme : il n’y a rien à extraire.', 409).reponse;

  let regles: PlateformeGeo[];
  try {
    regles = await lireRegles(supabase, choix.map((c) => c.plateforme));
  } catch (e) {
    return panne('règles', e).reponse;
  }
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

  const plan = await planCp(ctx, choix.filter((c) => c.maille === 'cp'));
  if (plan && 'ok' in plan) return plan.reponse;

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
