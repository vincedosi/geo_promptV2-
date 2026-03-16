/**
 * lib/chat/tools/panneaux.ts
 * Outil analyser_panneaux — affiche panneaux OOH sur carte.
 */

import { createAdminClient } from '@/lib/auth';
import type { BillboardRaw }  from './types';

const PAGE_PAN = 1000;

export async function analyserPanneaux(args: Record<string, unknown>) {
  const regie        = args.regie        ? String(args.regie)        : undefined;
  const ville        = args.ville        ? String(args.ville)        : undefined;
  const region       = args.region       ? String(args.region)       : undefined;
  const departement  = args.departement  ? String(args.departement)  : undefined;
  const type_panneau = args.type_panneau ? String(args.type_panneau) : undefined;
  const couleur      = args.couleur      ? String(args.couleur)      : '#f97316';

  const supabase    = createAdminClient();
  const allPanneaux: BillboardRaw[] = [];
  let from = 0;

  while (from < 50_000) { // max 50k panneaux en mémoire
    let q = supabase
      .from('global_ooh')
      .select('id, lat, lng, source_ref, regie, type_panneau, ville, adresse')
      .eq('statut', 'actif')
      .range(from, from + PAGE_PAN - 1);
    if (regie)        q = q.ilike('regie',        `%${regie}%`);
    if (ville)        q = q.ilike('ville',         `%${ville}%`);
    if (type_panneau) q = q.ilike('type_panneau',  `%${type_panneau}%`);

    const { data: pageData, error: pageErr } = await q;
    if (pageErr) return { error: pageErr.message };
    if (!pageData?.length) break;
    allPanneaux.push(...(pageData as BillboardRaw[]));
    if (pageData.length < PAGE_PAN) break;
    from += PAGE_PAN;
  }

  const pois = allPanneaux
    .map(p => ({
      id:             p.id,
      nom:            p.source_ref ?? p.id,
      lat:            Number(p.lat),
      lng:            Number(p.lng),
      categorie:      'panneaux',
      sous_categorie: p.type_panneau ?? null,
      ville:          p.ville ?? undefined,
      adresse:        p.adresse ?? p.regie ?? undefined,
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0);

  const locationLabel = ville ?? region ?? departement
    ?? (regie ? `Panneaux ${regie}` : 'Panneaux OOH — France');

  const coordonnees = pois.length > 0
    ? {
        lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
        lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
      }
    : { lat: 46.8, lng: 2.3 };

  console.log(`[chat] analyser_panneaux(regie=${regie ?? '*'}, ${locationLabel}) → ${pois.length} panneaux`);

  return {
    ville:             locationLabel,
    region:            region      ?? null,
    departement:       departement ?? null,
    categorie_poi:     'panneaux',
    rayon_metres:      null,
    rayon_poi_metres:  null,
    coordonnees,
    pois,
    nb_pois:           pois.length,
    categories:        { panneaux: pois.length },
    isochrone_minutes: null,
    isochrone_mode:    null,
    isochroneGeoJSON:  null,
    couleur_overrides: { panneaux: couleur },
  };
}
