/**
 * La logique PURE des couches de la carte principale (types de risque, familles ICPE, carreaux,
 * échelle IRIS, météo, zones, constantes, palettes de données) copiée dans angular/ (P6) rend la
 * MÊME chose que React. Ce test empêche la copie de dériver pendant la cohabitation (gel P5 étendu
 * à /map au lot 4). Les couleurs d'INTERFACE ne sont pas copiées (jetons) : leur couverture est
 * vérifiée contre `jetons.css` plus bas.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `app/copilote/_lib/constants.ts` importe maplibre-gl (WebGL) : inutile pour les constantes lues ici.
vi.mock('maplibre-gl', () => ({ default: {} }));

import * as Rr from '@/lib/carte/palette-risques';
import * as Ar from '../../../angular/src/app/features/carte/logique/types-risque';
import * as Rfam from '@/lib/import/georisques/familles';
import * as Afam from '../../../angular/src/app/features/carte/logique/familles-icpe';
import * as Rpp from '@/lib/carte/palette-pprt';
import * as App from '../../../angular/src/app/features/carte/logique/pprt';
import * as Rnorm from '@/lib/carreaux/normalisation';
import * as Anorm from '../../../angular/src/app/features/carte/logique/carreaux/normalisation';
import * as Rbor from '@/lib/carreaux/bornes';
import * as Abor from '../../../angular/src/app/features/carte/logique/carreaux/bornes';
import * as Rexp from '@/lib/carreaux/expressions';
import * as Aexp from '../../../angular/src/app/features/carte/logique/carreaux/expressions';
import * as Rcat from '@/lib/carreaux/catalogue';
import * as Acat from '../../../angular/src/app/features/carte/logique/carreaux/catalogue';
import * as Ri from '@/lib/iris/echelle';
import * as Ai from '../../../angular/src/app/features/carte/logique/iris-echelle';
import * as Rmt from '@/lib/meteo/types';
import * as Amt from '../../../angular/src/app/features/carte/logique/meteo/types';
import * as Rmp from '@/lib/meteo/palettes';
import * as Amp from '../../../angular/src/app/features/carte/logique/meteo/palettes';
import * as Rmr from '@/lib/meteo/requete';
import * as Amr from '../../../angular/src/app/features/carte/logique/meteo/requete';
import * as Rma from '@/lib/meteo/aggregation';
import * as Ama from '../../../angular/src/app/features/carte/logique/meteo/aggregation';
import * as Rv from '@/lib/version';
import * as Av from '../../../angular/src/app/features/carte/logique/versions';
import * as Rcp from '@/lib/custom-geo/parse-cp';
import * as Acp from '../../../angular/src/app/features/carte/logique/zones/parse-cp';
import * as Rco from '@/lib/custom-geo/composition';
import * as Aco from '../../../angular/src/app/features/carte/logique/zones/composition';
import * as Rci from '@/lib/custom-geo/cibles';
import * as Aci from '../../../angular/src/app/features/carte/logique/zones/cibles';
import * as Rst from '@/lib/custom-geo/source-type-labels';
import * as Ast from '../../../angular/src/app/features/carte/logique/zones/source-type-labels';
import * as Rk from '@/app/copilote/_lib/constants';
import * as Af from '../../../angular/src/app/features/carte/logique/fonds';
import * as Apal from '../../../angular/src/app/features/carte/logique/palettes-donnees-carte';
import * as Rfc from '@/app/map/_components/filter-panel/constants';
import * as Rfa from '@/lib/geo/france-admin';
import * as Acc from '../../../angular/src/app/features/carte/logique/constantes-calques';
import * as Ami from '../../../angular/src/app/features/carte/logique/modes-isochrones';
import { PALETTES_DONNEES } from '../../../angular/src/app/features/risques/logique/palettes-donnees';

/** Les exports de DONNÉES (non fonctions) portés par les deux modules sous le même nom sont égaux. */
function donneesEgales(react: Record<string, unknown>, angular: Record<string, unknown>, noms: string[]) {
  for (const n of noms) {
    expect(angular[n], n).toEqual(react[n]);
  }
}

/** Un export qui existe dans React ET dans la copie, sous le même nom, doit rendre la même chose. */
function memeFonction<A extends unknown[]>(r: (...a: A) => unknown, a: (...x: A) => unknown, cas: A[]) {
  for (const c of cas) expect(a(...c), JSON.stringify(c)).toEqual(r(...c));
}

const FAMILLES = Rfam.FAMILLES_ICPE_SEED;

describe('types de risque ICPE', () => {
  it('constantes identiques', () => {
    donneesEgales(Rr, Ar, ['TYPE_PAR_PREFIXE', 'LIBELLE_TYPE', 'ORDRE_TYPES']);
  });

  it('JETON_TYPE : un nom de jeton par type, sans var() ni hexadécimal, tous présents dans jetons.css', () => {
    expect(Ar.JETON_TYPE).toEqual({
      toxique: 'risque-toxique',
      inflammable: 'risque-inflammable',
      pollution: 'risque-pollution',
      autres: 'risque-autres',
      non_precise: 'donnee-absente',
    });
    expect(Object.keys(Ar.JETON_TYPE).sort()).toEqual([...Rr.ORDRE_TYPES].sort());
    const css = readFileSync('angular/src/styles/jetons.css', 'utf8');
    for (const jeton of Object.values(Ar.JETON_TYPE)) {
      expect(jeton).not.toMatch(/var\(|#|^--/);
      expect(css).toContain(`--${jeton}:`);
    }
  });

  it('librellesDuType (nom React à faute de frappe gardé) : les cinq types contre le seed', () => {
    for (const t of Rr.ORDRE_TYPES) {
      expect(Ar.librellesDuType(t, FAMILLES), t).toEqual(Rr.librellesDuType(t, FAMILLES));
    }
    expect(Ar.librellesDuType('toxique', FAMILLES)).toEqual(['Toxicité aiguë']);
  });

  it('typeRisqueDepuisPrefixes', () => {
    memeFonction(Rr.typeRisqueDepuisPrefixes, Ar.typeRisqueDepuisPrefixes,
      [[null], [undefined], [[]], [['41']], [['47', '27']], [['99']], [['27', '41']], [['11', '15']]]);
  });

  it('typeRisqueDepuisLibelle : les 15 libellés du seed, un inconnu, vide, null, espaces', () => {
    const libelles = [...FAMILLES.map((f) => f.libelle), 'Inconnu', '', null, undefined, '  Déchets  '];
    for (const l of libelles) {
      expect(Ar.typeRisqueDepuisLibelle(l, FAMILLES), String(l)).toEqual(Rr.typeRisqueDepuisLibelle(l, FAMILLES));
    }
    expect(FAMILLES).toHaveLength(15);
  });
});

describe('familles ICPE', () => {
  it('seed et nature non précisée identiques', () => {
    donneesEgales(Rfam, Afam, ['FAMILLES_ICPE_SEED', 'NATURE_NON_PRECISEE']);
  });
});

describe('périmètre PPRT (logique seule)', () => {
  it('constantes identiques', () => {
    donneesEgales(Rpp, App, ['JETONS_PPRT', 'LARGEUR_TRAIT_PPRT', 'LIBELLE_TYPE_ZONE_PPRT']);
  });
  it('JETON_PPRT : les noms correspondent aux jetons déclarés', () => {
    expect(App.JETONS_PPRT.map((j) => j.slice(2))).toEqual([App.JETON_PPRT.contour, App.JETON_PPRT.fond]);
    const css = readFileSync('angular/src/styles/jetons.css', 'utf8');
    for (const j of Object.values(App.JETON_PPRT)) expect(css).toContain(`--${j}:`);
  });
});

describe('versions de tuiles et planchers', () => {
  it('identiques à lib/version.ts', () => {
    donneesEgales(Rv, Av, ['CARREAUX_TILE_VERSION', 'IRIS_TILE_VERSION', 'IRIS_ZOOM_PLANCHER', 'PPRT_ZOOM_PLANCHER']);
    expect(Av.IRIS_ZOOM_PLANCHER).toBe(4);
    expect(Av.PPRT_ZOOM_PLANCHER).toBe(8);
  });
});

/** Les cinq paliers de la cascade de carreaux, par leur superficie en km² : 20 km · 5 km · 2 km · 1 km · 200 m. */
const SUPERFICIES = [400, 25, 4, 1, 0.04];
const INDICATEURS = ['population_totale', 'revenu_median', 'surface_moyenne', 'menages_proprietaires', 'logements_inconnus', 'constructor', 'inconnu'];

describe('carreaux : normalisation et bornes', () => {
  it('normalisation : classe, dénominateur, unité, valeur normalisée par palier', () => {
    for (const id of INDICATEURS) {
      expect(Anorm.classeDe(id), id).toEqual(Rnorm.classeDe(id));
      expect(Anorm.denominateurDe(id), id).toEqual(Rnorm.denominateurDe(id));
      expect(Anorm.uniteNormalisee(id, '€'), id).toEqual(Rnorm.uniteNormalisee(id, '€'));
    }
    for (const s of SUPERFICIES) {
      for (const v of [0, 1, 12345, NaN, Infinity]) {
        expect(Anorm.normaliser(v, s), `${v}/${s}`).toEqual(Rnorm.normaliser(v, s));
      }
    }
    memeFonction(Rnorm.normaliser, Anorm.normaliser, [[5, 0], [5, -1], [5, NaN]]);
  });

  it('bornes : table nationale, repli, plancher, versValeurReelle, paliers, formatage', () => {
    donneesEgales(Rbor, Abor, ['BORNES_NATIONALES', 'PLANCHER_LOG']);
    expect(Object.keys(Abor.BORNES_NATIONALES)).toHaveLength(28);
    for (const id of INDICATEURS) expect(Abor.bornesDe(id), id).toEqual(Rbor.bornesDe(id));
    for (const b of [-1.5, 0, 0.3464, 4.467]) expect(Abor.versValeurReelle(b)).toEqual(Rbor.versValeurReelle(b));
    const bornes = Rbor.bornesDe('population_totale');
    for (let i = 0; i < 6; i++) expect(Abor.palierEchelle(bornes, i, 6)).toEqual(Rbor.palierEchelle(bornes, i, 6));
    for (const v of [NaN, Infinity, 0, 0.0234, 0.5, 1, 9.99, 10, 99.9, 100, 999.4, 1000, 9999, 10000, 123456, 1_000_000, 2_500_000, -42]) {
      expect(Abor.formaterValeur(v), String(v)).toEqual(Rbor.formaterValeur(v));
    }
  });

  it('catalogue des indicateurs : copie identique (T6), et chaque id a des bornes', () => {
    expect(Acat.CARREAUX_INDICATEURS).toEqual(Rcat.CARREAUX_INDICATEURS);
    for (const ind of Rcat.CARREAUX_INDICATEURS) {
      expect(Abor.BORNES_NATIONALES[ind.id], ind.id).toBeDefined();
    }
  });

  it('expressions MapLibre : toEqual sur les expressions produites', () => {
    // COULEUR_DONNEE_ABSENTE n'est pas recopiée (T6) : le jeton --donnee-absente porte la même valeur, deux thèmes.
    expect('COULEUR_DONNEE_ABSENTE' in Aexp).toBe(false);
    const jetons = readFileSync('angular/src/styles/jetons.css', 'utf8');
    const valeurs = [...jetons.matchAll(/--donnee-absente:\s*([^;]+);/g)].map((m) => m[1].trim().toLowerCase());
    expect(valeurs).toEqual([Rexp.COULEUR_DONNEE_ABSENTE, Rexp.COULEUR_DONNEE_ABSENTE]);
    for (const id of ['population_totale', 'revenu_median', 'logements_inconnus']) {
      const b = Rbor.bornesDe(id);
      expect(Aexp.bornesInternes(b, 6), id).toEqual(Rexp.bornesInternes(b, 6));
      expect(Aexp.bornesInternes(b, 5), id).toEqual(Rexp.bornesInternes(b, 5));
      const denom = Rnorm.denominateurDe(id);
      expect(Aexp.donneeExploitableExpr(id, denom)).toEqual(Rexp.donneeExploitableExpr(id, denom));
      const echelle = ['log10', ['max', ['/', ['get', id], ['get', denom]], Rbor.PLANCHER_LOG]];
      for (const expo of [0.5, 1, 3]) {
        expect(Aexp.hauteurExtrusionExpr(id, denom, b, expo, echelle)).toEqual(Rexp.hauteurExtrusionExpr(id, denom, b, expo, echelle));
      }
    }
    expect(Aexp.largeurMailleExpr()).toEqual(Rexp.largeurMailleExpr());
  });

  it('palettes de carreaux : les six échelles du lot 3 égales aux littéraux React', () => {
    expect(Apal.CARREAUX_PALETTES).toBe(PALETTES_DONNEES);
    expect(Apal.CARREAUX_PALETTES).toEqual(Rcat.CARREAUX_PALETTES);
  });
});

describe('échelle IRIS', () => {
  const BORNES: Ri.BornesIris[] = [
    { colonne: 'population', classe: 'effectif', log_min: -0.5, log_max: 3.9, val_min: 0.3, val_max: 8000 },
    { colonne: 'densite_pop', classe: 'densite', log_min: 0, log_max: 4.78, val_min: 1, val_max: 60555 },
    { colonne: 'part_proprietaires', classe: 'proportion', log_min: -1, log_max: 1.9, val_min: 0.1, val_max: 80 },
  ];
  it('constantes et fonctions sur les trois classes', () => {
    donneesEgales(Ri, Ai, ['LIBELLE_NIVEAU']);
    for (const b of BORNES) {
      expect(Ai.echelleDe(b)).toEqual(Ri.echelleDe(b));
      expect(Ai.valeurNormaliseeExpr(b.colonne, b.classe)).toEqual(Ri.valeurNormaliseeExpr(b.colonne, b.classe));
      expect(Ai.echelleLogExpr(b)).toEqual(Ri.echelleLogExpr(b));
      expect(Ai.donneeIrisExploitableExpr(b.colonne, b.classe)).toEqual(Ri.donneeIrisExploitableExpr(b.colonne, b.classe));
      expect(Ai.uniteIris(b.classe)).toEqual(Ri.uniteIris(b.classe));
    }
    for (const z of [0, 3.9, 4, 6, 6.5, 6.99, 7, 8.4, 8.99, 9, 12, 18]) {
      expect(Ai.niveauAuZoom(z), String(z)).toEqual(Ri.niveauAuZoom(z));
    }
  });
});

describe('météo', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-17T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const VARS: Rmt.MeteoVariable[] = ['precipitation', 'temperature_2m', 'windspeed_10m', 'sunshine_duration'];

  it('types : unités, agrégations, champs, libellés', () => {
    donneesEgales(Rmt, Amt, ['METEO_UNIT', 'METEO_AGGREGATION', 'METEO_DAILY_FIELD', 'METEO_LABEL']);
  });

  it('palettes et expression de couleur', () => {
    donneesEgales(Rmp, Amp, ['METEO_PALETTES']);
    for (const v of VARS) {
      const stats = Rma.computeStats([1, 5, 9, 12, 30], v);
      expect(Amp.buildColorExpression(v, stats), v).toEqual(Rmp.buildColorExpression(v, stats));
      expect(Amp.buildColorExpression(v, stats, 'x'), v).toEqual(Rmp.buildColorExpression(v, stats, 'x'));
      const plat = { ...stats, min: 3, max: 3 };
      expect(Amp.buildColorExpression(v, plat)).toEqual(Rmp.buildColorExpression(v, plat));
    }
  });

  it('agrégation, statistiques et libellés qualitatifs', () => {
    for (const v of VARS) {
      for (const serie of [[], [1, 2, 3], [null, undefined, NaN, 4, 6]] as (number | null | undefined)[][]) {
        expect(Ama.aggregatePeriod(serie, v)).toEqual(Rma.aggregatePeriod(serie, v));
      }
      for (const vals of [[], [7], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
        const sr = Rma.computeStats(vals, v);
        expect(Ama.computeStats(vals, v)).toEqual(sr);
        for (const x of [-5, 1, 3, 5, 7, 20]) expect(Ama.qualitativeLabel(x, sr, v)).toEqual(Rma.qualitativeLabel(x, sr, v));
      }
    }
  });

  it('requête : constantes, période bornée, hôte, URL', () => {
    donneesEgales(Rmr, Amr, ['MAX_HISTORY_DAYS', 'MAX_FORECAST_DAYS', 'MAX_POINTS_PER_BATCH', 'ARCHIVE_CUTOFF']);
    expect(Amr.todayStr()).toBe('2026-09-17');
    expect(Amr.todayStr()).toEqual(Rmr.todayStr());
    const today = Rmr.todayStr();
    const periodes: [string, string][] = [
      ['2026-09-01', '2026-09-10'], ['2026-09-10', '2026-09-01'], ['2026-06-01', '2026-09-10'],
      ['2026-09-10', '2026-09-30'], ['2026-09-10', '2026-10-05'], ['2020-01-01', '2026-09-18'],
      ['2021-06-01', '2021-06-30'], ['2023-01-01', '2023-01-31'],
    ];
    for (const [d, f] of periodes) {
      expect(Amr.validerPeriode(d, f, today), `${d}→${f}`).toEqual(Rmr.validerPeriode(d, f, today));
      expect(Amr.pickHost(d, f, today), `${d}→${f}`).toEqual(Rmr.pickHost(d, f, today));
      expect(Amr.daysBetween(d, f)).toEqual(Rmr.daysBetween(d, f));
    }
    const pts = [{ lat: 43.29651, lon: 5.37} , { lat: 48.8566, lon: 2.3522 }];
    for (const v of VARS) {
      for (const h of ['api.open-meteo.com', 'archive-api.open-meteo.com']) {
        expect(Amr.buildOpenMeteoUrl(h, pts, v, '2026-09-01', '2026-09-10')).toEqual(Rmr.buildOpenMeteoUrl(h, pts, v, '2026-09-01', '2026-09-10'));
      }
    }
  });

  it('bbox arrondie au demi-degré VERS L’EXTÉRIEUR, point dans bbox, clé de cache, échantillonnage', () => {
    for (const s of ['5.3,43.1,5.9,43.6', '-5.4,41.3,9.7,51.1', '2.0,48.0,3.0,49.0']) {
      expect(Amr.parseBbox(s)).toEqual(Rmr.parseBbox(s));
      const b = Rmr.parseBbox(s);
      const arr = Amr.arrondirBboxExterieur(b);
      expect(arr).toEqual(Rmr.arrondirBboxExterieur(b));
      // vers l'extérieur : la bbox arrondie contient toujours la bbox demandée
      expect(arr[0]).toBeLessThanOrEqual(b[0]); expect(arr[1]).toBeLessThanOrEqual(b[1]);
      expect(arr[2]).toBeGreaterThanOrEqual(b[2]); expect(arr[3]).toBeGreaterThanOrEqual(b[3]);
      expect(Amr.cleCache('cp', 'precipitation', '2026-09-01', '2026-09-10', arr)).toEqual(Rmr.cleCache('cp', 'precipitation', '2026-09-01', '2026-09-10', arr));
      for (const z of [{ lat: 43.3, lon: 5.4 }, { lat: 0, lon: 0 }]) expect(Amr.dansBbox(z, arr)).toEqual(Rmr.dansBbox(z, arr));
    }
    expect(Amr.arrondirBboxExterieur([5.3, 43.1, 5.9, 43.6])).toEqual([5, 43, 6, 44]);
    expect(Amr.arrondirBboxExterieur([5.3, 43.1, 5.9, 43.6], 0.25)).toEqual(Rmr.arrondirBboxExterieur([5.3, 43.1, 5.9, 43.6], 0.25));
    expect(Amr.cleCache('cp', 'precipitation', 'a', 'b')).toEqual(Rmr.cleCache('cp', 'precipitation', 'a', 'b'));

    const zones = Array.from({ length: 40 }, (_, i) => ({ code: String(i), nom: `z${i}`, lat: 43 + (i % 8) * 0.07, lon: 5 + Math.floor(i / 8) * 0.09 }));
    for (const max of [10, 100]) expect(Amr.sampleZonePoints(zones, max)).toEqual(Rmr.sampleZonePoints(zones, max));
  });
});

describe('zones personnalisées', () => {
  it('parse-cp : saisie mêlée de séparateurs, doublons, jetons invalides et caractères invisibles', () => {
    const saisies = [
      '13001, 13002\n2A004;75056 abc 1300',
      '', '   ', '﻿75001;"75002" 75003 75004', '123456 12345 12345', '01000\t20000',
      Array.from({ length: 80 }, (_, i) => `x${i}`).join(' ') + ' 13001',
    ];
    for (const s of saisies) expect(Acp.parserCodesPostaux(s), JSON.stringify(s)).toEqual(Rcp.parserCodesPostaux(s));
    expect(Acp.parserCodesPostaux('13001, 13002\n2A004;75056 abc 1300')).toEqual({
      codes: ['13001', '13002', '75056'], rejetes: ['2A004', 'abc', '1300'], nRejetes: 3,
    });
    expect(Acp.parserCodesPostaux(42 as unknown as string)).toEqual(Rcp.parserCodesPostaux(42 as unknown as string));
  });

  it('composition : deux zones, trois zones, soustraction, seuil, bataille, repli', () => {
    const cas: [string, Record<string, unknown> | null | undefined][] = [
      ['composite', { kind: 'intersection', member_zone_names: ['Zone A', 'Zone B'] }],
      ['composite', { kind: 'intersection', member_zone_names: ['Zone A', 'Zone B', 'Zone C'] }],
      ['composite', { kind: 'difference', member_zone_names: ['A', 'B', 'C'] }],
      ['composite', { base_label: 'France', retires_labels: ['Paris', 'Lyon'] }],
      ['composite', { member_labels: ['A', 'B', 'C'] }],
      ['composite', { member_zone_ids: ['1', '2'] }],
      ['indicator_threshold', { indicator: 'Revenu médian', operator: '>=', threshold: 25000, unit: '€' }],
      ['score_composite', { indicateurs: ['a', 'b'], seuil: 60 }],
      ['isochrone_battle', { poi_count: 12, category: 'CIRFA', paliers: [10, 20, 30] }],
      ['iris', { feature_count: 1234 }],
      ['carreaux_filosofi', { feature_count: 1 }],
      ['codes_postaux', { n_codes_postaux: 2 }],
      ['rayon', { rayon_m: 2500 }],
      ['rayon', { rayon_m: 400 }],
      ['dessin', null], ['inconnu_total', undefined], ['composite', [] as unknown as Record<string, unknown>],
    ];
    for (const [t, m] of cas) expect(Aco.decrireComposition(t, m), `${t} ${JSON.stringify(m)}`).toEqual(Rco.decrireComposition(t, m));
  });

  it('cibles et libellés de source', () => {
    donneesEgales(Rci, Aci, ['CIBLE_GROUPS', 'CIBLE_KEYS', 'CIBLE_UNIT', 'CIBLE_LABEL']);
    for (const t of ['composite', 'isochrone_battle', 'admin_filter', 'voronoi_cells', 'tmja_routes', 'inconnu']) {
      expect(Ast.getSourceTypeLabel(t)).toEqual(Rst.getSourceTypeLabel(t));
    }
  });
});

describe('fonds de carte, palettes de données et constantes de calques', () => {
  it('fonds : quatre fonds, défaut = Standard', () => {
    donneesEgales(Rk, Af, ['MAP_STYLES', 'MAP_STYLE']);
    expect(Af.MAP_STYLES).toHaveLength(4);
  });

  it('palettes de données : toEqual aux littéraux React', () => {
    donneesEgales(Rk, Apal, ['CATEGORY_COLORS', 'ISOCHRONE_COLORS', 'ISOCHRONE_MODE_LABELS', 'VORONOI_PALETTE', 'BATTLE_PALIER_OPACITY']);
    for (const c of ['lycee', 'COLLEGE', 'cirfa', 'inconnu', '', undefined as unknown as string]) {
      expect(Apal.getCatColor(c), String(c)).toEqual(Rk.getCatColor(c));
    }
    expect(Apal.VORONOI_PALETTE).toHaveLength(20);
  });

  it('TMJA : paliers, largeurs et opacités égaux aux littéraux de paint de useMapInit', () => {
    expect(Apal.PALIERS_TMJA.map((p) => p.couleur)).toEqual(['#4292C6', '#f6d543', '#f97316', '#ef4444']);
    expect(Apal.PALIERS_TMJA.map((p) => p.seuil)).toEqual([null, 5000, 15000, 40000]);
    expect(Apal.LARGEUR_TMJA_PAR_ZOOM).toEqual([[5, 0.6], [7, 1.2], [9, 2], [11, 3.2], [14, 5]]);
    expect(Apal.OPACITE_TMJA_PAR_ZOOM).toEqual([[5, 0.95], [9, 0.9], [12, 0.8]]);
    expect(Apal.SOURCE_TMJA).toEqual({ minzoom: 5, maxzoom: 14, version: 'v10' });
    // lecture directe du source React : chaque littéral nommé s'y trouve
    const src = readFileSync('app/copilote/_hooks/useMapInit.ts', 'utf8');
    for (const lit of ["'#4292C6'", "'#f6d543'", "'#f97316'", "'#ef4444'", '5, 0.6, 7, 1.2, 9, 2, 11, 3.2, 14, 5', '5, 0.95, 9, 0.9, 12, 0.8', '?v=v10']) {
      expect(src, lit).toContain(lit);
    }
  });

  it('radio : teintes égales aux littéraux de paint de useMapInit', () => {
    const src = readFileSync('app/copilote/_hooks/useMapInit.ts', 'utf8');
    for (const [p, c] of Object.entries(Apal.TEINTES_RADIO.portee)) expect(src, p).toContain(`'${p}', '${c}'`);
    expect(src).toContain(`'${Apal.TEINTES_RADIO.porteeInconnue}', // default`);
    expect(Apal.TEINTES_RADIO.rayonGrappes).toEqual({ defaut: 14, paliers: [[10, 18], [50, 24], [200, 32]] });
    expect(src).toContain("['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32]");
    expect(src).toContain('1, 3,\n            100, 5,\n            10000, 7,\n            100000, 10,');
    expect(Apal.TEINTES_RADIO.cernePoint).toEqual({ 'DAB+': 1.5, defaut: 0.5 });
    expect(Apal.TEINTES_RADIO.groupement).toEqual({ clusterMaxZoom: 14, clusterRadius: 50 });
  });

  it('civique : échelle d’abstention et qualificatifs', () => {
    const src = readFileSync('app/map/_components/CivicIndicatorsLayer.tsx', 'utf8');
    const meta = Apal.VARIABLES_CIVIQUES.abstention_pres_2022;
    for (const [v, c] of meta.stops) expect(src, `${v}`).toMatch(new RegExp(`\\[${v},\\s+'${c}'\\]`));
    expect(meta.stops.map(([v]) => v)).toEqual([10, 20, 25, 30, 40, 60]);
    expect([5, 17.9, 18, 24.9, 25, 29.9, 30, 39.9, 40, 55].map(meta.qualifier)).toEqual([
      'Très forte participation', 'Très forte participation', 'Forte participation', 'Forte participation',
      'Participation moyenne', 'Participation moyenne', 'Abstention élevée', 'Abstention élevée',
      'Abstention très élevée', 'Abstention très élevée',
    ]);
  });

  it('santé environnementale : chaque niveau pointe un jeton existant', () => {
    const css = readFileSync('angular/src/styles/jetons.css', 'utf8');
    for (const jeux of Object.values(Apal.JETONS_NIVEAUX_SANTE)) {
      expect(Object.keys(jeux)).toHaveLength(7);
      for (const j of Object.values(jeux)) expect(css, j).toContain(`--${j}:`);
    }
  });

  it('constantes de calques : OOH, transport, épingles, POI, rayons, modes d’isochrones', () => {
    donneesEgales(Rfc, Acc, ['OOH_REGIES', 'TRANSPORT_TYPES', 'PIN_SIZES', 'PIN_COLORS']);
    donneesEgales(Rfa, Acc, ['POI_TYPES', 'POI_RAYONS']);
    donneesEgales(Rfa, Ami, ['ISO_MODES', 'ISO_DURATIONS']);
    expect(Acc.OOH_REGIES).toHaveLength(8);
    expect(Ami.ISO_MODES.map((m) => m.id)).toEqual(['walk', 'bike', 'drive']);
  });
});
