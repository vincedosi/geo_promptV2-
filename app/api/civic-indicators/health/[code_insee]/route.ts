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
import {
  getFreshCachedHealth,
  getStaleCachedHealth,
  upsertCachedHealth,
} from '@/lib/civic-health/cache';

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

  // 1. Cache lookup — fresh (< 24h)
  try {
    const fresh = await getFreshCachedHealth(codeInsee);
    if (fresh) {
      return NextResponse.json(
        { data: fresh, provider: getProvider().name },
        { headers: { 'Cache-Control': 'private, max-age=3600' } },
      );
    }
  } catch (err) {
    console.warn('[civic-health/route] cache lookup failed', err);
    // continue
  }

  // 2. Fetch provider
  const provider = getProvider();
  let payload = null;
  try {
    payload = await provider.fetchHealth(codeInsee);
  } catch (err) {
    console.warn('[civic-health/route] provider error', err);
  }

  if (payload) {
    upsertCachedHealth(codeInsee, payload, provider.name).catch(err => {
      console.warn('[civic-health/route] cache upsert failed', err);
    });
    return NextResponse.json(
      { data: payload, provider: provider.name },
      { headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  }

  // 3. Fallback stale (< 48h)
  const stale = await getStaleCachedHealth(codeInsee).catch(() => null);
  if (stale) {
    return NextResponse.json(
      { data: stale, provider: provider.name },
      { headers: { 'Cache-Control': 'private, max-age=600' } },
    );
  }

  // 4. Total miss
  return NextResponse.json({
    data: null,
    provider: provider.name,
    error: 'unavailable',
    message: `Données ATMO + pollen indisponibles pour la commune ${codeInsee}.`,
  });
}
