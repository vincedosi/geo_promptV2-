/**
 * POST /api/digital/[campaignId]/ai-analysis
 * Calls Gemini to analyze campaign geographic performance.
 * Body: { indicator, medias[], kpi, breakdown, heatmap_summary }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Contexte d'analyse fourni par l'ecran, pour construire le prompt Gemini.
 *
 * Volontairement permissif : ces valeurs ne partent pas en base, elles sont
 * interpolees dans un texte. `kpi` et les lignes de `breakdown` gardent donc des
 * champs libres — l'ecran en ajoute au fil des versions, et les refuser casserait
 * l'analyse sans rien proteger. Ce qui est verifie, c'est qu'il s'agit bien
 * d'objets et de tableaux : `breakdownRows.filter(r => r.ecart > 0)` sur autre
 * chose qu'un tableau levait.
 */
/**
 * Une ligne du tableau de repartition, telle que l'ecran la construit
 * (`BreakdownRow` dans `AnalysisPanel.tsx`). Les quatre champs lus par le
 * constructeur de prompt sont exiges ; `.passthrough()` laisse passer les
 * autres (`code`, `impressions`, `pop_value`) sans les retrancher.
 */
const LigneBreakdownSchema = z.object({
  nom: z.string(),
  ecart: z.number(),
  pct_imp: z.number(),
  pct_pop: z.number(),
}).passthrough();

const AnalyseIaSchema = z.object({
  indicator: z.string().optional(),
  medias: z.array(z.string()).optional(),
  kpi: z.record(z.unknown()).default({}),
  breakdown: z.array(LigneBreakdownSchema).default([]),
  heatmap_summary: z.string().optional(),
});

const limiter = createRateLimiter({ max: 3, window: '60 s', prefix: 'geo:rl:dig-ai' });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { ok, retrySec } = await limiter(`${profile.id}:${getClientKey(request)}`);
  if (!ok) return rateLimitResponse(retrySec);

  const { campaignId } = await params;
  const corps = await lireCorps(request, AnalyseIaSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { indicator, medias, kpi, breakdown, heatmap_summary } = corps.valeur;

  const supabase = createAdminClient();

  // Scope org : 404 uniforme (ne pas divulguer l'existence à une autre org).
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

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
Tu travailles sur la plateforme MAGELIAN et tu analyses les performances geographiques des campagnes DSP.

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
  } catch (err: unknown) {
    console.error('[ai-analysis]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
