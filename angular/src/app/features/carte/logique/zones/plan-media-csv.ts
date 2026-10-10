import { CIBLE_LABEL, CIBLE_UNIT, type CibleKey } from './cibles';
import { csvEscapeCell } from './csv-escape';
import type { LignePlan, Plan } from './plan-media';
import { toSlug } from './slug';

/** Séparateur français : Excel ouvre le fichier sans assistant d'import (`ZoneMediaPlanPanel.tsx:348`). */
const SEP = ';';

/** Nombre au format fr-FR à `d` décimales exactement, vide sans valeur (`num`). */
function num(n: number | null, d = 0): string {
  return n == null ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Ce que l'export du tableau lit. */
export interface EntreeCsv {
  lignes: readonly LignePlan[];
  plan: Plan;
  cible: CibleKey;
  budget: number;
  cpm: number;
  /** Le nom de la campagne rattachée, vide sans rattachement. */
  nomCampagne: string;
}

/**
 * « Exporter le tableau (CSV) » — `exportTableCsv` de `ZoneMediaPlanPanel.tsx:347-379`, ligne pour ligne : quatre
 * lignes de métadonnées, une vide, l'en-tête, une ligne par zone, le total ; BOM en tête pour qu'Excel lise l'UTF-8.
 * Les noms de zone passent par `csvEscapeCell` : un nom commençant par `=`, `+`, `-` ou `@` serait une formule.
 */
export function csvPlanMedia(e: EntreeCsv): string {
  const { totalVolume: tv, impressionsTotales: ti, franceTotal: ft } = e.plan;
  const meta = [
    `Plan média${e.nomCampagne ? ` — ${e.nomCampagne}` : ''}`,
    `Cible${SEP}${CIBLE_LABEL[e.cible]} (${CIBLE_UNIT[e.cible]})`,
    `Budget${SEP}${e.budget > 0 ? e.budget : ''}${SEP}CPM${SEP}${e.cpm > 0 ? e.cpm : ''}`,
    `Impressions totales${SEP}${ti != null ? Math.round(ti) : ''}`,
    '',
  ];
  const entete = ['Zone', '% total', '% France', `Volume (${CIBLE_UNIT[e.cible]})`, 'Impressions', 'Répétition', 'Coût/1000 cible (€)', 'Répartition %'];
  const corps = e.lignes.map((r) => {
    const m = e.plan.metriques.get(r.id)!;
    return [
      csvEscapeCell(r.name, SEP), num(m.pctZones, 1), num(m.pctFrance, 2), num(m.vol),
      num(m.impressions), num(m.frequence, 1), num(m.costPerMille), num(m.share, 1),
    ].join(SEP);
  });
  const total = [
    'Total', tv > 0 ? '100' : '', ft && tv > 0 ? num((tv / ft) * 100, 2) : '',
    num(tv), num(ti), num(ti && tv > 0 ? ti / tv : null, 1),
    num(e.budget > 0 && tv > 0 ? e.budget / (tv / 1000) : null), '100',
  ].join(SEP);
  return '﻿' + [...meta, entete.join(SEP), ...corps, total].join('\n');
}

/** `plan_media.csv`, ou `plan_media_<campagne>.csv` avec une campagne rattachée. */
export function nomFichierPlan(nomCampagne: string): string {
  return `plan_media${nomCampagne ? '_' + toSlug(nomCampagne) : ''}.csv`;
}
