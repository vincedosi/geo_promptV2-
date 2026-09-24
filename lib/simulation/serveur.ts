/**
 * Les accès en base de la simulation de campagne — côté serveur uniquement.
 *
 * Tout ce qui est calcul vit dans les fonctions pures de `lib/simulation/`.
 * Ici : lire, écrire, purger, et rien d'autre.
 */
import type { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { lireTout } from '@/lib/supabase/lire-tout';
import type { LigneDiffusion, ParamsSimulation } from '@/lib/simulation/types';
import type {
  Agregats, EntreeBrute, ReponseSimulation, SimulationMeta, ZoneSimulation,
} from '@/lib/simulation/payload';

type Client = ReturnType<typeof createAdminClient>;

/**
 * Taille d'un lot d'insertion : 50, la règle du projet (`CLAUDE.md`,
 * « Inserts DB : batch par 50 max — une seule requête par lot »).
 */
const TAILLE_LOT = 50;

/**
 * Lots envoyés en même temps : 3, le plafond de requêtes Supabase simultanées
 * du projet (`CLAUDE.md`, « Promise.all() > 3 appels Supabase simultanés »).
 */
const LOTS_SIMULTANES = 3;

/** Le jour `j` (à partir de 1) d'une simulation commencée à `debut`, en `YYYY-MM-DD`. */
export function dateDuJour(debut: string, j: number): string {
  const d = new Date(`${debut}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + j - 1);
  return d.toISOString().slice(0, 10);
}

/** Les entrées d'une extraction, telles que le générateur les consomme. */
export async function lireEntrees(
  supabase: Client,
  extractionId: string,
): Promise<EntreeBrute[]> {
  const { data, error } = await supabase.rpc('simulation_entrees', { p_extraction: extractionId });
  if (error) throw new Error(`Entrées de l’extraction illisibles : ${error.message}`);
  const brut = rpcJson<EntreeBrute[]>(data) ?? [];
  // `numeric` arrive en chaîne par PostgREST : on convertit une fois, ici.
  return brut.map((r) => ({
    ...r,
    multiplicateur: Number(r.multiplicateur),
    pop_en_zone: Number(r.pop_en_zone),
    pop_totale: Number(r.pop_totale),
    part_en_zone: Number(r.part_en_zone),
    surface_km2: r.surface_km2 == null ? null : Number(r.surface_km2),
    x: r.x == null ? null : Number(r.x),
    y: r.y == null ? null : Number(r.y),
  }));
}

/**
 * Écrit des lignes de diffusion dans `dsp_campaign_data`, par lots de 50.
 *
 * ⚠ L'erreur de CHAQUE lot est lue : supabase-js ne lève pas, et une
 * simulation à moitié écrite se présenterait comme complète — son alignement
 * serait calculé sur une campagne amputée, sans que rien le dise.
 *
 * @param onProgres - Appelé après chaque vague de lots, avec le nombre écrit.
 */
export async function insererLignes(
  supabase: Client,
  campagneId: string,
  debut: string,
  lignes: LigneDiffusion[],
  onProgres: (faites: number) => void,
): Promise<void> {
  const lots: LigneDiffusion[][] = [];
  for (let i = 0; i < lignes.length; i += TAILLE_LOT) lots.push(lignes.slice(i, i + TAILLE_LOT));

  let faites = 0;
  for (let i = 0; i < lots.length; i += LOTS_SIMULTANES) {
    const vague = lots.slice(i, i + LOTS_SIMULTANES);
    const resultats = await Promise.all(vague.map((lot) => supabase
      .from('dsp_campaign_data')
      .insert(lot.map((l) => ({
        campaign_id: campagneId,
        date: dateDuJour(debut, l.jour),
        postal_code: l.code_postal,
        country: 'FR',
        // `media` ET `actor` au nom du partenaire : les deux entrent dans
        // `idx_dsp_data_unique`, et le Suivi lit l'un ou l'autre selon l'écran.
        media: l.partenaire,
        actor: l.partenaire,
        impressions: l.impressions,
        spend: l.depense,
        dsp_source: 'simulation',
      })))));
    for (const r of resultats) {
      if (r.error) throw new Error(`Écriture de la diffusion interrompue : ${r.error.message}`);
    }
    faites += vague.reduce((t, l) => t + l.length, 0);
    onProgres(faites);
  }
}

/**
 * Purge la simulation d'un jeu : sa campagne (qui emporte impressions et ligne
 * de simulation en cascade) et l'extraction v2 que son recalage a créée.
 *
 * ⚠ L'extraction v2 est supprimée parce qu'elle est un PRODUIT de la
 * simulation, pas un plan décidé par quelqu'un : la laisser ferait croire, dans
 * la liste des extractions, qu'un recalage réel a eu lieu.
 *
 * @returns Le nombre de simulations purgées.
 */
export async function purgerSimulations(supabase: Client, jeuId: string): Promise<number> {
  const { data, error } = await supabase
    .from('zone_set_simulations')
    .select('id, campaign_id, extraction_v2_id')
    .eq('zone_set_id', jeuId);
  if (error) throw new Error(`Simulations illisibles : ${error.message}`);
  for (const s of data ?? []) {
    const { error: e1 } = await supabase.from('dsp_campaigns').delete().eq('id', s.campaign_id);
    if (e1) throw new Error(`Purge de la campagne simulée impossible : ${e1.message}`);
    if (s.extraction_v2_id) {
      const { error: e2 } = await supabase
        .from('zone_set_extractions').delete().eq('id', s.extraction_v2_id);
      if (e2) throw new Error(`Purge de l’extraction recalée impossible : ${e2.message}`);
    }
  }
  return data?.length ?? 0;
}

/** Au-delà, `lireTout` LÈVE plutôt que de rendre un plan tronqué. */
const PLAFOND_CP = 8000;

/**
 * Tout ce que l'étape ⑤ lit sur la dernière simulation d'un jeu, en une passe.
 *
 * Partagé par `GET /simulation` et par l'export Excel : un classeur qui
 * assemblerait ses données autrement finirait par contredire l'écran.
 *
 * ⚠ La propriété du jeu est vérifiée par l'APPELANT, avant cet appel.
 *
 * @throws Si une lecture échoue — jamais un résultat partiel présenté comme complet.
 */
export async function chargerSimulation(supabase: Client, jeuId: string): Promise<ReponseSimulation> {
  const { data: sim, error: erreurSim } = await supabase
    .from('zone_set_simulations')
    .select('id, campaign_id, statut, date_debut, jours, jour_recalage, params, lignes_v1, lignes_v2, created_at, extraction_v1_id, extraction_v2_id')
    .eq('zone_set_id', jeuId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erreurSim) throw new Error(`Simulation illisible : ${erreurSim.message}`);
  if (!sim) return { simulation: null };

  const ids = [sim.extraction_v1_id, sim.extraction_v2_id].filter((x): x is string => !!x);
  const { data: versions, error: erreurVersions } = await supabase
    .from('zone_set_extractions').select('id, version').in('id', ids);
  if (erreurVersions) throw new Error(`Extractions illisibles : ${erreurVersions.message}`);
  const versionDe = (x: string | null) => {
    const v = (versions ?? []).find((e) => e.id === x);
    return v ? { id: v.id, version: v.version } : null;
  };
  const v1 = versionDe(sim.extraction_v1_id);
  if (!v1) throw new Error('L’extraction de la simulation a disparu.');

  // Séquentiel et non `Promise.all` : quatre lectures, dont deux lourdes, et
  // le plafond du projet est de trois appels simultanés.
  const entrees = await lireEntrees(supabase, sim.extraction_v1_id);

  let multiplicateurs_v2: Record<string, number> | undefined;
  if (sim.extraction_v2_id) {
    const v2Id = sim.extraction_v2_id;
    const { lignes } = await lireTout<{ code_postal: string; multiplicateur: number }>(
      (de, a) => supabase
        .from('zone_set_extraction_cp')
        .select('code_postal, multiplicateur')
        .eq('extraction_id', v2Id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP,
    );
    multiplicateurs_v2 = Object.fromEntries(lignes.map((l) => [l.code_postal, Number(l.multiplicateur)]));
  }

  const { lignes: grappes } = await lireTout<{
    id: string; rang: number; nom: string | null; niveau_dominant: string | null;
    n_sites: number; pop_exposee: number | null;
  }>(
    (de, a) => supabase
      .from('zone_set_clusters')
      .select('id, rang, nom, niveau_dominant, n_sites, pop_exposee')
      .eq('zone_set_id', jeuId)
      .order('rang')
      .range(de, a),
    PLAFOND_CP,
  );

  const { data: brut, error: erreurAgg } = await supabase.rpc('simulation_agregats', { p_simulation: sim.id });
  if (erreurAgg) throw new Error(`Agrégats illisibles : ${erreurAgg.message}`);
  const agregats = rpcJson<Agregats & { ok: boolean }>(brut);
  if (!agregats?.ok) throw new Error('Agrégats indisponibles.');

  // L'emprise de chaque bassin, tirée des centroïdes de ses codes postaux :
  // assez pour recadrer la carte, sans une requête géométrique de plus.
  const emprise = new Map<string, [number, number, number, number]>();
  for (const e of entrees) {
    if (!e.cluster_id || e.x == null || e.y == null) continue;
    const b = emprise.get(e.cluster_id);
    emprise.set(e.cluster_id, b
      ? [Math.min(b[0], e.x), Math.min(b[1], e.y), Math.max(b[2], e.x), Math.max(b[3], e.y)]
      : [e.x, e.y, e.x, e.y]);
  }
  const zones: ZoneSimulation[] = grappes.map((g) => ({
    id: g.id,
    rang: g.rang,
    // Un bassin sans nom garde son rang : même règle que l'extraction.
    nom: g.nom?.trim() || `Zone ${g.rang}`,
    niveau: g.niveau_dominant,
    n_sites: g.n_sites,
    pop_exposee: Number(g.pop_exposee ?? 0),
    bbox: emprise.get(g.id) ?? null,
  }));

  const simulation: SimulationMeta = {
    id: sim.id,
    campaign_id: sim.campaign_id,
    statut: sim.statut as 'v1' | 'v2',
    date_debut: sim.date_debut,
    jours: sim.jours,
    jour_recalage: sim.jour_recalage,
    params: sim.params as unknown as ParamsSimulation,
    lignes_v1: sim.lignes_v1,
    lignes_v2: sim.lignes_v2,
    created_at: sim.created_at,
    extraction_v1: v1,
    extraction_v2: versionDe(sim.extraction_v2_id),
  };

  return {
    simulation, entrees, multiplicateurs_v2, zones,
    agregats: {
      par_cp: agregats.par_cp, par_zone_jour: agregats.par_zone_jour,
      par_jour: agregats.par_jour, par_partenaire: agregats.par_partenaire,
    },
  };
}
