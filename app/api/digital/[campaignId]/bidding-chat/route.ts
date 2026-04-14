/**
 * POST /api/digital/[campaignId]/bidding-chat
 *
 * Chat multi-turn avec Gemini pour optimisation bidding géographique.
 * L'utilisateur exprime une intention, Gemini retourne une réponse
 * textuelle et (quand les coefficients sont finalisés) un bloc JSON
 * structuré avec coefficients + code DV360 + code Adform + simulation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, type ModelMessage } from 'ai';
import { createAdminClient } from '@/lib/auth';
import googleAdsGeoIds from '@/lib/digital/google-ads-geo-ids.json';

export const dynamic = 'force-dynamic';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BreakdownItem {
  code: string;
  nom: string;
  impressions: number;
  pop_value: number;
  pct_imp: number;
  pct_pop: number;
  ecart: number;
}

interface MediaItem {
  media: string;
  total_impressions?: number;
  impressions?: number;
}

interface BiddingChatBody {
  message: string;
  history: ChatMessage[];
  context: {
    campaign_name?: string;
    indicator: string;
    breakdown: BreakdownItem[];
    medias?: MediaItem[];
    metric: 'impressions' | 'unique';
    aggregation: 'region' | 'dept' | 'cp';
  };
}

interface CoefficientRow {
  code: string;
  nom: string;
  coeff: number;
  ecart_avant: number;
  ratio_apres_estime?: number;
}

interface SimulationRow {
  code: string;
  nom: string;
  ratio_avant: number;
  ratio_apres: number;
}

interface StructuredPayload {
  coefficients?: CoefficientRow[];
  code_dv360?: string;
  code_adform?: string;
  simulation?: SimulationRow[];
}

const regionGeoIds = (googleAdsGeoIds as { regions: Record<string, { geo_id: number; name: string }> }).regions;

function buildSystemPrompt(ctx: BiddingChatBody['context'], campaignName: string): string {
  const breakdown = ctx.breakdown ?? [];
  const metricLabel = ctx.metric === 'unique' ? 'impressions uniques' : 'impressions';
  const aggLabel = ctx.aggregation === 'region' ? 'régions' : ctx.aggregation === 'dept' ? 'départements' : 'codes postaux';

  const surservis = breakdown.filter(r => r.ecart > 0).sort((a, b) => b.ecart - a.ecart).slice(0, 8);
  const sousservis = breakdown.filter(r => r.ecart < 0).sort((a, b) => a.ecart - b.ecart).slice(0, 8);

  const surLines = surservis.map(r => `  - ${r.code} ${r.nom}: ecart +${r.ecart.toFixed(2)} pts (pct_imp=${r.pct_imp.toFixed(2)}%, pct_pop=${r.pct_pop.toFixed(2)}%)`).join('\n') || '  (aucune)';
  const sousLines = sousservis.map(r => `  - ${r.code} ${r.nom}: ecart ${r.ecart.toFixed(2)} pts (pct_imp=${r.pct_imp.toFixed(2)}%, pct_pop=${r.pct_pop.toFixed(2)}%)`).join('\n') || '  (aucune)';

  const mediaLines = (ctx.medias ?? []).slice(0, 8)
    .map(m => `  - ${m.media}: ${Number(m.total_impressions ?? m.impressions ?? 0).toLocaleString('fr-FR')} imp.`)
    .join('\n') || '  (non fourni)';

  const geoIdMappingJson = ctx.aggregation === 'region'
    ? JSON.stringify(regionGeoIds, null, 2)
    : '(mapping geo_id uniquement disponible au niveau region — au niveau dept/cp, utilise les codes INSEE directement)';

  return `Tu es l'assistant bidding de GEOMATIK, specialise dans l'optimisation geographique des campagnes programmatiques OOH/DOOH et display.

## Contexte campagne
Nom: ${campaignName}
Cible: ${ctx.indicator}
Metrique: ${metricLabel}
Agregation courante: ${aggLabel}
Nombre de zones analysees: ${breakdown.length}

## Distribution actuelle (ecart = pct_imp - pct_pop)

Top sur-servis:
${surLines}

Top sous-servis:
${sousLines}

## Regies actives
${mediaLines}

## Mapping Google Ads geo_id (regions FR)
${geoIdMappingJson}

## Ton role

1. COMPRENDRE l'intention de l'utilisateur (uniformiser, renforcer une zone, reduire le gaspillage, etc).
2. PARAPHRASER la demande pour confirmer en une phrase: "Compris: vous souhaitez...".
3. CALCULER les coefficients de bidding par zone:
   - coeff > 1 = surponderer (encherir plus fort)
   - coeff < 1 = sous-ponderer
   - coeff = 1 = pas de changement
   - MIN 0.1, MAX 3.0, arrondir a 2 decimales
4. PRESENTER les coefficients dans ta reponse texte, zone par zone, triee par ampleur.
5. Des que tu as les coefficients finaux, inclus dans ta reponse un bloc JSON delimite par \`\`\`json ... \`\`\` avec cette structure EXACTE:

\`\`\`json
{
  "coefficients": [
    { "code": "32", "nom": "Hauts-de-France", "coeff": 1.82, "ecart_avant": -8.5, "ratio_apres_estime": 1.02 }
  ],
  "code_dv360": "# Custom Bidding Script GEOMATIK\\n# ...",
  "code_adform": "{ \\"rules\\": [...] }",
  "simulation": [
    { "code": "32", "nom": "Hauts-de-France", "ratio_avant": 0.45, "ratio_apres": 0.82 }
  ]
}
\`\`\`

### Generation code_dv360 (Python)
- Fonction \`calculate_bid(bid_request)\` qui retourne le multiplicateur.
- Dictionnaire \`COEFFICIENTS\` keye sur le geo_id Google Ads (utilise le mapping fourni au niveau region).
- Commentaires en-tete avec nom de campagne + cible + date.
- Retour 1.0 par defaut si geo_id non trouve.

### Generation code_adform (JSON)
- Tableau \`rules\` avec chaque entree: \`{ "targeting": { "geo": { "code": "FR-11" }}, "bid_modifier": 1.45 }\`.
- Utilise le code ISO 3166-2 FR pour les regions (FR-11, FR-32, etc.), sinon code INSEE pour les departements.

### Simulation
- Pour chaque zone avec coefficient, estime \`ratio_apres = ratio_avant * coeff\`.
- \`ratio_avant = pct_imp / pct_pop\` (1.0 = equilibre parfait).

## Regles absolues
- Sois concis et oriente action.
- Ne repete pas les donnees brutes, interprete-les.
- Si l'utilisateur est vague, propose l'uniformisation comme option par defaut.
- Si l'utilisateur demande un coefficient > 3 ou < 0.1, explique pourquoi c'est impossible et propose une alternative.
- Utilise TOUJOURS les vrais noms de zones (jamais juste les codes).
- Ne genere le bloc JSON QUE quand les coefficients sont finalises (apres confirmation de l'utilisateur ou a la fin d'une iteration claire). Si l'utilisateur pose une question, reponds en texte seul sans bloc JSON.
- Si le bloc JSON est genere, la reponse texte qui le precede doit etre une phrase courte d'introduction.`;
}

function extractJsonPayload(text: string): StructuredPayload | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as StructuredPayload;
  } catch (err) {
    console.error('[bidding-chat] JSON parse failed:', err);
    return null;
  }
}

function stripJsonBlock(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, '').trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  let body: BiddingChatBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, history = [], context } = body;
  if (!message || !context || !Array.isArray(context.breakdown)) {
    return NextResponse.json({ error: 'Missing message or context.breakdown' }, { status: 400 });
  }

  const supabase = createAdminClient();
  let campaignName = context.campaign_name ?? '';
  if (!campaignName) {
    const { data: camp } = await supabase.from('dsp_campaigns').select('name').eq('id', campaignId).single();
    campaignName = camp?.name ?? 'Campagne';
  }

  const systemPrompt = buildSystemPrompt(context, campaignName);

  const messages: ModelMessage[] = [
    ...history.slice(-10).map<ModelMessage>(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  try {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    const result = await generateText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      messages,
      temperature: 0.4,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
    });

    const rawText = result.text;
    const payload = extractJsonPayload(rawText);
    const reply = payload ? stripJsonBlock(rawText) : rawText;

    return NextResponse.json({
      reply,
      coefficients: payload?.coefficients,
      code_dv360: payload?.code_dv360,
      code_adform: payload?.code_adform,
      simulation: payload?.simulation,
    });
  } catch (err) {
    console.error('[bidding-chat]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
