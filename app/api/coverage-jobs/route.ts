/**
 * POST /api/coverage-jobs
 *
 * Crée le job, déclenche Inngest (async), répond immédiatement avec { jobId }.
 * Le worker Inngest appelle compute_coverage_fast — lit isochrones depuis DB,
 * pas de transit géométrie réseau. Realtime notifie le client à chaque étape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import { inngest }                   from '@/lib/inngest/client';

export const maxDuration = 30;


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      categorie,
      mode               = 'driving-car',
      target_column      = 'ind',
      poi_count          = 0,
      isochrone_duration = 30,
    } = body as {
      categorie:            string;
      mode?:                string;
      target_column?:       string;
      poi_count?:           number;
      isochrone_duration?:  number;
    };

    if (!categorie) {
      return NextResponse.json({ error: 'categorie requis' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: job, error: insertErr } = await supabase
      .from('calculation_jobs')
      .insert({
        target_column,
        poi_count,
        isochrone_duration,
        mode,
        status:   'pending',
        progress: 0,
      })
      .select('id')
      .single();

    if (insertErr || !job) {
      return NextResponse.json(
        { error: insertErr?.message ?? 'Insertion job échouée' },
        { status: 500 }
      );
    }

    await inngest.send({
      name: 'coverage/calculate',
      data: { jobId: job.id, categorie, mode, target_column, isochrone_duration },
    });

    return NextResponse.json({ jobId: job.id });

  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[coverage-jobs] Erreur:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
