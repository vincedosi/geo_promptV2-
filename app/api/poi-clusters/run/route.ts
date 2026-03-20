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
 *   features     string[]|null — features/thématiques à utiliser (null = toutes, ex: ["demographie","revenus"])
 *
 * POST Response: { job_id: string }
 * GET  Response: { job_id, status, started_at, finished_at, log_tail, error, result_meta }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { spawn }             from 'child_process';
import path                  from 'path';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts', 'clustering_poi_filosofi.py');
const LOG_MAX     = 8000;

// ── GET — polling statut ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
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
  const body = await req.json() as {
    poi_types:  string[];
    geo_filter: { metropolitaine: boolean; regions: string[]; depts: string[] };
    params:     { duration: number; transport: string; force_k?: number; dry_run?: boolean };
    features?:  string[] | null;
  };

  const { poi_types, geo_filter, params, features } = body;

  if (!poi_types?.length) {
    return NextResponse.json({ error: 'poi_types requis' }, { status: 400 });
  }
  if (!params?.duration || params.duration < 5 || params.duration > 120) {
    return NextResponse.json({ error: 'duration invalide (5-120 min)' }, { status: 400 });
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
  // --features : passe la sélection au script Python
  // features=null/undefined → omis = toutes les variables (comportement par défaut)
  // features=['demographie'] → chaîne cache-isochrones → full-retrain avec ces features
  if (features && features.length > 0) {
    pythonArgs.push('--features', features.join(','));
  }

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
