/**
 * POST /api/correlation/analyse
 * Génère une analyse géomarketing via Mistral AI.
 * Body : { stats, mode, metricLabel, poiLabel, metricXLabel?, metricYLabel? }
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface CorrelationStats {
  r:         number;
  rho:       number;
  r2:        number;
  p:         number;
  slope:     number;
  intercept: number;
  avgQ1:     number;
  avgQ4:     number;
  n:         number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      stats:         CorrelationStats;
      mode:          string;
      metricLabel?:  string;
      poiLabel?:     string;
      metricXLabel?: string;
      metricYLabel?: string;
      sigmaKm?:      number;
    };

    const { stats, mode, metricLabel, poiLabel, metricXLabel, metricYLabel, sigmaKm } = body;

    if (!stats || typeof stats.r !== 'number') {
      return NextResponse.json({ error: 'stats requis' }, { status: 400 });
    }

    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!mistralKey) {
      return NextResponse.json({ error: 'MISTRAL_API_KEY manquant côté serveur' }, { status: 500 });
    }

    const isIrisIris = mode === 'iris_iris';

    const sigmaInfo = !isIrisIris && sigmaKm
      ? `\nPortée d'influence σ : ${sigmaKm} km (score = Σ exp(−d²/2σ²), rayon 3σ = ${(sigmaKm * 3).toFixed(1)} km)`
      : '';

    const contextLine = isIrisIris
      ? `Variables : ${metricXLabel ?? '?'} (axe X) vs ${metricYLabel ?? '?'} (axe Y)`
      : `Variable IRIS : ${metricLabel ?? '?'}\nCatégorie POI : ${poiLabel ?? '?'}${sigmaInfo}`;

    const prompt = `Tu es un analyste géomarketing expert sur GENESIS.
Analyse cette corrélation entre zones IRIS en France.

${contextLine}
Mode : ${isIrisIris ? 'IRIS × IRIS' : 'IRIS × POI'}
Échantillon : ${stats.n} zones IRIS

Résultats :
- Pearson (r) = ${stats.r.toFixed(4)}
- Spearman (ρ) = ${stats.rho.toFixed(4)}
- R² = ${(stats.r2 * 100).toFixed(1)}%
- p-value ≈ ${stats.p < 0.01 ? '< 0.01' : stats.p.toFixed(3)}
- Régression : y = ${stats.slope.toFixed(6)} × x + ${stats.intercept.toFixed(2)}
- ${isIrisIris ? 'Moy. Y' : 'Score accessibilité'} Q1 (faible métrique) : ${stats.avgQ1.toFixed(2)}
- ${isIrisIris ? 'Moy. Y' : 'Score accessibilité'} Q4 (forte métrique)  : ${stats.avgQ4.toFixed(2)}

Produis une analyse structurée :
1. **Verdict** : En une phrase, exploitable ou non ?
2. **Interprétation** : Que signifie ce résultat pour un géomarketeur ?
3. **Recommandations** : 2-3 actions concrètes pour un décideur
4. **Limites** : Précautions d'interprétation

Sois concis (200 mots max), percutant, orienté business. Français.`;

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mistralKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Mistral ${response.status}: ${err.slice(0, 200)}` },
        { status: 500 }
      );
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const analysis = data.choices?.[0]?.message?.content ?? 'Pas de réponse.';
    return NextResponse.json({ analysis });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur Mistral';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
