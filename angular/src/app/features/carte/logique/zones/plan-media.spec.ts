import {
  type LignePlan, calculerPlan, cellulesPlan, celluleTotal, corpsInstantane, corpsPlan, formaterRepetition, ligneZoneEntiere,
  lignesDesItems, lireMontant, poidsDesItems,
} from './plan-media';
import { csvPlanMedia, nomFichierPlan } from './plan-media-csv';

/** L'espace fine insécable que `toLocaleString('fr-FR')` met entre les milliers. */
const E = ' ';

const LIGNES: LignePlan[] = [
  { id: 'z1:p1', name: 'CIRFA Rennes', values: { total: 333_333, '18_24': 30_000 } },
  { id: 'z1:p2', name: 'CIRFA Brest', values: { total: 111_111, '18_24': 10_000 } },
  { id: 'z2', name: 'Zone sans statistiques', values: null },
];
const TOTAUX = { total: 68_000_000, '18_24': 5_000_000 };

describe('plan média — calculs recopiés de ZoneMediaPlanPanel.tsx', () => {
  it('budget 10 000 €, CPM 5 € : 2 000 000 impressions, réparties au prorata du volume cible', () => {
    const plan = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: null, budget: 10_000, cpm: 5, totaux: TOTAUX });
    expect(plan.impressionsTotales).toBe(2_000_000);
    expect(plan.totalVolume).toBe(444_444);
    expect(plan.repartition).toEqual({ 'z1:p1': 75, 'z1:p2': 25, z2: 0 });
    expect(plan.metriques.get('z1:p1')!.impressions).toBe(1_500_000);
  });

  it('chaque cellule, formatée fr-FR comme React (arrondis compris)', () => {
    const plan = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: null, budget: 10_000, cpm: 5, totaux: TOTAUX });
    expect(cellulesPlan(LIGNES, plan)).toEqual([
      {
        id: 'z1:p1', nom: 'CIRFA Rennes', pctZones: '75,0 %', pctFrance: '0,49 %', volume: `333${E}333`, volumeAbsent: false,
        impressions: `1${E}500${E}000`, repetition: '4,5×', surExposition: false, cout: '23 €', part: 75,
      },
      {
        id: 'z1:p2', nom: 'CIRFA Brest', pctZones: '25,0 %', pctFrance: '0,16 %', volume: `111${E}111`, volumeAbsent: false,
        impressions: `500${E}000`, repetition: '4,5×', surExposition: false, cout: '23 €', part: 25,
      },
      {
        id: 'z2', nom: 'Zone sans statistiques', pctZones: '—', pctFrance: '—', volume: 'n/d', volumeAbsent: true,
        impressions: '0', repetition: '—', surExposition: false, cout: '—', part: 0,
      },
    ]);
    expect(celluleTotal(plan, 10_000)).toEqual({
      pctZones: '100 %', pctFrance: '0,65 %', volume: `444${E}444`, impressions: `2${E}000${E}000`, repetition: '4,5×', cout: '23 €',
      repartition: '100 %',
    });
  });

  it('« % France » vient des totaux nationaux de la cible ; sans eux, un tiret', () => {
    const sans = calculerPlan({ lignes: LIGNES, cible: '18_24', repartition: null, budget: 10_000, cpm: 5, totaux: null });
    expect(cellulesPlan(LIGNES, sans)[0].pctFrance).toBe('—');
    const avec = calculerPlan({ lignes: LIGNES, cible: '18_24', repartition: null, budget: 10_000, cpm: 5, totaux: TOTAUX });
    // 30 000 / 5 000 000 = 0,6 % ; prorata de la cible 18-24 : 75 / 25.
    expect(cellulesPlan(LIGNES, avec)[0].pctFrance).toBe('0,60 %');
    expect(avec.repartition['z1:p1']).toBe(75);
  });

  it('sans budget ou sans CPM : ni impressions, ni répétition, ni coût ; une répétition > 10 signale la sur-exposition', () => {
    const vide = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: null, budget: NaN, cpm: 5, totaux: TOTAUX });
    expect(vide.impressionsTotales).toBeNull();
    expect(cellulesPlan(LIGNES, vide)[0]).toMatchObject({ impressions: '—', repetition: '—', cout: '—' });
    expect(celluleTotal(vide, NaN)).toMatchObject({ impressions: '—', repetition: '—', cout: '—' });

    const fort = calculerPlan({ lignes: LIGNES, cible: '18_24', repartition: null, budget: 10_000, cpm: 5, totaux: TOTAUX });
    // 1 500 000 impressions pour 30 000 personnes : 50 vues chacune.
    expect(cellulesPlan(LIGNES, fort)[0]).toMatchObject({ repetition: '50×', surExposition: true });
  });

  it('une répartition saisie remplace le prorata ; la somme du pied compte toutes les clés, comme React', () => {
    const plan = calculerPlan({
      lignes: LIGNES, cible: 'total', repartition: { 'z1:p1': 50, 'z1:p2': 50, z2: 0 }, budget: 10_000, cpm: 5, totaux: TOTAUX,
    });
    expect(plan.metriques.get('z1:p2')!.impressions).toBe(1_000_000);
    expect(celluleTotal(plan, 10_000).repartition).toBe('100 %');
  });

  it('montants saisis : virgule décimale admise, lecture de parseFloat', () => {
    expect(lireMontant('6,50')).toBe(6.5);
    expect(lireMontant('10000')).toBe(10_000);
    expect(lireMontant('')).toBeNaN();
    expect(formaterRepetition(null)).toBe('—');
  });
});

describe('plan média — lignes d’une zone', () => {
  it('les items d’une zone (CIRFA d’une bataille) donnent une ligne chacun, `zoneId:poiId` ; aucun item : null', () => {
    expect(lignesDesItems('z1', [{ poi_id: 'p1', poi_name: 'Rennes', values: { total: 3 } }])).toEqual([
      { id: 'z1:p1', name: 'Rennes', values: { total: 3 } },
    ]);
    expect(lignesDesItems('z1', [])).toBeNull();
    expect(lignesDesItems('z1', null)).toBeNull();
  });

  it('repli sur la zone entière : `audience_stats` aplati par clé de cible ; sans population, aucune valeur', () => {
    const audience = {
      population: { total: 100, by_age: { '0_17': 20, '18_24': 10 } },
      menages: { total: 40, proprietaires: 25, monoparentales: 5, pauvres: 6 },
      logements: { sociaux: 7 },
    };
    expect(ligneZoneEntiere({ id: 'z', name: 'Z' }, audience)).toEqual({
      id: 'z', name: 'Z',
      values: { total: 100, '0_17': 20, '18_24': 10, men: 40, men_prop: 25, men_fmp: 5, men_pauv: 6, log_soc: 7 },
    });
    expect(ligneZoneEntiere({ id: 'z', name: 'Z' }, {})).toEqual({ id: 'z', name: 'Z', values: null });
    expect(ligneZoneEntiere({ id: 'z', name: 'Z' }, null)).toEqual({ id: 'z', name: 'Z', values: null });
  });
});

describe('plan média — ce qui part vers la base et les DSP', () => {
  const zones = [{ id: 'z1', name: 'CIRFA BRETAGNE' }, { id: 'z2', name: 'Zone sans statistiques' }];

  it('corps du plan enregistré : montants nuls ou absents → null, poids arrondis au dixième', () => {
    const plan = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: { 'z1:p1': 66.66, 'z1:p2': 33.34, z2: 0 }, budget: 10_000, cpm: NaN, totaux: null });
    expect(corpsPlan({ campagne: 'c1', zones, lignes: LIGNES, plan, budget: 10_000, cpm: NaN, cible: 'total' })).toEqual({
      campaign_id: 'c1',
      plan: { zones, budget: 10_000, cpm: null, cible: 'total', weights: { 'z1:p1': 66.7, 'z1:p2': 33.3, z2: 0 } },
    });
  });

  it('poids d’export par item (sans le préfixe de zone) ; instantané limité aux zones décomposables', () => {
    const plan = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: null, budget: 10_000, cpm: 5, totaux: null });
    expect(poidsDesItems('z1', LIGNES, plan.repartition)).toEqual({ p1: 75, p2: 25 });
    expect(poidsDesItems('z2', LIGNES, plan.repartition)).toBeNull();
    expect(corpsInstantane({ campagne: 'c1', format: 'tiktok_geo', zones, lignes: LIGNES, plan, budget: 10_000, cpm: 5, cible: 'total' })).toEqual({
      campaign_id: 'c1', dsp: 'tiktok', budget: 10_000, cpm: 5, cible: 'total',
      zones: [{
        zone_id: 'z1', zone_name: 'CIRFA BRETAGNE',
        items: [{ item_id: 'z1:p1', item_name: 'CIRFA Rennes', weight: 75 }, { item_id: 'z1:p2', item_name: 'CIRFA Brest', weight: 25 }],
      }],
    });
  });

  it('CSV : métadonnées, en-tête, lignes et total de React, séparateur « ; », BOM ; nom de fichier par campagne', () => {
    const plan = calculerPlan({ lignes: LIGNES, cible: 'total', repartition: null, budget: 10_000, cpm: 5, totaux: TOTAUX });
    const csv = csvPlanMedia({ lignes: LIGNES, plan, cible: 'total', budget: 10_000, cpm: 5, nomCampagne: 'Été 2026' });
    expect(csv.split('\n')).toEqual([
      '﻿Plan média — Été 2026',
      'Cible;Population totale (hab.)',
      'Budget;10000;CPM;5',
      'Impressions totales;2000000',
      '',
      'Zone;% total;% France;Volume (hab.);Impressions;Répétition;Coût/1000 cible (€);Répartition %',
      `CIRFA Rennes;75,0;0,49;333${E}333;1${E}500${E}000;4,5;23;75,0`,
      `CIRFA Brest;25,0;0,16;111${E}111;500${E}000;4,5;23;25,0`,
      'Zone sans statistiques;;;;0;;;0,0',
      `Total;100;0,65;444${E}444;2${E}000${E}000;4,5;23;100`,
    ]);
    expect(nomFichierPlan('Été 2026')).toBe('plan_media_ete-2026.csv');
    expect(nomFichierPlan('')).toBe('plan_media.csv');
  });

  it('CSV : un nom de zone qui commence par « = » est neutralisé', () => {
    const lignes: LignePlan[] = [{ id: 'z', name: '=HYPERLINK("x")', values: { total: 1 } }];
    const plan = calculerPlan({ lignes, cible: 'total', repartition: null, budget: NaN, cpm: NaN, totaux: null });
    expect(csvPlanMedia({ lignes, plan, cible: 'total', budget: NaN, cpm: NaN, nomCampagne: '' }).split('\n')[6].split(';')[0])
      .toBe('"\'=HYPERLINK(""x"")"');
  });
});
