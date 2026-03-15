/**
 * lib/chat/tools/synergy.ts
 * Outil analyze_poi_synergy — panneaux OOH proches d'un POI ET à forte densité démographique.
 */

import { createAdminClient }             from '@/lib/auth';
import { KNOWN_FILOSOFI_COLS }           from './_shared';

interface SynergyRow {
  id:            unknown;
  source_ref?:   string;
  lat:           number | string;
  lng:           number | string;
  type_panneau?: string;
  ville?:        string;
  regie?:        string;
  audience_score: number | string;
}

export async function synergy(args: Record<string, unknown>) {
  const poi_category      = String(args.poi_category      ?? '');
  const ville             = args.ville ? String(args.ville) : undefined;
  const max_distance_m    = Number(args.max_distance_m    ?? 500);
  const target_demo_col   = String(args.target_demo_col   ?? 'ind_18_24');
  const target_demo_label = String(args.target_demo_label ?? 'Jeunes 18-24 ans');
  const min_audience      = Number(args.min_audience      ?? 0);
  const buffer_radius_m   = Number(args.buffer_radius_m   ?? 300);

  if (!poi_category) return { error: 'poi_category requis.' };
  if (!ville)        return { error: 'ville requise pour analyze_poi_synergy (performance).' };
  if (!(KNOWN_FILOSOFI_COLS as readonly string[]).includes(target_demo_col)) {
    return { error: 'Colonne inconnue: ' + target_demo_col };
  }

  console.log(`[chat] analyze_poi_synergy ville=${ville} poi=${poi_category} col=${target_demo_col} dist=${max_distance_m}m`);

  const supabase = createAdminClient();
  const { data: rpcData, error: rpcErr } = await supabase.rpc('find_synergy_billboards', {
    poi_category,
    ville:          ville ?? null,
    max_distance_m,
    target_demo_col,
    min_audience,
    buffer_radius_m,
  });

  if (rpcErr) {
    const msg = String(rpcErr.message ?? rpcErr);
    if (msg.includes('find_synergy_billboards')) {
      return { error: 'Fonction PostGIS manquante — executez sql/006_find_synergy_billboards.sql dans Supabase SQL Editor.' };
    }
    return { error: msg };
  }

  if (!Array.isArray(rpcData)) {
    return { error: (rpcData as { error?: string } | null)?.error ?? 'Erreur RPC' };
  }

  if (rpcData.length === 0) {
    return { error: `Aucun panneau synergique trouvé pour ${poi_category} / ${target_demo_label} (seuil: ${min_audience}).` };
  }

  const pois = (rpcData as SynergyRow[]).map((r, i) => ({
    id:             String(r.id),
    nom:            r.source_ref ?? String(r.id),
    lat:            Number(r.lat),
    lng:            Number(r.lng),
    categorie:      'panneaux',
    sous_categorie: r.type_panneau ?? null,
    ville:          r.ville    ?? undefined,
    adresse:        r.regie    ?? undefined,
    rank:           i + 1,
    audience:       Number(r.audience_score),
  }));

  const lats = pois.map(p => p.lat);
  const lngs = pois.map(p => p.lng);
  const coordonnees = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };

  const totalAudience = pois.reduce((s, p) => s + p.audience, 0);
  console.log(`[chat] analyze_poi_synergy -> ${pois.length} panneaux totalAudience=${totalAudience}`);

  return {
    ville:             `Synergie ${poi_category} x ${target_demo_label}`,
    rayon_metres:      null,
    rayon_poi_metres:  buffer_radius_m,
    coordonnees,
    pois,
    nb_pois:           pois.length,
    categories:        { panneaux: pois.length },
    couleur_overrides: { panneaux: '#f59e0b' },
    _synergy: {
      poi_category, target_demo_col, target_demo_label,
      max_distance_m, min_audience, buffer_radius_m,
      total_audience: totalAudience,
    },
  };
}
