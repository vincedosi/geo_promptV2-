/**
 * POST /api/poi-clusters/models/[version]/generate-analysis
 * Lance le script Python --mode generate-analysis --model-version X
 * Retourne immédiatement { job_id } — le client poll GET /api/poi-clusters/run?job_id=...
 */
import { NextResponse }    from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { spawn }             from 'child_process';
import path                  from 'path';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts', 'clustering_poi_filosofi.py');
const LOG_MAX     = 4000;

export async function POST(
  _req: Request,
  { params }: { params: { version: string } },
) {
  const version = parseInt(params.version, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();

  // Créer un job de suivi
  const { data: job, error: insertErr } = await sb
    .from('clustering_jobs')
    .insert({
      poi_types:  [],
      params:     { mode: 'generate-analysis', model_version: version },
      status:     'running',
    })
    .select('id')
    .single();

  if (insertErr || !job) {
    return NextResponse.json({ error: insertErr?.message ?? 'Erreur création job' }, { status: 500 });
  }

  const jobId = job.id as string;

  const python = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(python, [
    SCRIPT_PATH,
    '--mode', 'generate-analysis',
    '--model-version', String(version),
  ], {
    detached: false,
    stdio:    ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SUPABASE_URL:              process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    },
  });

  let logBuffer = '';
  const appendLog = (chunk: string) => {
    logBuffer += chunk;
    if (logBuffer.length > LOG_MAX) logBuffer = logBuffer.slice(-LOG_MAX);
  };

  child.stdout?.on('data', (d: Buffer) => appendLog(d.toString()));
  child.stderr?.on('data', (d: Buffer) => appendLog(d.toString()));

  const flushInterval = setInterval(() => {
    if (logBuffer) {
      createAdminClient()
        .from('clustering_jobs')
        .update({ log_tail: logBuffer })
        .eq('id', jobId)
        .then(() => {});
    }
  }, 3000);

  child.on('close', (code: number | null) => {
    clearInterval(flushInterval);
    createAdminClient()
      .from('clustering_jobs')
      .update({
        status:      code === 0 ? 'done' : 'failed',
        finished_at: new Date().toISOString(),
        log_tail:    logBuffer,
        error:       code !== 0 ? `Exit code ${code}` : null,
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

  return NextResponse.json({ job_id: jobId }, { status: 202 });
}
