/**
 * lib/chat/tools/classementTerritoires.ts
 * Outil classement_territoires — « les 10 villes où il y a le plus de X, en
 * volume et en part ». Toute l'agrégation et les garde-fous (indicateur
 * inconnu, tri par part sur un non-effectif, regroupement des arrondissements)
 * vivent dans la RPC `classer_territoires` (sql/150) : cet outil l'appelle,
 * résout un plancher de population par défaut quand il manque, résout des
 * coordonnées pour le clic carte, met en forme le résultat et traduit les
 * exceptions Postgres en messages utilisables — jamais un throw ni un texte
 * brut de RAISE EXCEPTION.
 */

import { createAdminClient }              from '@/lib/auth';
import { logger }                         from '@/lib/logger';
import { IRIS_DB_COLUMNS }                from '@/lib/iris-crawler/db-columns';
import { listerIndicateursClassement }    from './indicateursTerritoires';

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export type Palier         = 'commune' | 'departement';
export type TriClassement  = 'volume' | 'part';
export type ClasseIndicateur = 'effectif' | 'proportion' | 'densite';

// ── Constantes ────────────────────────────────────────────────────────────────

export const LIMITE_MIN    = 1;
export const LIMITE_MAX    = 100; // borne Nano — la RPC la reclame déjà, on la respecte aussi ici
export const LIMITE_DEFAUT = 10;

/**
 * Seuil de population appliqué par défaut à un classement en PART quand
 * l'appelant n'en fournit aucun. Règle produit du sql/150 (incident
 * « Montferrat ») : sans plancher, une commune de 1 720 habitants peut
 * dépasser 50 % sur un indicateur et passer devant Lille — un tri en part
 * sans seuil est du bruit, pas un classement.
 *
 * 20 000 habitants : au-dessus des très petites communes qui saturent une part
 * sur un effectif minuscule (l'exemple mesuré, Montferrat, en compte 1 720),
 * tout en gardant les villes moyennes (Poitiers ~88k, Rouen ~110k) dans le
 * classement — c'est précisément ce que l'exemple du sql/150 vérifie.
 */
export const PLANCHER_POPULATION_PART_DEFAUT = 20_000;

const IRIS_LABELS: Record<string, string> = Object.fromEntries(
  IRIS_DB_COLUMNS.map(c => [c.name, c.label]),
);

// ── Logique pure (testée) ───────────────────────────────────────────────────

/**
 * Borne la limite demandée entre 1 et 100 ; défaut 10 si absente ou non
 * numérique. `null`/`undefined`/`''` valent « non fournie » — pas 0, que
 * `Number()` convertirait sinon en un `p_limite` de 1 (clamp au minimum) au
 * lieu du défaut voulu.
 */
export function resoudreLimite(limiteDemandee: unknown): number {
  if (limiteDemandee === null || limiteDemandee === undefined || limiteDemandee === '') {
    return LIMITE_DEFAUT;
  }
  const n = Number(limiteDemandee);
  if (!Number.isFinite(n)) return LIMITE_DEFAUT;
  return Math.min(LIMITE_MAX, Math.max(LIMITE_MIN, Math.round(n)));
}

export interface ResolutionPlancher {
  plancher:             number;
  applique_par_defaut:  boolean;
}

/**
 * Résout le plancher de population effectivement envoyé à la RPC.
 * Un plancher fourni et positif est toujours respecté tel quel. À défaut, un
 * tri en PART reçoit le plancher par défaut (et le signale) ; un tri en VOLUME
 * reste à 0 (pas de bruit à corriger : le volume brut ne favorise déjà que les
 * grandes communes).
 */
export function resoudrePlancherPopulation(
  tri:              TriClassement,
  plancherDemande:  unknown,
): ResolutionPlancher {
  const n      = Number(plancherDemande);
  const fourni = Number.isFinite(n) && n > 0;
  if (fourni) return { plancher: Math.round(n), applique_par_defaut: false };
  if (tri === 'part') return { plancher: PLANCHER_POPULATION_PART_DEFAUT, applique_par_defaut: true };
  return { plancher: 0, applique_par_defaut: false };
}

/** Libellé FR d'un indicateur — dictionnaire IRIS_DB_COLUMNS, sinon la clé brute. */
export function libelleIndicateur(indicateur: string): string {
  return IRIS_LABELS[indicateur] ?? indicateur;
}

export function libellePalier(palier: Palier): string {
  return palier === 'departement' ? 'départements' : 'communes';
}

/**
 * Traduit un message d'exception Postgres de `classer_territoires` (sql/150,
 * trois `RAISE EXCEPTION` documentés) en message FR utilisable par
 * l'utilisateur. Un message non reconnu passe quand même — jamais un throw —
 * préfixé pour rester lisible.
 */
export function traduireErreurClassement(messageBrut: string | null | undefined): string {
  const m = messageBrut ?? '';

  if (m.includes('tri par part impossible')) {
    return "Ce classement ne peut pas se faire en part : l'indicateur choisi est déjà une valeur "
      + "relative (taux, indice, revenu…), pas un effectif qu'on peut rapporter à la population. "
      + "Reformulez la demande en volume, ou choisissez un indicateur d'effectif (population, une "
      + "tranche d'âge, un nombre de ménages…).";
  }
  if (/indicateur inconnu ou non num/i.test(m)) {
    return "Cet indicateur n'existe pas ou n'est pas numérique pour ce palier géographique. Les "
      + "tranches d'âge INSEE font 15 ans (pop_0_14, pop_15_29, pop_30_44…) — il n'existe pas de "
      + "« 15-24 ». Vérifiez le nom exact de la colonne.";
  }
  if (m.includes('palier inconnu')) {
    return "Palier géographique inconnu : choisissez 'commune' ou 'departement'.";
  }
  if (m.includes('tri inconnu')) {
    return "Tri inconnu : choisissez 'volume' ou 'part'.";
  }
  return m ? `Le classement n'a pas pu être calculé : ${m}` : "Le classement n'a pas pu être calculé.";
}

// ── Résolution de coordonnées (best effort — jamais de repli trompeur) ──────
//
// `classer_territoires` ne renvoie que code/nom/valeurs : aucune coordonnée.
// On en résout de vraies pour permettre le clic carte, sans jamais inventer un
// point (pas de repli « Paris » comme `getCoordsForVille`) — une ligne sans
// coordonnée résolue reste simplement non cliquable.

interface Coordonnees { lat: number; lng: number }

async function resoudreCoordonneesDepartements(
  supabase: SupabaseAdmin,
  codes:    string[],
): Promise<Record<string, Coordonnees | null>> {
  const resultat: Record<string, Coordonnees | null> = Object.fromEntries(codes.map(c => [c, null]));
  if (codes.length === 0) return resultat;

  const { data, error } = await supabase
    .from('ref_departements')
    .select('code_dept, centroid_lat, centroid_lon')
    .in('code_dept', codes);

  if (error) {
    console.error('[chat/classementTerritoires] ref_departements error:', error.message);
    return resultat;
  }

  for (const row of data ?? []) {
    if (row.centroid_lat != null && row.centroid_lon != null) {
      resultat[row.code_dept] = { lat: row.centroid_lat, lng: row.centroid_lon };
    }
  }
  return resultat;
}

async function resoudreCoordonneesCommunes(
  supabase: SupabaseAdmin,
  codes:    string[],
): Promise<Record<string, Coordonnees | null>> {
  const resultat: Record<string, Coordonnees | null> = Object.fromEntries(codes.map(c => [c, null]));
  if (codes.length === 0) return resultat;

  // Paris / Lyon / Marseille regroupées : le code renvoyé (75056/69123/13055)
  // n'existe dans `iris` que sous ses codes d'arrondissement (sql/150). On
  // résout la correspondance inverse pour retomber sur les bonnes lignes IRIS.
  const { data: meres, error: erreurMeres } = await supabase
    .from('communes_arrondissements')
    .select('code_arrondissement, code_commune_mere')
    .in('code_commune_mere', codes);

  if (erreurMeres) {
    console.error('[chat/classementTerritoires] communes_arrondissements error:', erreurMeres.message);
  }

  const arrondissementsParMere = new Map<string, string[]>();
  const mereParArrondissement  = new Map<string, string>();
  for (const row of meres ?? []) {
    const liste = arrondissementsParMere.get(row.code_commune_mere) ?? [];
    liste.push(row.code_arrondissement);
    arrondissementsParMere.set(row.code_commune_mere, liste);
    mereParArrondissement.set(row.code_arrondissement, row.code_commune_mere);
  }

  const codesIrisAInterroger = codes.flatMap(code => arrondissementsParMere.get(code) ?? [code]);

  const { data: irisRows, error: erreurIris } = await supabase
    .from('iris')
    .select('code_commune, centroid_lat, centroid_lng, population')
    .in('code_commune', codesIrisAInterroger);

  if (erreurIris) {
    console.error('[chat/classementTerritoires] iris (centroïdes) error:', erreurIris.message);
    return resultat;
  }

  // Moyenne pondérée par la population — même logique que le regroupement
  // arrondissements de la RPC, appliquée ici aux centroïdes IRIS.
  const accumulateur = new Map<string, { latPop: number; lngPop: number; pop: number }>();
  for (const row of irisRows ?? []) {
    const cible = mereParArrondissement.get(row.code_commune) ?? row.code_commune;
    const pop   = row.population ?? 0;
    if (row.centroid_lat == null || row.centroid_lng == null || pop <= 0) continue;
    const acc = accumulateur.get(cible) ?? { latPop: 0, lngPop: 0, pop: 0 };
    acc.latPop += row.centroid_lat * pop;
    acc.lngPop += row.centroid_lng * pop;
    acc.pop    += pop;
    accumulateur.set(cible, acc);
  }

  for (const code of codes) {
    const acc = accumulateur.get(code);
    if (acc && acc.pop > 0) {
      resultat[code] = { lat: acc.latPop / acc.pop, lng: acc.lngPop / acc.pop };
    }
  }
  return resultat;
}

// ── Outil ─────────────────────────────────────────────────────────────────────

interface LigneClasserTerritoires {
  code:       string;
  nom:        string;
  population: number;
  valeur:     number;
  part:       number | null;
  classe:     ClasseIndicateur;
}

export async function classementTerritoires(args: Record<string, unknown>) {
  const indicateur = String(args.indicateur ?? '').trim();
  const palier: Palier        = args.palier === 'departement' ? 'departement' : 'commune';
  const tri: TriClassement    = args.tri === 'part' ? 'part' : 'volume';
  const regrouperArrondissements = args.regrouper_arrondissements !== false; // défaut true
  const limite = resoudreLimite(args.limite);
  const { plancher, applique_par_defaut } = resoudrePlancherPopulation(tri, args.plancher_population);

  if (!indicateur) {
    return { error: "Indicateur requis pour classer les territoires." };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('classer_territoires', {
    p_indicateur:                indicateur,
    p_palier:                    palier,
    p_tri:                       tri,
    p_plancher_population:       plancher,
    p_limite:                    limite,
    p_regrouper_arrondissements: palier === 'commune' ? regrouperArrondissements : false,
  });

  if (error) {
    logger.debug('chat', `classement_territoires(${indicateur}, ${palier}, ${tri}) → erreur RPC: ${error.message}`);
    const indicateurs_disponibles = await listerIndicateursClassement();
    return {
      error: traduireErreurClassement(error.message),
      indicateurs_disponibles,
    };
  }

  const lignes = (data ?? []) as LigneClasserTerritoires[];
  const codes  = lignes.map(l => l.code);

  const coordonneesParCode = palier === 'departement'
    ? await resoudreCoordonneesDepartements(supabase, codes)
    : await resoudreCoordonneesCommunes(supabase, codes);

  const resultats = lignes.map(l => ({
    code:       l.code,
    nom:        l.nom,
    population: l.population,
    valeur:     l.valeur,
    part:       l.part,
    classe:     l.classe,
    lat:        coordonneesParCode[l.code]?.lat ?? null,
    lng:        coordonneesParCode[l.code]?.lng ?? null,
  }));

  logger.debug('chat', `classement_territoires(${indicateur}, ${palier}, ${tri}, plancher=${plancher}) → ${resultats.length} lignes`);

  return {
    type:                                   'classement_territoires' as const,
    indicateur,
    indicateur_label:                       libelleIndicateur(indicateur),
    palier,
    palier_label:                           libellePalier(palier),
    tri,
    classe:                                 resultats[0]?.classe ?? null,
    plancher_population:                    plancher,
    plancher_population_applique_par_defaut: applique_par_defaut,
    regrouper_arrondissements:              palier === 'commune' ? regrouperArrondissements : false,
    limite,
    resultats,
  };
}
