/**
 * POST /api/digital/[campaignId]/ai-analysis
 * Calls Gemini to analyze campaign geographic performance.
 * Body: { indicator, medias[], kpi, breakdown, heatmap_summary }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const body = await request.json();
  const { indicator, medias, kpi, breakdown, heatmap_summary } = body;

  const supabase = createAdminClient();

  // Get campaign name
  const { data: camp } = await supabase.from('dsp_campaigns').select('name').eq('id', campaignId).single();
  const campaignName = camp?.name ?? 'Campagne';

  // Get media stats
  let mediaStats = '';
  const { data: mediaData } = await supabase.rpc('get_campaign_medias', { p_campaign_id: campaignId });
  const mediaRows = typeof mediaData === 'string' ? JSON.parse(mediaData) : (mediaData ?? []);
  mediaStats = mediaRows.map((m: { media: string; total_impressions: number; nb_cp: number }) =>
    `- ${m.media}: ${Number(m.total_impressions).toLocaleString('fr-FR')} imp., ${m.nb_cp} CP`
  ).join('\n');

  // Build top sur-servis / sous-servis from breakdown
  const breakdownRows = Array.isArray(breakdown) ? breakdown : [];
  const surservis = breakdownRows.filter((r: { ecart: number }) => r.ecart > 0).sort((a: { ecart: number }, b: { ecart: number }) => b.ecart - a.ecart).slice(0, 5);
  const sousservis = breakdownRows.filter((r: { ecart: number }) => r.ecart < 0).sort((a: { ecart: number }, b: { ecart: number }) => a.ecart - b.ecart).slice(0, 5);

  const topSur = surservis.map((r: { nom: string; ecart: number; pct_imp: number; pct_pop: number }) =>
    `${r.nom}: +${r.ecart} pts (${r.pct_imp}% imp. vs ${r.pct_pop}% pop.)`
  ).join('\n') || 'Aucun';

  const topSous = sousservis.map((r: { nom: string; ecart: number; pct_imp: number; pct_pop: number }) =>
    `${r.nom}: ${r.ecart} pts (${r.pct_imp}% imp. vs ${r.pct_pop}% pop.)`
  ).join('\n') || 'Aucun';

  const indicatorLabel = indicator || 'population';
  const kpiData = kpi || {};

  const prompt = `Tu es un analyste geomarketing expert specialise en campagnes digitales programmatiques.
Tu travailles sur la plateforme GEOMATIK et tu analyses les performances geographiques des campagnes DSP.

## Donnees de la campagne

Campagne : ${campaignName}
Total impressions : ${Number(kpiData.totalImpressions ?? 0).toLocaleString('fr-FR')}
Population cible (${indicatorLabel}) : ${Number(kpiData.totalPop ?? 0).toLocaleString('fr-FR')}
Ratio moyen : ${Number(kpiData.ratioMoyen ?? 0).toFixed(1)}
Couverture : ${kpiData.couverturePct ?? 0}%
Concentration : les top 10% des zones concentrent ${Number(kpiData.concentrationTop10 ?? 0).toFixed(0)}% des impressions

## Breakdown geographique

Top 5 sur-servis (ecart impressions vs pop en points) :
${topSur}

Top 5 sous-servis :
${topSous}

## Regies

${mediaStats}

${heatmap_summary ? `## Resume heatmap regies x zones\n${heatmap_summary}` : ''}

## Ta mission

Produis une analyse structuree en francais :

1. **Diagnostic** (3-4 phrases) : resume de la performance geographique de la campagne. Ou est-elle bien calibree, ou derape-t-elle ?

2. **Analyse par regie** (2-3 phrases) : quelle regie contribue le plus au desequilibre ? Laquelle est la mieux repartie ?

3. **Recommandations** (3-5 points numerotes) : actions concretes pour reequilibrer. Pour chaque recommandation, donne un coefficient de ponderation estime (ex: "surponderer les Hauts-de-France avec un coefficient 1.5x").

4. **Score de qualite geographique** : note sur 100 la qualite de la distribution geographique de la campagne.

Sois concis (300 mots max), percutant, oriente business.
Ne repete pas les chiffres bruts, interprete-les.`;

  try {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    const result = await generateText({
      model: google('gemini-2.5-flash'),
      prompt,
      temperature: 0.3,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
    });

    return NextResponse.json({ analysis: result.text });
  } catch (err) {
    console.error('[ai-analysis]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
