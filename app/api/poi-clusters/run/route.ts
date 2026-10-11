/**
 * POST /api/poi-clusters/run
 *
 * Lance un job de clustering en arrière-plan (child_process.spawn → Python).
 * Crée une ligne dans clustering_jobs, retourne l'ID immédiatement.
 * Le client poll GET /api/poi-clusters/run?job_id=<uuid> pour le statut.
 *
 * Body:
 *   poi_types    string[]   — types de POI à clustériser (ex: ["cirfa","lycee"])
 *   geo_filter   object     — { metropolitaine: boolean, regions: string[], depts: string[] }
 *   params       object     — { duration: number, transport: string, force_k?: number, dry_run?: boolean }
 *   features     string[]|null — features/thématiques à utiliser (null, absent ou [] = les 16,
 *                passées EXPLICITEMENT au script ; ex: ["demographie","revenus"]). Toujours
 *                transmis en --features : c'est ce qui enchaîne l'entraînement (full-retrain).
 *
 * POST Response: { job_id: string }
 * GET  Response: { job_id, status, started_at, finished_at, log_tail, error, result_meta }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z }                 from 'zod';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';
import { lireCorps }         from '@/lib/api/valider-corps';
import { ALL_FEATURES }      from '@/lib/clustering/feature-themes';
import { spawn }             from 'child_process';
import path                  from 'path';
import { existsSync }        from 'fs';

export const dynamic = 'force-dynamic';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts', 'clustering_poi_filosofi.py');
const LOG_MAX     = 8000;

/**
 * Corps du lancement de job.
 *
 * Validation OBLIGATOIRE ici, et pas seulement par principe : ces valeurs
 * partent en ARGUMENTS DE LIGNE DE COMMANDE. `spawn` recoit un tableau, donc
 * aucun shell n'est implique et il n'y a pas d'injection de commande — mais un
 * `poi_types` non borne enverrait au script une liste arbitraire, et une duree
 * hors plage lancerait des heures d'appels ORS.
 *
 * `tests/unit/api/validation-corps.test.ts` verrouille la regle (SEC-001) :
 * c'est lui qui a refuse cette route quand elle est revenue avec son
 * `await req.json()` nu du 5 juillet.
 */
const CorpsRunSchema = z.object({
  poi_types: z.array(z.string().min(1).max(64)).min(1).max(50),
  geo_filter: z.object({
    metropolitaine: z.boolean(),
    regions: z.array(z.string().max(16)).max(30),
    depts:   z.array(z.string().max(8)).max(110),
  }).optional(),
  params: z.object({
    duration:  z.number().int().min(5).max(120),
    transport: z.enum(['drive', 'walk', 'bike']).optional(),
    force_k:   z.number().int().min(2).max(20).optional(),
    dry_run:   z.boolean().optional(),
  }),
  features: z.array(z.string().min(1).max(64)).max(80).nullish(),
});

// ── GET — polling statut ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const jobId = req.nextUrl.searchParams.get('job_id');
  if (!jobId) return NextResponse.json({ error: 'job_id requis' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('clustering_jobs')
    .select('id, status, started_at, finished_at, log_tail, error, result_meta, poi_types, geo_filter, params')
    .eq('id', jobId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Job introuvable' }, { status: 404 });
  }

  return NextResponse.json(data);
}

// ── POST — lancer le job ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const lecture = await lireCorps(req, CorpsRunSchema);
  if (!lecture.ok) return NextResponse.json({ error: lecture.message }, { status: 400 });
  const { poi_types, geo_filter, params, features } = lecture.valeur;

  // Le calcul est un script Python lance en processus fils. Il n'y a AUCUN
  // runtime Python sur Vercel : la route creerait un job qui echouerait
  // aussitot. On le dit franchement plutot que de laisser un job « failed »
  // sans explication — c'est la difference avec le defaut des PMTiles, qui
  // ne s'affichait que sur le poste du developpeur sans jamais le dire.
  //
  // Le portage sur Modal (le service Python serverless que le projet exploite
  // deja pour le bidding) leve cette limite. Voir docs/PLAN_CLUSTERING.md.
  if (!existsSync(SCRIPT_PATH)) {
    return NextResponse.json({
      error: 'Moteur de clustering indisponible : le script Python est absent de ce deploiement.',
      detail: 'Le calcul ne tourne aujourd hui qu en local. Voir docs/PLAN_CLUSTERING.md (portage Modal).',
    }, { status: 503 });
  }

  const sb = createAdminClient();

  // Créer le job en base
  const { data: job, error: insertErr } = await sb
    .from('clustering_jobs')
    .insert({
      poi_types,
      geo_filter,
      params,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr || !job) {
    return NextResponse.json({ error: insertErr?.message ?? 'Erreur création job' }, { status: 500 });
  }

  const jobId = job.id as string;

  // Construire les args Python
  const pythonArgs: string[] = [
    SCRIPT_PATH,
    '--mode', 'cache-isochrones',
    '--duration', String(params.duration),
    '--transport', params.transport ?? 'drive',
    '--poi-type', poi_types.join(','),
    '--job-id', jobId,
  ];

  if (geo_filter) {
    pythonArgs.push('--geo-filter', JSON.stringify(geo_filter));
  }
  if (params.force_k) {
    pythonArgs.push('--force-k', String(params.force_k));
  }
  if (params.dry_run) {
    pythonArgs.push('--dry-run');
  }
  // --features : TOUJOURS passé. C'est lui, et lui seul, qui fait enchaîner au
  // script `cache-isochrones` → `full-retrain` (« Chainage automatique » de
  // `run_cache_isochrones`) : sans lui, le job met les isochrones en cache et
  // n'entraîne AUCUN modèle.
  //
  // features=null/absent/[] = toutes les variables. L'assistant envoie `null`
  // quand les 16 sont cochées. Jusqu'au 2026-10-11 la route omettait alors
  // `--features` en annonçant « toutes les variables » : le run réel du lot 4
  // (T20) a fini `done` sans modèle. On normalise donc en la liste complète,
  // lue à la source unique (`lib/clustering/feature-themes.ts`, miroir de
  // FEATURE_THEMES du script) — jamais recopiée ici.
  // features=['demographie'] → full-retrain avec ces variables.
  const variables = features && features.length > 0 ? features : ALL_FEATURES;
  pythonArgs.push('--features', variables.join(','));

  // Spawn Python en arrière-plan (non-bloquant)
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(python, pythonArgs, {
    detached: false,
    stdio:    ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Passer les credentials Supabase au script Python
      SUPABASE_URL:            process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      SUPABASE_SERVICE_KEY:    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    },
  });

  // Marquer running dès le spawn
  sb.from('clustering_jobs').update({ status: 'running' }).eq('id', jobId).then(() => {});

  let logBuffer = '';
  const appendLog = (chunk: string) => {
    logBuffer += chunk;
    if (logBuffer.length > LOG_MAX) logBuffer = logBuffer.slice(-LOG_MAX);
  };

  child.stdout?.on('data', (d: Buffer) => appendLog(d.toString()));
  child.stderr?.on('data', (d: Buffer) => appendLog(d.toString()));

  // Flush log toutes les 5s
  const flushInterval = setInterval(() => {
    if (logBuffer) {
      createAdminClient()
        .from('clustering_jobs')
        .update({ log_tail: logBuffer })
        .eq('id', jobId)
        .then(() => {});
    }
  }, 5000);

  child.on('close', (code: number | null) => {
    clearInterval(flushInterval);
    const status    = code === 0 ? 'done' : 'failed';
    const errorText = code !== 0 ? `Process exited with code ${code}` : null;
    createAdminClient()
      .from('clustering_jobs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        log_tail:    logBuffer,
        error:       errorText,
      })
      .eq('id', jobId)
      .then(() => {});
  });

  child.on('error', (err: Error) => {
    clearInterval(flushInterval);
    createAdminClient()
      .from('clustering_jobs')
      .update({
        status:      'failed',
        finished_at: new Date().toISOString(),
        log_tail:    logBuffer,
        error:       err.message,
      })
      .eq('id', jobId)
      .then(() => {});
  });

  return NextResponse.json({ job_id: jobId }, { status: 201 });
}
