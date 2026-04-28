/**
 * GENESIS — GET /api/admin/dsp-sources
 *
 * Liste des DSPs supportés = ceux qui ont au moins un mapping configuré
 * dans `dsp_source_mappings`. Drive le dropdown UI du modal d'import.
 *
 * Pas d'enum hardcodé : ajouter un DSP en base = INSERT, le dropdown se
 * met à jour automatiquement (cache 5 min côté serveur).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { listAvailableDsps } from '@/lib/dsp-mapping/loader';

export const dynamic = 'force-dynamic';

function capitalize(s: string): string {
  // 'ttd' → 'TTD' (acronymes ≤ 4 caractères en majuscules)
  // 'adform' → 'Adform'
  // 'amazon_dsp' → 'Amazon DSP'
  if (s.length <= 4) return s.toUpperCase();
  return s
    .split(/[_\s-]+/)
    .map((part) =>
      part.length <= 4 && /^[a-z]+$/.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(' ');
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const dsps = await listAvailableDsps();
    const sources = dsps.map((value) => ({ value, label: capitalize(value) }));
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
