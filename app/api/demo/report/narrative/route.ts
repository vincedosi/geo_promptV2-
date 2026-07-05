import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createModel } from '@/lib/chat/providers';
import { assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

const SYSTEM = [
  'Tu es analyste media chez une regie publicitaire.',
  'On te donne le bilan chiffre d\'une campagne pilotee (courbe de conformite par version,',
  'zone par zone avant/apres, budget planifie vs depense, KPI).',
  'Redige une synthese factuelle de 3 a 4 phrases en francais, en sentence case, sans superlatif.',
  'Cite les chiffres reels (ecart moyen, nombre de corrections, zones conformes, budget).',
  'Ne fais pas de liste, un seul paragraphe.',
].join(' ');

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
    if (!report) return NextResponse.json({ error: 'no_snapshot' }, { status: 400 });
    const { text } = await generateText({
      model: createModel('gemini'),
      system: SYSTEM,
      prompt: JSON.stringify({
        convergence: report.convergence, zones: report.zones,
        budget: report.budget, kpis: report.kpis,
      }),
      temperature: 0.2,
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    return NextResponse.json({ narrative: text.trim() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'narrative_failed' }, { status: 400 });
  }
}
