/**
 * lib/chat/tools/isochrones.ts
 * Outil isochrone_battle — sectorisation routière par anneaux isochrones.
 */

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
    console.log(`[chat/isochrone_battle] "${category}" → ${data.nb_features ?? 0} features, ${data.nb_pois ?? 0} POIs`);
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
