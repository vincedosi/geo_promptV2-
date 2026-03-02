/**
 * GENESIS — API Route — POST /api/admin/geocode/update
 * Update a single geocode result: manual lat/lng or re-geocode with corrected address.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { geocodeSingle, scoreToStatus } from '@/lib/import/geocoder';
import type { GeocodeDetailedResult, GeocodeReviewData } from '@/lib/import/types';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

const GEOCODE_DIR = path.join(os.tmpdir(), 'genesis-geocode');

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const body = await request.json();
    const { geocodeId, rowIndex, action } = body as {
      geocodeId: string;
      rowIndex: number;
      action:
        | { type: 'manual'; lat: number; lng: number }
        | { type: 'reGeocode'; address: string }
        | { type: 'ignore' };
    };

    if (!geocodeId || rowIndex === undefined || !action) {
      return NextResponse.json({ success: false, error: 'Parametres manquants' }, { status: 400 });
    }

    // Load geocode results
    const geocodePath = path.join(GEOCODE_DIR, `${geocodeId}.json`);
    if (!fs.existsSync(geocodePath)) {
      return NextResponse.json(
        { success: false, error: 'Resultats de geocodage introuvables. Re-lancez le geocodage.' },
        { status: 404 }
      );
    }

    const data: GeocodeReviewData = JSON.parse(fs.readFileSync(geocodePath, 'utf-8'));
    const resultIdx = data.results.findIndex((r) => r.rowIndex === rowIndex);

    if (resultIdx === -1) {
      return NextResponse.json(
        { success: false, error: `Ligne ${rowIndex} introuvable dans les resultats` },
        { status: 404 }
      );
    }

    let updatedResult: GeocodeDetailedResult = { ...data.results[resultIdx] };

    if (action.type === 'manual') {
      // Manual lat/lng override
      if (isNaN(action.lat) || isNaN(action.lng)) {
        return NextResponse.json({ success: false, error: 'Lat/lng invalides' }, { status: 400 });
      }

      updatedResult = {
        ...updatedResult,
        lat: action.lat,
        lng: action.lng,
        score: 1.0,
        resultLabel: 'Saisie manuelle',
        resultType: 'manual',
        status: 'green',
        manualOverride: true,
      };
    } else if (action.type === 'reGeocode') {
      // Re-geocode with corrected address
      if (!action.address || !action.address.trim()) {
        return NextResponse.json({ success: false, error: 'Adresse vide' }, { status: 400 });
      }

      const geoResult = await geocodeSingle(action.address);

      if (geoResult.lat !== null && geoResult.lng !== null) {
        const score = geoResult.score ?? 0;
        updatedResult = {
          ...updatedResult,
          inputAddress: action.address,
          lat: geoResult.lat,
          lng: geoResult.lng,
          score,
          resultLabel: action.address,
          status: scoreToStatus(score),
          manualOverride: true,
        };
      } else {
        updatedResult = {
          ...updatedResult,
          inputAddress: action.address,
          lat: null,
          lng: null,
          score: geoResult.score ?? 0,
          resultLabel: 'Non trouve avec la nouvelle adresse',
          status: 'red',
          manualOverride: true,
        };
      }
    } else if (action.type === 'ignore') {
      // Mark as ignored (will be excluded from import)
      updatedResult = {
        ...updatedResult,
        status: 'red',
        manualOverride: true,
        resultLabel: 'Ignore par l\'utilisateur',
      };
    }

    // Update in the data
    data.results[resultIdx] = updatedResult;

    // Recompute stats
    data.stats = {
      green: data.results.filter((r) => r.status === 'green').length,
      orange: data.results.filter((r) => r.status === 'orange').length,
      red: data.results.filter((r) => r.status === 'red').length,
    };

    // Save back
    fs.writeFileSync(geocodePath, JSON.stringify(data));

    return NextResponse.json({
      success: true,
      updatedResult,
      stats: data.stats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur mise a jour geocodage';
    console.error('[GEOCODE-UPDATE] Error:', err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
