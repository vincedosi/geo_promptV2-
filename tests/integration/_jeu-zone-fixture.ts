import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Relecture finale du lot 4 : un jeu de ZONE extrait, créé par le test et supprimé à la fin — il remplace l'id en dur
 * `66061937` (« Lycées 5 km — BdR », preuve du lot 6), absent de toute base reconstruite depuis le dump, qui faisait
 * échouer `fichier-extraction` et `activation-extraction` sans rien dire du code.
 *
 * La fixture : un espace d'essai, une zone « rayon de 5 km autour de Lyon » (recette `rayon_point`, patron du lot 6),
 * un jeu aux quatre plateformes — DV360 au CP, Meta en cercle de 5 km (exact : le disque de la recette), TikTok au
 * département, TTD au polygone — et son extraction v1, faite par la VRAIE route (`poster`, que l'appelant fournit avec
 * sa session simulée réglée sur l'espace rendu). Aucune donnée existante n'est lue ni touchée.
 */
export interface JeuZoneExtrait { org: string; zone: string; jeu: string; extraction: string; nom: string }

export const NOM_JEU_FIXTURE = 'Fixture lot 4 — Lyon 5 km';

/** L'espace d'essai seul (l'appelant doit régler sa session dessus avant `extraireJeuZone`). */
export async function creerEspaceFixture(sb: SupabaseClient, etiquette: string): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: `[ESSAI ${etiquette}] jeu de zone extrait`, slug: `essai-fixture-${etiquette}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-') })
    .select('id').single();
  if (error || !data) throw new Error(`fixture espace : ${error?.message}`);
  return data.id as string;
}

/** Zone, jeu et extraction v1 dans l'espace `org` ; `poster(jeu)` appelle `POST …/extractions` et rend sa réponse. */
export async function extraireJeuZone(
  sb: SupabaseClient, org: string, poster: (jeu: string) => Promise<Response>,
): Promise<JeuZoneExtrait> {
  const recette = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000 };
  const { data: rayon, error: e1 } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: 5000 });
  if (e1) throw new Error(`fixture rayon : ${e1.message}`);
  const { data: z, error: e2 } = await sb.rpc('creer_zone_recette', {
    p_nom: 'Lyon 5 km (fixture lot 4)', p_org_id: org, p_cree_par: null, p_recette: recette,
    p_geometry_geojson: JSON.stringify((rayon as { geometry: unknown }).geometry),
  });
  if (e2) throw new Error(`fixture zone : ${e2.message}`);
  const zone = (z as { id: string }).id;
  const { data: j, error: e3 } = await sb.from('zone_sets').insert({
    org_id: org, nom: NOM_JEU_FIXTURE, type: 'zone', custom_geo_zone_id: zone, cible: 'ind',
    mode_plan: 'pondere', brouillon: false, version: 1,
  }).select('id').single();
  if (e3 || !j) throw new Error(`fixture jeu : ${e3?.message}`);
  const jeu = j.id as string;
  const ins = await sb.from('zone_set_plateformes').insert([
    { zone_set_id: jeu, plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null },
    { zone_set_id: jeu, plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 5000 },
    { zone_set_id: jeu, plateforme: 'tiktok', maille: 'departement', seuil: 20, rayon_m: null },
    { zone_set_id: jeu, plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null },
  ]);
  if (ins.error) throw new Error(`fixture plateformes : ${ins.error.message}`);
  const r = await poster(jeu);
  if (r.status !== 201) throw new Error(`fixture extraction ${r.status} : ${JSON.stringify(await r.json())}`);
  const extraction = ((await r.json()) as { id: string }).id;
  return { org, zone, jeu, extraction, nom: NOM_JEU_FIXTURE };
}

/** Le nettoyage : les jeux avant les zones (clé `on delete restrict`), extractions en cascade, puis l'espace. */
export async function nettoyerEspaceFixture(sb: SupabaseClient, org: string): Promise<void> {
  if (!org) return;
  const jeux = await sb.from('zone_sets').delete().eq('org_id', org);
  if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
  const { error } = await sb.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage de l’espace : ${error.message}`);
}
