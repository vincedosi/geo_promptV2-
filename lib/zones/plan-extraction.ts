/**
 * @file lib/zones/plan-extraction.ts — le plan CP d'une EXTRACTION figée (lot 6, T1 ; arbitrages A-4, A-11).
 *
 * Deux lecteurs, une seule lecture des lignes (`lireCpExtraction`) :
 * - `POST /api/zones/jeux/[id]/rattacher` avec `extraction` recopie ce plan dans `bidding_zone_configs`, sans
 *   recalcul (`planExtraction`) ;
 * - `GET /api/zones/jeux/[id]/extractions/[version]/cp` le rend à l'écran ⑥ pour répartir les impressions prévues.
 * Le même filtre (`multiplicateur > 0`) des deux côtés : les CP affichés sont ceux qui ont été écrits.
 *
 * Les deux types de jeu ont un plan CP d'extraction (`zone_set_extraction_cp`) ; un jeu de zone sans plateforme au
 * CP n'en a pas, et son extraction ne se rattache pas (409).
 */
import { NextResponse } from 'next/server';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import { lireTout } from '@/lib/supabase/lire-tout';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Au-delà, `lireTout` LÈVE plutôt que de rendre un début de plan (un plan national fait ~6 000 CP). */
export const PLAFOND_CP_PLAN = 7000;

/** Le 409 d'un jeu ou d'une extraction sans code postal — la même phrase sur les deux chemins de `rattacher`. */
export const MESSAGE_AUCUN_CP = 'Ce jeu de zones ne couvre aucun code postal.';

/** Une ligne du plan à écrire dans `bidding_zone_configs` (multiplicateur > 0). */
interface LignePlan { code_postal: string; multiplicateur: number; classe: string; retenu: boolean }

/** Une ligne du plan d'une extraction : `code_canonique` sert à retrouver les CP d'une plateforme (groupes). */
export interface LigneCpExtraction extends LignePlan { code_canonique: string }

/** Ce qu'un chemin de `rattacher` donne à son écrivain : les lignes, la stratégie qui les porte, les chiffres rendus. */
export interface Plan {
  lignes: LignePlan[];
  nom: string;
  description: string;
  /** La SOURCE du plan (`in_zone_weights`), lue par le Suivi pour ses libellés. */
  source: Record<string, unknown>;
  /** Ajouté tel quel à la réponse 201. */
  resume: Record<string, unknown>;
}

/** Un plan, ou la réponse à renvoyer telle quelle. */
export type IssuePlan = Plan | { reponse: NextResponse };

export const refusPlan = (error: string, status: number): IssuePlan =>
  ({ reponse: NextResponse.json({ error }, { status }) });

/**
 * Les CP achetés d'une extraction (`multiplicateur > 0`), triés par code.
 *
 * ⚠ Lecture PAGINÉE : PostgREST coupe à `db-max-rows = 1000` côté serveur, sans erreur — un plan national rendrait
 * son premier millier de CP en se présentant comme complet.
 *
 * @throws {Error} Si une page échoue ou si le plafond est franchi (`lireTout`).
 */
export async function lireCpExtraction(supabase: ClientAdmin, extractionId: string): Promise<LigneCpExtraction[]> {
  const { lignes } = await lireTout<LigneCpExtraction>(
    (de, a) => supabase
      .from('zone_set_extraction_cp')
      .select('code_postal, code_canonique, multiplicateur, classe, retenu')
      .eq('extraction_id', extractionId)
      .gt('multiplicateur', 0)
      .order('code_postal')
      .range(de, a),
    PLAFOND_CP_PLAN,
  );
  // `numeric(6,3)` : nombre JSON chez PostgREST, converti par sûreté (un texte fausserait les sommes).
  return lignes.map((l) => ({ ...l, multiplicateur: Number(l.multiplicateur) }));
}

/**
 * Le plan d'une extraction, recopié tel quel (A-4). L'extraction doit appartenir au jeu (sinon 404). Les chiffres du
 * résumé sont LUS de l'extraction, jamais recalculés : ce sont ceux qui ont été montrés au moment de la figer.
 *
 * @param jeuRow - Le jeu, déjà chargé et vérifié dans l'espace (`chargerJeu`, sans filtre de type).
 */
export async function planExtraction(
  supabase: ClientAdmin, jeuRow: Tables<'zone_sets'>, extractionId: string,
): Promise<IssuePlan> {
  const { data: x, error } = await supabase
    .from('zone_set_extractions')
    .select('id, version, mode_plan, seuil_couverture_cp, n_retenus, taux_utile, part_plan_en_zone, plateformes')
    .eq('id', extractionId)
    .eq('zone_set_id', jeuRow.id)
    .maybeSingle();
  if (error) {
    console.error('[zones/rattacher] extraction :', error.message);
    return refusPlan('Extraction illisible.', 500);
  }
  if (!x) return refusPlan('Extraction introuvable pour ce jeu.', 404);

  let lignes: LigneCpExtraction[];
  try {
    lignes = await lireCpExtraction(supabase, x.id);
  } catch (e) {
    console.error('[zones/rattacher] lecture CP de l’extraction :', e instanceof Error ? e.message : e);
    return refusPlan('Codes postaux de l’extraction illisibles.', 500);
  }
  if (lignes.length === 0) return refusPlan(MESSAGE_AUCUN_CP, 409);

  const seuil = Number(x.seuil_couverture_cp);
  return {
    lignes: lignes.map(({ code_postal, multiplicateur, classe, retenu }) => ({ code_postal, multiplicateur, classe, retenu })),
    nom: `Jeu de zones — ${jeuRow.nom} (extraction v${x.version})`,
    description:
      `Plan recopie de l'extraction v${x.version} du jeu de zones « ${jeuRow.nom} » (version ${jeuRow.version}), `
      + `mode ${x.mode_plan}, seuil de couverture ${seuil} %.`,
    source: {
      mode: 'zone_set',
      zone_set_id: jeuRow.id,
      zone_set_nom: jeuRow.nom,
      zone_set_version: jeuRow.version,
      mode_plan: x.mode_plan,
      seuil_couverture_cp: seuil,
      taux_utile: x.taux_utile,
      part_plan_en_zone: x.part_plan_en_zone,
      extraction_id: x.id,
      extraction_version: x.version,
      // Le résumé figé par plateforme (jeu de zone) ; `null` pour un jeu risque.
      plateformes: x.plateformes,
    },
    resume: {
      mode_plan: x.mode_plan,
      part_plan_en_zone: x.part_plan_en_zone,
      taux_utile: x.taux_utile,
      n_retenus: x.n_retenus,
      extraction: x.id,
      extraction_version: x.version,
    },
  };
}
