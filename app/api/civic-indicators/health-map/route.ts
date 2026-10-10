/**
 * GET /api/civic-indicators/health-map
 *   ?dataset=pollen|atmo&scale=departement|cp&min_level=0-6&metric=global|<espèce|polluant>&bbox=w,s,e,n
 *
 * Carte santé environnementale (allergènes + qualité de l'air), deux échelles :
 *
 *   scale=departement (défaut) — échantillonnage 1 commune représentative
 *   par département (RPC get_dept_representative_communes) via le pipeline
 *   groupé getHealthEnMasse (cache lu et écrit PAR LOTS : ~5 requêtes de base
 *   au lieu de jusqu'à 312, mesure du 2026-09-13). Streaming NDJSON
 *   (progression temps réel), chaque ligne dept porte pollen ET air :
 *     {"type":"meta","total":104}
 *     {"type":"dept","code_dept":"22","nom_dept":"...","pollen":{...},"air":{...},"stale":false}
 *     {"type":"done","fetched":100,"failed":4}
 *
 *   scale=cp — lit pollen_map_daily / atmo_map_daily (ingestion bulk WFS
 *   nationale, niveaux max des communes du CP) en UN appel à la RPC
 *   `lire_sante_cp_jsonb` (sql/244, 2026-10-10) : dernier jour, filtre
 *   min_level sur la métrique demandée, `bbox` optionnelle par le centroïde
 *   du CP (`ref_codes_postaux.centroid`, geometry GIST — PAS
 *   `centroid_lat/centroid_lon`, NULL sur les 6 187 lignes), borne écrite.
 *   Avant, deux plafonds PostgREST muets à 1 000 (table du jour et
 *   `codes_postaux_dans_bbox`). JSON :
 *     {"date":"2026-07-03","rows":[{"code_postal":"29200","indice_global":4,...}]}
 *     ou {"date":null,"rows":[],"error":"no_data"} si l'ingestion n'a jamais tourné.
 *
 * min_level/metric ne s'appliquent qu'à scale=cp (au département, le filtre
 * est côté client — les ~104 valeurs sont déjà chargées). `bbox` ne s'applique
 * qu'à scale=cp egalement (le département n'a pas de notion de bbox).
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire côté UI).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { getHealthEnMasse } from '@/lib/civic-health/get-health';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Appels provider simultanés (tiers HTTP, pas la base : le cache est lu et écrit par lots). */
const CONCURRENCY = 3;
/**
 * Borne écrite des lignes lues au code postal (`lire_sante_cp_jsonb`, sql/244).
 * La clé primaire `(date_ech, code_postal)` impose une ligne par CP et par
 * jour, donc au plus un par CP du pays : 6 187 au référentiel (2026-10-10).
 * La RPC rend du jsonb, hors plafond PostgREST ; au-delà, elle dit `tronque`
 * et la route échoue plutôt que de peindre un début.
 */
const BORNE_LIGNES_CP = 10_000;

const POLLEN_METRICS = ['global', 'ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'] as const;
const ATMO_METRICS = ['global', 'no2', 'o3', 'pm10', 'pm25', 'so2'] as const;

const querySchema = z.object({
  dataset: z.enum(['pollen', 'atmo']).default('pollen'),
  scale: z.enum(['departement', 'cp']).default('departement'),
  min_level: z.coerce.number().int().min(0).max(6).default(0),
  metric: z.string().default('global'),
  // [west, south, east, north] — lib/carte/filtre.ts (Tache 4). Ne s'applique
  // qu'a scale=cp ; ignore sur scale=departement (echantillon national fixe).
  bbox: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
});

interface DeptRow {
  code_dept: string;
  nom_dept: string;
  code_commune: string;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }
  const { dataset, scale, min_level, metric, bbox } = parsed.data;
  const validMetrics: readonly string[] = dataset === 'pollen' ? POLLEN_METRICS : ATMO_METRICS;
  if (!validMetrics.includes(metric)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }
  const supabase = createAdminClient();

  // ── Échelle code postal : lecture table quotidienne (ingestion bulk WFS) ──
  if (scale === 'cp') {
    // UN appel (sql/244) : date la plus récente, seuil sur la métrique, bbox
    // par le centroïde du CP (`ref_codes_postaux.centroid`, GIST — jamais
    // `centroid_lat/lon`, NULL partout) et borne, tout en base. Avant, la table
    // du jour passait par PostgREST (`max_rows` = 1 000) et la bbox par
    // `codes_postaux_dans_bbox` (RETURNS TABLE, 1 000 CP sur 6 051 en
    // métropole) : deux plafonds muets.
    const [ouest, sud, est, nord] = bbox ? bbox.split(',').map(Number) : [];
    const { data: brut, error: rpcErr } = await supabase.rpc('lire_sante_cp_jsonb', {
      p_jeu: dataset,
      p_metrique: metric,
      p_niveau_min: Math.max(min_level, 1), // 0 = indisponible, jamais peint
      ...(bbox ? { p_ouest: ouest, p_sud: sud, p_est: est, p_nord: nord } : {}),
      p_limite: BORNE_LIGNES_CP,
    });
    const lu = brut as { date: string | null; rows: { code_postal: string }[]; tronque: boolean } | null;
    if (rpcErr || !lu) {
      logger.error('civic-health/health-map', `lire_sante_cp_jsonb : ${rpcErr?.message ?? 'sans donnée'}`);
      return NextResponse.json({ error: 'Lecture de la santé environnementale impossible.' }, { status: 500 });
    }
    if (!lu.date) {
      return NextResponse.json({ date: null, rows: [], error: 'no_data' });
    }
    if (lu.tronque) {
      logger.error('civic-health/health-map', `plus de ${BORNE_LIGNES_CP} lignes au ${lu.date}`);
      return NextResponse.json(
        { error: `Plus de ${BORNE_LIGNES_CP} codes postaux à lire : la carte ne peut pas les afficher.` },
        { status: 500 },
      );
    }
    const { date, rows } = lu;
    return NextResponse.json(
      { date, rows },
      // no-store : le flux no_data → ingestion admin → refetch doit voir la
      // donnée fraîche immédiatement (un max-age ferait rejouer le no_data
      // depuis le cache navigateur). Lecture SQL indexée (PK date) — léger.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ── Échelle département : échantillonnage streaming (pollen + air) ────────
  const { data: depts, error } = await supabase.rpc('get_dept_representative_communes') as {
    data: DeptRow[] | null;
    error: { message: string } | null;
  };
  if (error || !depts) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Une commune représentative peut, en théorie, servir plusieurs départements :
  // on résout chaque commune UNE fois et on émet une ligne par département.
  const deptsParCommune = new Map<string, DeptRow[]>();
  for (const d of depts) {
    const code = d.code_commune.toUpperCase();
    const liste = deptsParCommune.get(code);
    if (liste) liste.push(d); else deptsParCommune.set(code, [d]);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      send({ type: 'meta', total: depts.length });

      let fetched = 0;
      let failed = 0;

      try {
        // Cache lu et écrit PAR LOTS (lib/civic-health/get-health.ts) : 1 lecture
        // groupée + provider sur les seuls manquants + ⌈n/50⌉ écritures + 1
        // lecture périmée, au lieu de jusqu'à 3 requêtes PAR département.
        await getHealthEnMasse([...deptsParCommune.keys()], {
          concurrence: CONCURRENCY,
          surResultat: (code, data) => {
            for (const dept of deptsParCommune.get(code) ?? []) {
              if (data?.pollen || data?.air) {
                fetched++;
                send({
                  type: 'dept',
                  code_dept: dept.code_dept,
                  nom_dept: dept.nom_dept,
                  pollen: data.pollen,
                  air: data.air,
                  stale: data.stale,
                });
              } else {
                failed++;
                send({ type: 'dept', code_dept: dept.code_dept, nom_dept: dept.nom_dept, pollen: null, air: null });
              }
            }
          },
        });
      } catch (err) {
        logger.error('civic-health/health-map', `département : ${err instanceof Error ? err.message : err}`);
      }
      send({ type: 'done', fetched, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
