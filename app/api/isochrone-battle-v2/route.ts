/**
 * /api/isochrone-battle-v2/route.ts
 *
 * Bataille multi-paliers (ex: 10, 20, 30, 40, 50, 60, 90 min).
 *
 * AUCUN appel ORS — lit uniquement le cache isochrones_cache.
 * Si un palier manque en cache pour un POI, il est skipé avec un warning.
 *
 * Utilise la fonction PostGIS get_isochrone_battle_v10 :
 *   - ST_Subdivide pour résoudre les chevauchements intra-palier
 *   - Attribution au POI le plus proche (ST_Distance) dans les zones de recouvrement
 *
 * Sur une ZONE enregistrée (`zone_id`, ④ finitions T3, A-6) : la zone est lue AVANT le flux dans l'espace de la session
 * (`requireAuth`, `espaceDeZone`) — absente ou d'un autre espace, 404 `zone_introuvable` sans lire un POI ; zone pays,
 * 422. Les POI de la catégorie sont ceux de la zone (`poi_de_zone`, sql/297, catégorie d'abord), les filtres région,
 * département et ville sont ignorés, et la clé de cache porte l'id ET la version de la zone (`updated_at`) : une zone
 * recalculée en ③ ne relit jamais la bataille de l'ancienne forme. Le suffixe `__p<empreinte>` reste le dernier (la
 * capture de ③ le lit). La capacité de 700 anneaux s'applique telle quelle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import { z } from 'zod';
import {
  sourcesVisiblesDeLaRequete, filtrerParSourcesVisibles, empreintePerimetre,
} from '@/lib/auth/perimetre-donnees';
import {
  PLAFOND_LECTURE_POI, refusBorneNationale, refusCapaciteAnneaux, sansTerritoire,
} from '@/lib/isochrones/borne-nationale';
import { paquetsDeCles } from '@/lib/isochrones/paquets-cles';
import { formaterNombre } from '@/lib/format/nombre';
import { requireAuth } from '@/lib/api/middleware';
import { espaceDeZone, zoneIntrouvable } from '@/lib/zones/session-zones';
import { estRecettePays } from '@/lib/zones/couverture';

export const dynamic = 'force-dynamic';

export const maxDuration = 300;

const battleV2Schema = z.object({
  category:       z.string().min(1, 'category requis'),
  mode:           z.string().default('drive'),
  metropolitaine: z.boolean().default(true),
  filtre_regions: z.array(z.string()).nullable().default(null),
  filtre_depts:   z.array(z.string()).nullable().default(null),
  filtre_ville:   z.string().nullable().default(null),
  paliers:        z.array(z.number().int().min(1).max(180)).default([10, 20, 30, 40, 50, 60, 90]),
  force_battle:   z.boolean().default(false),
  zone_id:        z.string().uuid().nullable().default(null),
});

/** Une zone pays (sql/296) : la bataille nationale garde sa borne de lecture, elle se lance depuis ① (A-6). */
const REFUS_ZONE_PAYS = 'Sur toute la France, la bataille se lance depuis l’étape ① (France métropolitaine).';

/** Lecture tronquée sur une zone (`poi_de_zone` rend `tronque`) : la bataille ne part jamais sur un début de liste. */
function refusZoneTronquee(categorie: string): string {
  return `Plus de ${formaterNombre(PLAFOND_LECTURE_POI)} POI « ${categorie} » dans la zone : ce calcul dépasse ce qu’on `
    + 'peut calculer en direct. Il se lancera en tâche de fond dès le lot « calculs longs » ; en attendant, choisissez '
    + 'une zone plus petite.';
}

// Map code_region INSEE → nom_region depuis ref_regions (cache module).
// Remplace l'ancien REGION_ID_TO_NAME hardcodé par des codes alpha ('ara',
// 'bre') qui ne matchaient pas le code_region INSEE envoyé par FilterPanel
// (refonte dynamique via ref_regions).
import { getRegionNameMap } from '@/lib/geo/region-lookup-server';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { toJson } from '@/lib/supabase/rpc-json';

/**
 * Étend les codes département pour matcher les 2 formats hétérogènes en DB
 * (CIRFA: '3', '20A' / BMW: '03', '2B' — incohérences d'imports historiques).
 */
function expandDeptCodes(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    out.add(c);
    if (/^0[1-9]$/.test(c))      out.add(c.slice(1));
    else if (/^[1-9]$/.test(c))  out.add('0' + c);
    if (c === '2A')              out.add('20A');
    else if (c === '20A')        out.add('2A');
    if (c === '2B')              out.add('20B');
    else if (c === '20B')        out.add('2B');
  }
  return [...out];
}

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
  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const parsed = battleV2Schema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join(', ') }, { status: 400 });
  }

  const {
    category,
    mode,
    metropolitaine,
    paliers,
    force_battle,
    zone_id,
  } = parsed.data;
  // Sur une zone, les filtres de ① sont ignorés (A-6) : la forme de la zone borne la lecture.
  const filtre_regions = zone_id ? null : parsed.data.filtre_regions;
  const filtre_depts   = zone_id ? null : parsed.data.filtre_depts;
  const filtre_ville   = zone_id ? null : parsed.data.filtre_ville;

  // La zone, AVANT le flux : un id d'un autre espace répond 404 sans qu'aucun POI soit lu.
  let zone: { id: string; version: number; orgId: string } | null = null;
  if (zone_id) {
    const s = espaceDeZone(await requireAuth(req));
    if (!s.ok) return s.reponse;
    const { data: z, error: zErr } = await createAdminClient().from('custom_geo_zones')
      .select('id, updated_at, recette').eq('id', zone_id).eq('org_id', s.espace.orgId).maybeSingle();
    if (zErr) {
      console.error('[battle-v2] zone :', zErr.message);
      return NextResponse.json({ error: 'Lecture de la zone impossible.' }, { status: 500 });
    }
    if (!z) return zoneIntrouvable();
    if (estRecettePays(z.recette)) {
      return NextResponse.json({ error: REFUS_ZONE_PAYS, refus: 'zone_pays' }, { status: 422 });
    }
    zone = { id: z.id, version: Date.parse(z.updated_at), orgId: s.espace.orgId };
  }

  // deptCodesCanonical = format ALL_DEPTS reçu (cache key déterministe)
  // deptFilter = étendu pour matcher les 2 formats hétérogènes en DB
  const deptCodesCanonical = Array.isArray(filtre_depts) && filtre_depts.length > 0
    ? filtre_depts.map(String) : null;
  const deptFilter = deptCodesCanonical ? expandDeptCodes(deptCodesCanonical) : null;

  const MODE_NORMALIZE: Record<string, string> = {
    drive: 'drive', 'driving-car': 'drive',
    walk:  'walk',  'foot-walking': 'walk',
    bike:  'bike',  'cycling-regular': 'bike',
  };
  const normalizedMode  = MODE_NORMALIZE[String(mode)] ?? 'drive';
  const PALIERS: number[] = [...paliers].sort((a, b) => a - b);

  // Lu AVANT le flux : la session vient de la requête. La battle ne porte que
  // sur les POI que l'appelant a le droit de voir, et son cache est cloisonné
  // par l'empreinte de ce périmètre.
  const sources = await sourcesVisiblesDeLaRequete(req);
  const perimetre = empreintePerimetre(sources);

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const supabase = createAdminClient();

        // ── 0. Cache résultat complet ──────────────────────────────────────
        const normStr = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        const regions     = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
          ? (filtre_regions as string[]) : null;
        const regionKey   = regions ? [...regions].sort().join('+') : metropolitaine ? 'metro' : 'all';
        const deptKey     = deptCodesCanonical ? `__d${[...deptCodesCanonical].sort().join('-')}` : '';
        const territoireKey = zone ? `z${zone.id}_${zone.version}` : `${regionKey}${deptKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;
        const battleCacheKey = `battle_v2_full__${normKey(String(category))}__${normKey(normalizedMode)}__${PALIERS.join('-')}min__${territoireKey}__p${perimetre}`;

        if (!force_battle) {
          const { data: cached } = await supabase
            .from('isochrones_cache').select('geojson').eq('cache_key', battleCacheKey).single();
          if (cached?.geojson) {
            interface BattleCachePayload {
              battleGeoJSON?: { features?: unknown[] } | null;
              battleBorders?: unknown;
              poisForMap?: unknown[];
            }
            const c = cached.geojson as BattleCachePayload;
            send({ type: 'result', data: {
              battleGeoJSON: c.battleGeoJSON,
              battleBorders: c.battleBorders ?? null,
              poisForMap:    c.poisForMap,
              nb_features: c.battleGeoJSON?.features?.length ?? 0,
              nb_pois:     c.poisForMap?.length ?? 0,
              category, mode: normalizedMode, paliers: PALIERS,
              fromCache: true, battleCacheKey,
            }});
            return;
          }
        }

        // ── 1. Charger les POIs ────────────────────────────────────────────
        const regionNames = regions ? await getRegionNameMap(supabase) : null;
        const regionNorms = regions && regionNames
          ? regions.map(r => normStr(regionNames.get(r) ?? r))
          : null;

        let rawRows: any[] | null;
        if (zone) {
          // Catégorie d'abord, puis la forme (sql/297) ; `p_limite + 1` lu : une lecture tronquée est refusée.
          const { data, error: poiErr } = await supabase.rpc('poi_de_zone', {
            p_zone: zone.id, p_org: zone.orgId, p_categorie: category,
            p_sources: sources, p_limite: PLAFOND_LECTURE_POI,
          });
          if (poiErr) { send({ type: 'error', message: `Erreur chargement POIs : ${poiErr.message}` }); return; }
          const lu = rpcJson<{ pois?: any[]; tronque?: boolean; refus?: string }>(data);
          if (lu?.refus === 'zone_introuvable') { send({ type: 'error', message: 'Zone introuvable dans cet espace.' }); return; }
          // Zone devenue pays entre la lecture et le flux : la phrase du 422, pas « réponse illisible » (revue finale).
          if (lu?.refus === 'zone_pays') { send({ type: 'error', message: REFUS_ZONE_PAYS }); return; }
          if (!lu || !Array.isArray(lu.pois)) { send({ type: 'error', message: 'Erreur chargement POIs : réponse illisible' }); return; }
          if (lu.tronque) { send({ type: 'error', message: refusZoneTronquee(String(category)) }); return; }
          rawRows = lu.pois;
        } else {
          let q = supabase.from('poi_france')
            .select('id, nom, lat, lng, categorie, adresse, ville, region, departement')
            .ilike('categorie', category);
          if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
          if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);
          if (deptFilter)     q = q.in('departement', deptFilter);
          q = filtrerParSourcesVisibles(q, sources);

          const { data, error: poiErr } = await q.limit(PLAFOND_LECTURE_POI);
          if (poiErr) { send({ type: 'error', message: `Erreur chargement POIs : ${poiErr.message}` }); return; }
          rawRows = data;
        }

        const pois = (rawRows ?? [])
          .filter((p: any) => {
            if (p.lat == null || p.lng == null) return false;
            if (!regionNorms) return true;
            const pNorm = normStr(p.region ?? '');
            return regionNorms.some(rn => pNorm.includes(rn) || rn.includes(pNorm));
          })
          .map((p: any) => ({
            id: String(p.id), nom: p.nom ?? '', lat: Number(p.lat), lng: Number(p.lng),
            categorie: p.categorie ?? category, adresse: p.adresse ?? '', ville: p.ville ?? '',
          }));

        if (pois.length < 2) {
          send({ type: 'error', message: `Moins de 2 POIs trouvés pour "${category}"` }); return;
        }

        // Borne TECHNIQUE d'une bataille sans territoire (retours du 26/10, T2 ; aucune borne produit, Q-1 de
        // Vincent). D'abord la lecture : 500 POI lus, c'est une lecture tronquée — refus AVANT de lire le cache
        // (3 500 géométries pour 7 paliers). Puis, une fois le cache lu, les anneaux RÉELLEMENT trouvés.
        const borneNationale = !zone && sansTerritoire({ filtre_ville, filtre_regions, filtre_depts });
        // La troncature se lit sur les lignes LUES, pas sur les POI gardés après le retrait des coordonnées nulles
        // (revue finale T8, m-1 du groupe A) : 500 lignes dont une sans coordonnées restent une lecture tronquée.
        const lus = rawRows?.length ?? 0;
        if (borneNationale && lus >= PLAFOND_LECTURE_POI) {
          send({ type: 'error', message: refusBorneNationale(lus, PALIERS.length) }); return;
        }
        send({ type: 'pois_loaded', total: pois.length });

        // ── 2. Lecture cache — paquets lus en SÉQUENCE ─────────────────────
        // Pas de `Promise.all` : 500 POI × 7 paliers feraient des dizaines de lectures simultanées de géométries,
        // au-delà des 3 appels Supabase simultanés de CLAUDE.md (§ Disk I/O). Paquets taillés pour l'URL
        // (`paquetsDeCles`) et erreur LUE : un paquet refusé ne fait plus une bataille partielle en silence.
        const allKeys = pois.flatMap(p =>
          PALIERS.map(l => perPoiCacheKey(category, p.id, l, normalizedMode)),
        );
        const cacheHitMap = new Map<string, object>();
        for (const paquet of paquetsDeCles(allKeys)) {
          const { data, error: cacheErr } = await supabase.from('isochrones_cache')
            .select('cache_key, geojson').in('cache_key', paquet);
          if (cacheErr) { send({ type: 'error', message: `Erreur lecture du cache : ${cacheErr.message}` }); return; }
          for (const row of data ?? []) {
            const geom = (row.geojson as any)?.features?.[0]?.geometry;
            if (geom) cacheHitMap.set(row.cache_key, geom);
          }
        }

        // ── 3. Construire les rings depuis le cache ───────────────────────
        type RingEntry = {
          cirfa_id: string; nom: string; lat: number; lng: number;
          palier: number; geojson: object;
        };
        const rings: RingEntry[] = [];
        const missingLog: { poi: string; palier: number }[] = [];

        for (const poi of pois) {
          for (const palier of PALIERS) {
            const ck   = perPoiCacheKey(category, poi.id, palier, normalizedMode);
            const geom = cacheHitMap.get(ck);
            if (geom) {
              rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier, geojson: geom });
            } else {
              missingLog.push({ poi: poi.nom, palier });
            }
          }
        }

        // La capacité de 700 anneaux vaut pour TOUT périmètre (relecture 1, I-2) : elle décrit le calcul, pas le
        // territoire. Une bataille locale qui la dépasse partirait au-delà des 60 s de Kong.
        const refusAnneaux = borneNationale
          ? refusBorneNationale(pois.length, PALIERS.length, rings.length)
          : refusCapaciteAnneaux(pois.length, PALIERS.length, rings.length);
        if (refusAnneaux) { send({ type: 'error', message: refusAnneaux }); return; }

        if (missingLog.length > 0) {
          const sample = missingLog.slice(0, 5).map(m => `${m.poi}@${m.palier}min`).join(', ');
          console.warn(`[battle-v2] ${missingLog.length} paliers manquants en cache (ex: ${sample})`);
          send({ type: 'warning', message: `${missingLog.length} paliers manquants en cache — skippés.`, sample });
        }

        if (rings.length === 0) {
          send({ type: 'error', message: 'Aucun isochrone trouvé en cache. Lance d\'abord le calcul des isochrones pour les paliers voulus.' });
          return;
        }

        send({ type: 'rings_loaded', count: rings.length, missing: missingLog.length });

        // ── 4. Appel PostGIS get_isochrone_battle_v10 ────────────────────
        const p_rings = rings.map(r => ({
          cirfa_id: r.cirfa_id,
          nom:      r.nom,
          lat:      r.lat,
          lng:      r.lng,
          palier:   r.palier,
          geojson:  JSON.stringify(r.geojson),
        }));

        send({ type: 'computing', message: `PostGIS — ${rings.length} anneaux, ${PALIERS.length} paliers…` });

        const { data: battleResult, error: battleErr } = await supabase.rpc(
          'get_isochrone_battle',
          { p_rings },
        );

        if (battleErr) {
          send({ type: 'error', message: `Erreur PostGIS : ${battleErr.message}` });
          return;
        }

        const features: GeoJSON.Feature[] = Array.isArray(battleResult) ? (rpcJson<GeoJSON.Feature[]>(battleResult) ?? []) : [];
        const battleGeoJSON = { type: 'FeatureCollection', features };
        const poisForMap    = pois.map(p => ({
          id: p.id, nom: p.nom, lat: p.lat, lng: p.lng,
          categorie: p.categorie, adresse: p.adresse, ville: p.ville,
        }));

        // ── 5. Cache résultat complet ─────────────────────────────────────
        await supabase.from('isochrones_cache').upsert({
          cache_key: battleCacheKey, ville: '_battle_v2_full_', categorie: String(category),
          minutes: Math.max(...PALIERS), mode: normalizedMode,
          geojson: toJson({ battleGeoJSON, battleBorders: null, poisForMap }),
          poi_count: pois.length, created_at: new Date().toISOString(),
        }, { onConflict: 'cache_key' });

        send({ type: 'result', data: {
          battleGeoJSON, battleBorders: null, poisForMap,
          nb_features: features.length, nb_pois: pois.length,
          category, mode: normalizedMode, paliers: PALIERS,
          battleCacheKey,
        }});

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        console.error('[battle-v2]', msg);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}
