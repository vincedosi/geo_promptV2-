/**
 * Résolution de la zone finale d'une stratégie depuis un panier de cibles.
 * n=0 → national ; n=1 → zone directe ; n>1 → crée la composite (union + save).
 * Extrait verbatim de StepLancement (wizard).
 * CLIENT uniquement (adminFetch).
 */
import { adminFetch } from '@/lib/admin-fetch';

export async function resolveFinalZone(
  cibles: { id: string; name: string }[],
  orgId: string | null,
): Promise<{ scope_type: 'national' | 'custom_zone'; zone_id: string | null }> {
  if (cibles.length === 0) return { scope_type: 'national', zone_id: null };
  if (cibles.length === 1) return { scope_type: 'custom_zone', zone_id: cibles[0].id };
  if (!orgId) throw new Error('Organisation introuvable pour fusionner les zones cibles');
  const geoRes = await adminFetch('/api/custom-geo/source/composite', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_ids: cibles.map((c) => c.id) }),
  });
  if (!geoRes.ok) throw new Error('Fusion des zones cibles échouée');
  const geo = await geoRes.json();
  const saveRes = await adminFetch('/api/custom-geo/save', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Cible composite (${cibles.length} zones) — ${new Date().toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`,
      source_type: 'composite',
      source_metadata: { kind: 'composite', member_zone_ids: cibles.map((c) => c.id) },
      geometry: geo.geometry,
      org_id: orgId,
    }),
  });
  if (!saveRes.ok) throw new Error('Sauvegarde de la zone composite échouée');
  if (saveRes.status === 207) {
    throw new Error('Zone composite créée mais résolution des codes échouée — relance le lancement.');
  }
  const saved = await saveRes.json();
  return { scope_type: 'custom_zone', zone_id: saved.zone_id };
}
