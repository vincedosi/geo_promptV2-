/**
 * lib/chat/tools/classerAudience.ts
 * Outil classer_panneaux_audience — classe panneaux OOH par audience démographique.
 */

import { createAdminClient }               from '@/lib/auth';
import { getCoordsForVille }               from '@/lib/geo/locations';
import { haversineM, buildBbox, KNOWN_FILOSOFI_COLS } from './_shared';
import type { BillboardRaw, CarreauRow }   from './types';
import { getOrgSourceIds }                 from './orgContext';

export async function classerAudience(args: Record<string, unknown>) {
  const ville        = args.ville         ? String(args.ville)         : undefined;
  const regie        = args.regie         ? String(args.regie)         : undefined;
  const target_col   = args.target_column ? String(args.target_column) : 'ind_18_24';
  const target_label = args.target_label  ? String(args.target_label)  : 'Jeunes 18-24 ans';
  const rayon_m      = args.rayon_metres  ? Number(args.rayon_metres)  : 500;
  const limit_n      = args.limit         ? Math.min(Number(args.limit), 50) : 10;

  if (!ville) return { error: 'Ville requise pour classer les panneaux.' };
  if (!(KNOWN_FILOSOFI_COLS as readonly string[]).includes(target_col)) {
    return { error: `Indicateur inconnu: ${target_col}. Valides: ${KNOWN_FILOSOFI_COLS.join(', ')}` };
  }

  try {
    const supabase     = createAdminClient();
    const orgSourceIds = getOrgSourceIds();
    if (orgSourceIds !== null && orgSourceIds.length === 0) {
      return { error: "Aucune source configurée pour votre organisation." };
    }

    let q = supabase
      .from('global_ooh')
      .select('id, source_ref, regie, type_panneau, lat, lng, ville, adresse')
      .eq('statut', 'actif')
      .ilike('ville', `%${ville}%`);
    if (regie)             q = q.ilike('regie', `%${regie}%`);
    if (orgSourceIds !== null) q = q.in('data_source_id', orgSourceIds);

    const { data: panneauxData, error: pErr } = await q.limit(2000);
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

    const ranked = panneaux
      .map(p => {
        let score = 0;
        for (const c of ((carreaux ?? []) as CarreauRow[])) {
          if (haversineM(p.lat as number, p.lng as number, Number(c.cy), Number(c.cx)) <= rayon_m) {
            score += Number(c.val_cible ?? 0) || 0;
          }
        }
        return { ...p, audience: Math.round(score) };
      })
      .sort((a, b) => b.audience - a.audience)
      .slice(0, limit_n)
      .map((p, i) => ({
        rank:           i + 1,
        id:             p.id,
        nom:            p.source_ref ?? p.id,
        regie:          p.regie,
        type:           p.type_panneau,
        lat:            p.lat,
        lng:            p.lng,
        ville:          p.ville,
        audience:       p.audience,
        categorie:      'panneaux',
        sous_categorie: p.type_panneau ?? null,
        adresse:        p.adresse ?? p.regie ?? undefined,
      }));

    const totalAudience = ranked.reduce((s, p) => s + p.audience, 0);
    const rLats         = ranked.map(p => p.lat as number);
    const rLngs         = ranked.map(p => p.lng as number);
    const coordonnees   = ranked.length > 0
      ? { lat: (Math.min(...rLats) + Math.max(...rLats)) / 2, lng: (Math.min(...rLngs) + Math.max(...rLngs)) / 2 }
      : getCoordsForVille(ville) ?? { lat: 46.8, lng: 2.3 };

    console.log(`[chat] classer_panneaux_audience(${ville}, ${target_col}, ${rayon_m}m, top${limit_n}) → ${ranked.length} panneaux, total=${totalAudience}`);

    return {
      ville,
      rayon_metres:     null,
      rayon_poi_metres: rayon_m,
      target_column:    target_col,
      target_label,
      limit:            limit_n,
      coordonnees,
      pois:             ranked,
      nb_pois:          ranked.length,
      total_audience:   totalAudience,
      categories:       { panneaux: ranked.length },
      couleur_overrides: { panneaux: '#ef4444' },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[chat/classer_panneaux_audience]', msg);
    return { error: msg };
  }
}
