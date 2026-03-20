import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

interface OohPoi {
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      pois: OohPoi[];
      ville: string;
      target_label: string;
      rayon_m: number;
    };

    const { pois, ville, target_label, rayon_m } = body;
    const wb = XLSX.utils.book_new();

    // =========================================================================
    // Onglet 1 — Classement complet
    // =========================================================================
    const rankRows = [
      [
        'Rang', 'Référence', 'Régie', 'Type', 'Ville',
        'Score OOH /100', 'Audience cible', 'Pop. totale buffer', '% Couverture',
        'Score Démo /100', 'Score Contexte /100', 'POI proches',
      ],
      ...pois.map(p => {
        const pct = p.pop_totale_buffer > 0
          ? +(p.audience / p.pop_totale_buffer * 100).toFixed(1)
          : 0;
        return [
          p.rank, p.nom, p.regie, p.type, p.ville,
          p.score_ooh, p.audience, p.pop_totale_buffer, pct,
          p.score_demo, p.score_contexte, p.poi_count,
        ];
      }),
    ];

    const wsRank = XLSX.utils.aoa_to_sheet(rankRows);

    // Column widths
    wsRank['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 13 },
      { wch: 14 }, { wch: 16 }, { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, wsRank, 'Classement');

    // =========================================================================
    // Onglet 2 — Couverture par panneau
    // =========================================================================
    const covRows = [
      ['Rang', 'Référence', 'Régie', 'Score OOH', 'Audience cible', 'Pop. totale', '% Couverture'],
      ...pois.map(p => {
        const pct = p.pop_totale_buffer > 0
          ? +(p.audience / p.pop_totale_buffer * 100).toFixed(1)
          : 0;
        return [p.rank, p.nom, p.regie, p.score_ooh, p.audience, p.pop_totale_buffer, pct];
      }),
    ];

    const wsCov = XLSX.utils.aoa_to_sheet(covRows);
    wsCov['!cols'] = [
      { wch: 6 }, { wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 },
    ];
    XLSX.utils.book_append_sheet(wb, wsCov, 'Couverture');

    // =========================================================================
    // Onglet 3 — Résumé
    // =========================================================================
    const top5 = pois.slice(0, 5);
    const totalAudience = pois.reduce((s, p) => s + p.audience, 0);
    const avgScore = pois.length ? +(pois.reduce((s, p) => s + p.score_ooh, 0) / pois.length).toFixed(1) : 0;

    const summaryRows = [
      ['Rapport OOH — ' + ville],
      [],
      ['Cible', target_label],
      ['Rayon par panneau', rayon_m + ' m'],
      ['Nombre de panneaux scorés', pois.length],
      ['Audience totale (cible)', totalAudience.toLocaleString('fr-FR')],
      ['Score OOH moyen', avgScore],
      [],
      ['TOP 5 panneaux'],
      ['Rang', 'Référence', 'Régie', 'Score OOH', 'Audience cible', '% Couverture'],
      ...top5.map(p => {
        const pct = p.pop_totale_buffer > 0
          ? +(p.audience / p.pop_totale_buffer * 100).toFixed(1) : 0;
        return [p.rank, p.nom, p.regie, p.score_ooh, p.audience, pct];
      }),
    ];

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary['!cols'] = [
      { wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 13 },
    ];
    // Merge title cell
    wsSummary['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé');

    // =========================================================================
    // Output
    // =========================================================================
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = ville
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-').toLowerCase();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="rapport-ooh-${safeName}.xlsx"`,
      },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[export/ooh-report]', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
