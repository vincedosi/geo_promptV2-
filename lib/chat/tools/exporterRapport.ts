/**
 * lib/chat/tools/exporterRapport.ts
 * Outil exporter_rapport_ooh — export rapport Excel OOH complet d'une ville.
 */

import { createAdminClient }               from '@/lib/auth';
import { getCoordsForVille }               from '@/lib/geo/locations';
import { haversineM, buildBbox, KNOWN_FILOSOFI_COLS } from './_shared';
import type { BillboardRaw, CarreauRow }   from './types';

export async function exporterRapport(args: Record<string, unknown>) {
  const ville        = args.ville         ? String(args.ville)         : undefined;
  const regie        = args.regie         ? String(args.regie)         : undefined;
  const target_col   = args.target_column ? String(args.target_column) : 'ind_18_24';
  const target_label = args.target_label  ? String(args.target_label)  : 'Jeunes 18-24 ans';
  const rayon_m      = args.rayon_metres  ? Number(args.rayon_metres)  : 500;
  const poids_demo   = args.poids_demo    ? Number(args.poids_demo)    : 0.65;
  const poids_ctx    = args.poids_contexte ? Number(args.poids_contexte) : 0.35;

  if (!ville) return { error: 'Ville requise pour exporter le rapport OOH.' };
  if (!(KNOWN_FILOSOFI_COLS as readonly string[]).includes(target_col)) {
    return { error: `Indicateur inconnu: ${target_col}.` };
  }

  try {
    const supabase = createAdminClient();

    let q = supabase
      .from('global_ooh')
      .select('id, source_ref, regie, type_panneau, lat, lng, ville, adresse')
      .eq('statut', 'actif')
      .ilike('ville', `%${ville}%`);
    if (regie) q = q.ilike('regie', `%${regie}%`);

    const { data: panneauxData, error: pErr } = await q.limit(5000);
    if (pErr)  return { error: pErr.message };
    if (!panneauxData?.length) return { error: `Aucun panneau trouvé à ${ville}.` };

    const panneaux = (panneauxData as BillboardRaw[])
      .filter(p => p.lat && p.lng && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)))
      .map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
    if (!panneaux.length) return { error: `Aucun panneau avec coordonnées valides à ${ville}.` };

    const lats = panneaux.map(p => p.lat as number);
    const lngs = panneaux.map(p => p.lng as number);
    const { minLat, maxLat, minLng, maxLng } = buildBbox(lats, lngs, rayon_m);

    const { data: carreaux, error: cErr } = await supabase.rpc('get_carreaux_for_scoring', {
      p_table: 'carreaux_filosofi', p_col: target_col,
      p_west: minLng, p_south: minLat, p_east: maxLng, p_north: maxLat,
    });
    if (cErr) return { error: cErr.message };

    const { data: poisContext } = await supabase
      .from('poi').select('lat, lng')
      .gte('lat', minLat).lte('lat', maxLat)
      .gte('lng', minLng).lte('lng', maxLng)
      .limit(5000);

    const scored = panneaux.map(p => {
      let score_cible = 0, pop_totale = 0;
      for (const c of ((carreaux ?? []) as CarreauRow[])) {
        if (haversineM(p.lat as number, p.lng as number, Number(c.cy), Number(c.cx)) <= rayon_m) {
          score_cible += Number(c.val_cible  ?? 0) || 0;
          pop_totale  += Number(c.pop_totale ?? 0) || 0;
        }
      }
      let poi_count = 0;
      for (const poi of (poisContext ?? []) as { lat: number; lng: number }[]) {
        if (poi.lat && poi.lng && haversineM(p.lat as number, p.lng as number, Number(poi.lat), Number(poi.lng)) <= rayon_m) {
          poi_count++;
        }
      }
      return { ...p, score_cible, pop_totale, poi_count };
    });

    const maxCible = Math.max(...scored.map(p => p.score_cible), 1);
    const maxCtx   = Math.max(...scored.map(p => p.poi_count),   1);

    const allRanked = scored
      .map(p => {
        const norm_demo = (p.score_cible / maxCible) * 100;
        const norm_ctx  = (p.poi_count   / maxCtx)   * 100;
        return {
          ...p,
          norm_demo: Math.round(norm_demo),
          norm_ctx:  Math.round(norm_ctx),
          score_ooh: Math.round((poids_demo * norm_demo + poids_ctx * norm_ctx) * 10) / 10,
        };
      })
      .sort((a, b) => b.score_ooh - a.score_ooh)
      .map((p, i) => ({
        rank:               i + 1,
        id:                 p.id,
        nom:                p.source_ref ?? p.id,
        regie:              p.regie              ?? '',
        type:               p.type_panneau       ?? '',
        adresse:            p.adresse            ?? '',
        lat:                p.lat,
        lng:                p.lng,
        ville:              p.ville              ?? ville,
        score_ooh:          p.score_ooh,
        audience:           Math.round(p.score_cible),
        pop_totale_buffer:  Math.round(p.pop_totale),
        score_demo:         p.norm_demo,
        score_contexte:     p.norm_ctx,
        poi_count:          p.poi_count,
      }));

    const coordonnees = getCoordsForVille(ville) ?? { lat: 46.8, lng: 2.3 };
    console.log(`[chat] exporter_rapport_ooh(${ville}, ${target_col}, ${rayon_m}m) → ${allRanked.length} panneaux scored`);

    return {
      action:         'export_ooh' as const,
      ville,
      target_label,
      target_column:  target_col,
      rayon_m,
      poids_demo,
      poids_contexte: poids_ctx,
      pois:           allRanked,
      nb_pois:        allRanked.length,
      coordonnees,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[chat/exporter_rapport_ooh]', msg);
    return { error: msg };
  }
}
