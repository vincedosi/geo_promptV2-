'use client';

import type maplibregl from 'maplibre-gl';
import type React from 'react';

export interface OohExportData {
  action: 'export_ooh';
  ville: string;
  target_label: string;
  target_column: string;
  rayon_m: number;
  poids_demo: number;
  poids_contexte: number;
  pois: {
    rank: number;
    id: string;
    nom: string;
    regie: string;
    type: string;
    adresse: string;
    lat: number;
    lng: number;
    ville: string;
    score_ooh: number;
    audience: number;
    pop_totale_buffer: number;
    score_demo: number;
    score_contexte: number;
    poi_count: number;
  }[];
  nb_pois: number;
  coordonnees: { lat: number; lng: number };
}

// ── Pie chart via browser Canvas API ─────────────────────────────────────────
function generatePieChart(audience: number, popTotale: number, size = 60): string {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const ratio = popTotale > 0 ? Math.min(audience / popTotale, 1) : 0;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;

  // Background (gris)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#E2E8F0';
  ctx.fill();

  // Slice cible (violet)
  if (ratio > 0) {
    const start = -Math.PI / 2;
    const end   = start + ratio * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = '#8B5CF6';
    ctx.fill();
  }

  // Contour
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Label % au centre
  const pct = Math.round(ratio * 100);
  ctx.fillStyle = pct > 50 ? '#FFFFFF' : '#1E293B';
  ctx.font = `bold ${Math.round(size * 0.22)}px system-ui`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${pct}%`, cx, cy);

  return canvas.toDataURL('image/png');
}

// ── Export principal ──────────────────────────────────────────────────────────
export async function exportOohReport(
  data: OohExportData,
  mapRef: React.MutableRefObject<maplibregl.Map | null>,
  onStatus?: (msg: string) => void,
) {
  try {
    onStatus?.('Capture de la carte…');
    const mapCanvas = mapRef.current?.getCanvas();
    const mapScreenshot = mapCanvas ? mapCanvas.toDataURL('image/png') : null;

    onStatus?.('Génération des graphiques…');
    const pieCharts: Record<string, string> = {};
    for (const poi of data.pois) {
      pieCharts[poi.id] = generatePieChart(poi.audience, poi.pop_totale_buffer);
    }

    onStatus?.('Génération du fichier Excel…');
    const res = await fetch('/api/export/ooh-report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        pois:          data.pois,
        ville:         data.ville,
        target_label:  data.target_label,
        rayon_m:       data.rayon_m,
        mapScreenshot,
        pieCharts,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
      throw new Error(err.error ?? 'Erreur serveur');
    }

    onStatus?.('Téléchargement…');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const safeName = data.ville.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').toLowerCase();
    a.download = `rapport-ooh-${safeName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    onStatus?.('');
  } catch (err: unknown) {
    onStatus?.('');
    throw err;
  }
}
