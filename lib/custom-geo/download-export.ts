'use client';

/**
 * MAGELIAN — téléchargement authentifié d'un export de zone custom.
 *
 * L'auth API passe par le header Authorization (Bearer token Supabase) :
 * un window.open() n'envoie pas ce header → 401 « Authentification requise ».
 * On fetch donc via adminFetch puis on déclenche le téléchargement du blob.
 */
import { adminFetch } from '@/lib/admin-fetch';
import type { CustomGeoExportFormat } from '@/types/custom-geo';

export async function downloadZoneExport(
  zoneId: string,
  format: CustomGeoExportFormat,
  /** Paramètres additionnels (ex. weights/budget du plan média pondéré). */
  params?: Record<string, string>,
): Promise<void> {
  const sp = new URLSearchParams({ format, ...(params ?? {}) });
  const res = await adminFetch(`/api/custom-geo/${zoneId}/export?${sp}`);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `zone_${zoneId}_${format}`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
