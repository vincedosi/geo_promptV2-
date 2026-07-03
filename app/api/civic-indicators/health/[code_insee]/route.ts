/**
 * GET /api/civic-indicators/health/[code_insee]
 *
 * Renvoie les indicateurs de santé environnementale (air ATMO + pollen)
 * pour une commune française identifiée par son code INSEE.
 *
 * Pipeline :
 *   1. requireAuth() — utilisateur MAGELIAN authentifié
 *   2. Validation Zod du code (5 chars, ^[0-9AB]\d{4}$ pour gérer Corse 2A/2B)
 *   3. Cache Supabase fresh (< 24h) → HIT, return
 *   4. Provider mock | atmofrance → fetch
 *   5. Upsert cache + return
 *   6. Si provider échoue : fallback stale (< 48h) avec stale=true
 *   7. Sinon : { data: null, error: 'unavailable' }
 *
 * Source des données : Atmo France et AASQA (licence ODbL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { getProvider } from '@/lib/civic-health/provider';
import { getHealthWithCache } from '@/lib/civic-health/get-health';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

// Format INSEE commune : 5 caractères. Métropole = 5 chiffres ; Corse = 2A ou 2B + 3 chiffres.
const CodeInseeSchema = z
  .string()
  .regex(/^(2[AB]\d{3}|\d{5})$/i, 'Code INSEE invalide (5 caractères, ex: 75056 ou 2A041).');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code_insee: string }> },
): Promise<NextResponse> {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { code_insee: rawCode } = await params;
  const parsed = CodeInseeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        provider: getProvider().name,
        error: 'invalid_code',
        message: parsed.error.issues[0]?.message ?? 'Code INSEE invalide.',
      },
      { status: 400 },
    );
  }
  const codeInsee = parsed.data.toUpperCase();

  // Pipeline partagé : cache fresh (< 24h) → provider → fallback stale (< 48h)
  const { data, provider } = await getHealthWithCache(codeInsee);

  if (data) {
    return NextResponse.json(
      { data, provider },
      // Donnée stale (fallback après échec provider) : cache client court
      { headers: { 'Cache-Control': `private, max-age=${data.stale ? 600 : 3600}` } },
    );
  }

  return NextResponse.json({
    data: null,
    provider,
    error: 'unavailable',
    message: `Données ATMO + pollen indisponibles pour la commune ${codeInsee}.`,
  });
}
