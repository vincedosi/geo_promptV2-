import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createModel } from '@/lib/chat/providers';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:analysis' });

// POST /api/analysis
// Body: { ville, kpis, tiers, top_panneaux, radar, profile_nom, context? }
export async function POST(req: NextRequest) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  const { ok, retrySec } = await limiter(`${profile.id}:${getClientKey(req)}`);
  if (!ok) return rateLimitResponse(retrySec);

  try {
    const body = await req.json();
    const { ville, kpis, tiers, top_panneaux, radar, profile_nom, context } = body;

    if (!ville) return NextResponse.json({ error: 'ville requis' }, { status: 400 });

    const topTier = tiers?.find((t: { tier: string }) => t.tier === 'Top');
    const tierLines = (tiers ?? [])
      .map((t: { tier: string; range: string; count: number }) => `  - ${t.tier} (${t.range}): ${t.count} panneaux`)
      .join('\n');
    const topLines = (top_panneaux ?? [])
      .slice(0, 5)
      .map((p: { nom: string; score: number; distance_lycee?: number | null; regie?: string | null }, i: number) =>
        `  ${i + 1}. "${p.nom}" — score ${p.score}${p.distance_lycee ? ` | lycée à ${Math.round(p.distance_lycee)}m` : ''}${p.regie ? ` | ${p.regie}` : ''}`
      )
      .join('\n');
    const radarLines = (radar ?? [])
      .map((r: { critere: string; top20: number; moyenne: number }) =>
        `  - ${r.critere}: top20=${Math.round(r.top20)} / moy=${Math.round(r.moyenne)}`
      )
      .join('\n');

    const prompt = `Tu es un expert en communication Out-Of-Home (OOH) et DOOH, spécialisé dans les campagnes de recrutement militaire.

Analyse les résultats du scoring OOH pour la ville de **${ville}**${profile_nom ? ` (profil : ${profile_nom})` : ''} :

## Résultats globaux
- Total panneaux scorés : ${kpis?.total ?? '?'}
- Score moyen : ${kpis?.score_moyen ?? '?'}/100
- Score maximum : ${kpis?.score_max ?? '?'}/100
- Panneaux Top (score ≥ 80) : ${kpis?.top_tier_count ?? '?'} soit ${kpis?.top_tier_pct ?? '?'}%

## Répartition par tier
${tierLines}

## Top 5 panneaux
${topLines}

## Scores par critère (top 20 vs moyenne)
${radarLines}

${context ? `## Contexte additionnel\n${context}` : ''}

**Fournis une analyse structurée en 3 parties :**

1. **Bilan global** — Qualité globale du parc OOH de ${ville} pour le recrutement. Les panneaux Top représentent-ils une bonne opportunité de campagne ? Que révèle l'écart top20/moyenne ?

2. **Recommandations opérationnelles** — Quels panneaux prioriser ? Faut-il élargir la prospection géographique ? Y a-t-il des critères sous-performants à travailler ?

3. **Points de vigilance** — Risques ou limites de l'analyse (couverture du scoring, biais des données, saisonnalité, concurrence OOH).

Sois concis, factuel, orienté action. Format markdown. Pas d'emojis.`;

    const model = createModel('mistral');
    const result = await streamText({ model, prompt });

    return result.toTextStreamResponse();
  } catch (err: unknown) {
    console.error('[api/analysis]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
