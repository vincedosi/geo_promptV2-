import { logger } from '@/lib/logger';
/**
 * lib/chat/tools/isochrones.ts
 * Outils isochrone_battle (ORS live) et isochrone_battle_v2 (cache ST_Difference).
 */

/**
 * isochrone_battle_v2 — lit le cache ORS et applique ST_Difference (PostGIS).
 * Pas de calcul ORS → réponse rapide si cache présent.
 */
export async function isochroneBattleV2(args: Record<string, unknown>) {
  const category = args.category ? String(args.category) : '';
  if (!category) return { error: 'category requis pour isochrone_battle_v2' };

  const mode           = args.mode          ? String(args.mode)        : 'drive';
  const metropolitaine = args.metropolitaine !== false;
  const filtre_ville   = args.ville         ? String(args.ville)       : null;
  const filtre_region  = args.region        ? String(args.region)      : null;
  const paliers: number[] = Array.isArray(args.paliers)
    ? (args.paliers as number[]).map(Number).filter(n => n > 0)
    : [10, 20, 30, 60, 90];

  // Construire filtre_regions depuis region (simple string → tableau)
  const filtre_regions = filtre_region ? [filtre_region] : null;

  try {
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 90_000);

    const res = await fetch(`${baseUrl}/api/isochrone-battle-v2`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({ category, mode, metropolitaine, filtre_ville, filtre_regions, paliers }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      let msg = errText;
      try { msg = JSON.parse(errText)?.error ?? errText; } catch { /* brut */ }
      return { error: msg, category };
    }

    // Lire le stream NDJSON jusqu'au résultat final
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: Record<string, unknown> | null = null;
    const warnings: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'error')   return { error: String(evt.message ?? 'Erreur inconnue'), category };
        if (evt.type === 'warning') warnings.push(String(evt.message ?? ''));
        if (evt.type === 'result')  result = evt.data as Record<string, unknown>;
      }
    }
    reader.releaseLock();

    if (!result) return { error: 'Réponse incomplète de isochrone-battle-v2', category };
    if (result.error) return { error: String(result.error), category };

    const nb_features = (result.nb_features as number) ?? 0;
    const nb_pois     = (result.nb_pois     as number) ?? 0;
    logger.debug('chat/isochrone_battle_v2', `"${category}" → ${nb_features} features, ${nb_pois} POIs`);

    return {
      category, mode, paliers, metropolitaine,
      nb_pois, nb_features,
      fromCache: result.fromCache ?? false,
      warnings: warnings.length > 0 ? warnings : undefined,
      battleGeoJSON: result.battleGeoJSON,
      poisForMap:    result.poisForMap,
    };

  } catch (error) {
    const e   = error instanceof Error ? error : new Error(String(error));
    const msg = e.name === 'AbortError'
      ? 'Timeout (>90s). Lance la bataille depuis /map onglet Analyses pour remplir le cache.'
      : e.message;
    console.error('[chat/isochrone_battle_v2] Fetch error:', msg);
    return { error: msg, category };
  }
}

export async function isochroneBattle(
  args:    Record<string, unknown>,
  options: { forceRecalculate?: boolean } = {},
) {
  const category       = args.category ? String(args.category) : '';
  if (!category) return { error: 'category requis pour isochrone_battle' };

  const mode           = args.mode          ? String(args.mode)        : 'drive';
  const metropolitaine = args.metropolitaine !== false;
  const filtre_ville   = args.ville         ? String(args.ville)       : null;
  const filtre_region  = args.region        ? String(args.region)      : null;
  const filtre_dept    = args.departement   ? String(args.departement) : null;
  const max_minutes    = args.max_minutes   ? Number(args.max_minutes) : 120;

  try {
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 280_000);

    const res = await fetch(`${baseUrl}/api/isochrone-battle`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        category, mode, metropolitaine,
        filtre_ville, filtre_region,
        filtre_departement:  filtre_dept,
        force_recalculate:   options.forceRecalculate ?? false,
        max_minutes,
      }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const errText = await res.text();
      console.error('[chat/isochrone_battle] Erreur endpoint HTTP', res.status, ':', errText);
      let friendlyErr = errText;
      try { friendlyErr = JSON.parse(errText)?.error ?? errText; } catch { /* garder brut */ }
      return { error: friendlyErr, category };
    }

    const data = await res.json();
    logger.debug('chat/isochrone_battle', `"${category}" → ${data.nb_features ?? 0} features, ${data.nb_pois ?? 0} POIs`);
    return data;

  } catch (error) {
    const e   = error instanceof Error ? error : new Error(String(error));
    const msg = e.name === 'AbortError'
      ? "Timeout (>280s) : trop de CIRFA à calculer sans cache. Lance la bataille depuis /map d'abord pour remplir le cache ORS."
      : e.message;
    console.error('[chat/isochrone_battle] Fetch error:', msg);
    return { error: msg, category };
  }
}
