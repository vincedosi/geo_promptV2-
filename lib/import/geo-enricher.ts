/**
 * lib/import/geo-enricher.ts
 * Enrichit les POIs sans région/département via l'API adresse.data.gouv.fr (reverse geocoding).
 * Appelé automatiquement après chaque import de POIs.
 */
import { createAdminClient } from '@/lib/auth';

async function reverseGeocode(lat: number, lng: number): Promise<{ region: string | null; departement: string | null }> {
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { region: null, departement: null };
    const data = await res.json();
    const context: string = data?.features?.[0]?.properties?.context ?? '';
    if (!context) return { region: null, departement: null };
    // context format: "14, Calvados, Normandie"
    const parts = context.split(',').map((s: string) => s.trim());
    return {
      departement: parts[1] ?? null,
      region: parts[2] ?? null,
    };
  } catch {
    return { region: null, departement: null };
  }
}

/**
 * Enrichit les POIs insérés sans région/département.
 * Non-bloquant : les erreurs sont loggées mais ne font pas échouer l'import.
 */
export async function enrichMissingGeo(
  dataSourceId: string,
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
): Promise<void> {
  const supabase = createAdminClient();

  const { data: pois } = await supabase
    .from('poi_france')
    .select('id,lat,lng')
    .eq('data_source_id', dataSourceId)
    .is('region', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(500);

  if (!pois?.length) return;

  onLog?.('info', `[GEO] Enrichissement region/dept pour ${pois.length} POIs...`);

  let updated = 0;
  const BATCH = 5;
  for (let i = 0; i < pois.length; i += BATCH) {
    const chunk = pois.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (poi) => {
      const { region, departement } = await reverseGeocode(poi.lat, poi.lng);
      if (!region) return;
      await supabase.from('poi_france').update({ region, departement }).eq('id', poi.id);
      updated++;
    }));
    if (i + BATCH < pois.length) await new Promise(r => setTimeout(r, 200));
  }

  onLog?.('info', `[GEO] ${updated}/${pois.length} POIs enrichis (region/dept)`);
}
