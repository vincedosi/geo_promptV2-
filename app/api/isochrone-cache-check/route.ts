/**
 * POST /api/isochrone-cache-check
 *
 * Vérifie rapidement quels POIs ont leurs isochrones en cache.
 * Aucun appel ORS — lecture seule depuis isochrones_cache + poi_france.
 *
 * Body : { category, mode, paliers, metropolitaine?, filtre_ville?, filtre_regions? }
 *
 * Response :
 *   { total_pois, total_combos, cached_combos, missing_combos,
 *     missing_pois, cached_pois, missing_list: [{ id, nom, paliers_missing }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import { getRegionNameMap }          from '@/lib/geo/region-lookup-server';
import { z }                         from 'zod';
import { lireCorps }                 from '@/lib/api/valider-corps';
import { sourcesVisiblesDeLaRequete, filtrerParSourcesVisibles } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

/**
 * Les deux listes de filtres geographiques N'ONT PAS la meme tolerance, et la
 * difference est dans le code, pas dans une convention :
 *
 *  - `filtre_depts` passe par `.map(String)` : `[3, 75]` fonctionne, donc le
 *    schema accepte les nombres. Le restreindre aux chaines refuserait des
 *    appels qui marchent aujourd'hui.
 *  - `filtre_regions` sert de clef a `regionNames.get(r)` puis part dans
 *    `normStr` qui appelle `.toLowerCase()` : un nombre y LEVE. Chaines
 *    uniquement — ce 400 remplace un 500.
 *
 * `category` et `paliers` sont requis : ce schema remplace la garde
 * `if (!category || !paliers?.length)`, retiree plus bas.
 */
const VerifCacheSchema = z.object({
  category: z.string().min(1),
  mode: z.string().optional(),
  paliers: z.array(z.number()).nonempty(),
  metropolitaine: z.boolean().optional(),
  filtre_ville: z.string().optional(),
  filtre_regions: z.array(z.string()).optional(),
  filtre_depts: z.array(z.union([z.string(), z.number()])).optional(),
});

const CACHE_CHUNK = 200;
const MAX_POIS    = 500;

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function perPoiCacheKey(category: string, poiId: string, level: number, mode: string): string {
  return `battle__${normKey(category)}__${normKey(poiId)}__${level}min__${normKey(mode)}`;
}

export async function POST(req: NextRequest) {
  try {
    const corps = await lireCorps(req, VerifCacheSchema);
    if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
    const body = corps.valeur;

    const { category, paliers, filtre_ville, filtre_regions, filtre_depts } = body;
    const mode           = body.mode ?? 'drive';
    const metropolitaine = body.metropolitaine ?? true;
    // Étendu pour gérer les 2 formats hétérogènes en DB ('03'↔'3', '2A'↔'20A')
    const deptCanonical  = Array.isArray(filtre_depts) && filtre_depts.length > 0
      ? filtre_depts.map(String) : null;
    const deptFilter = deptCanonical ? (() => {
      const out = new Set<string>();
      for (const c of deptCanonical) {
        out.add(c);
        if (/^0[1-9]$/.test(c))      out.add(c.slice(1));
        else if (/^[1-9]$/.test(c))  out.add('0' + c);
        if (c === '2A')              out.add('20A');
        else if (c === '20A')        out.add('2A');
        if (c === '2B')              out.add('20B');
        else if (c === '20B')        out.add('2B');
      }
      return [...out];
    })() : null;

    const supabase = createAdminClient();

    // ── 1. Charger les POIs (même logique que la route bataille) ──────────────
    const normStr = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    const regions     = Array.isArray(filtre_regions) && filtre_regions.length > 0
      ? filtre_regions : null;
    const regionNames = regions ? await getRegionNameMap(supabase) : null;
    const regionNorms = regions && regionNames
      ? regions.map(r => normStr(regionNames.get(r) ?? r))
      : null;

    let q = supabase.from('poi_france')
      .select('id, nom, region, departement')
      .ilike('categorie', category);
    if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
    if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);
    if (deptFilter)     q = q.in('departement', deptFilter);
    // Même périmètre que la battle : sans lui, `missing_list` rendait le nom
    // des POI d'un autre client.
    q = filtrerParSourcesVisibles(q, await sourcesVisiblesDeLaRequete(req));

    const { data: rawRows, error: poiErr } = await q.limit(MAX_POIS);
    if (poiErr) {
      return NextResponse.json({ error: `Erreur chargement POIs : ${poiErr.message}` }, { status: 500 });
    }

    interface PoiRowSlim {
      id: string | number;
      nom?: string | null;
      region?: string | null;
      departement?: string | null;
    }
    const pois = ((rawRows ?? []) as PoiRowSlim[]).filter((p) => {
      if (!regionNorms) return true;
      const pNorm = normStr(p.region ?? '');
      return regionNorms.some((rn: string) => pNorm.includes(rn) || rn.includes(pNorm));
    });

    const total_pois   = pois.length;
    const total_combos = total_pois * paliers.length;

    if (total_pois === 0) {
      return NextResponse.json({
        total_pois: 0, total_combos: 0, cached_combos: 0, missing_combos: 0,
        missing_pois: 0, cached_pois: 0, missing_list: [],
      });
    }

    // ── 2. Lookup cache — toutes les clés en une passe (chunked) ─────────────
    const allKeys = pois.flatMap((p) =>
      paliers.map((l: number) => perPoiCacheKey(category, String(p.id), l, mode)),
    );

    const chunks: string[][] = [];
    for (let i = 0; i < allKeys.length; i += CACHE_CHUNK)
      chunks.push(allKeys.slice(i, i + CACHE_CHUNK));

    const results = await Promise.all(
      chunks.map(chunk =>
        supabase.from('isochrones_cache').select('cache_key').in('cache_key', chunk),
      ),
    );

    const cachedKeys = new Set<string>();
    for (const { data } of results) {
      for (const row of data ?? []) cachedKeys.add(row.cache_key);
    }

    // ── 3. Calculer le statut par POI ─────────────────────────────────────────
    const missing_list: { id: string; nom: string; paliers_missing: number[] }[] = [];
    let cached_pois  = 0;

    for (const p of pois) {
      const paliersMissing = paliers.filter(
        (l: number) => !cachedKeys.has(perPoiCacheKey(category, String(p.id), l, mode)),
      );
      if (paliersMissing.length === 0) {
        cached_pois++;
      } else {
        missing_list.push({ id: String(p.id), nom: p.nom ?? String(p.id), paliers_missing: paliersMissing });
      }
    }

    const cached_combos  = cachedKeys.size;
    const missing_combos = total_combos - cached_combos;

    return NextResponse.json({
      total_pois,
      total_combos,
      cached_combos,
      missing_combos,
      missing_pois:  missing_list.length,
      cached_pois,
      missing_list,  // top 20 pour affichage éventuel
    });

  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 500 });
  }
}
