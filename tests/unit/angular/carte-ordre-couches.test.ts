/**
 * L'ordre d'empilement des couches de la carte principale Angular (`logique/ordre-couches.ts`) est EXACTEMENT celui
 * dans lequel React les pose au `load` (`app/map/_hooks/useMapInit.ts`, ordre des `addLayer`, aucun `beforeId`),
 * suivi des couches que React pose APRÈS le `load` (`COUCHES_APRES_LOAD`), toujours au-dessus.
 * Ruling du lot 4, T8 : côté Angular les couches sont posées à la demande, donc l'ordre doit être écrit — et ce test
 * empêche qu'il dérive de celui de React (gel P5 étendu à /map). Revue finale I-1 : la liste des couches d'après le
 * `load` ne portait que le score ; ICPE, PPRT, civique, santé, zones et dessin passaient sous un IRIS allumé après eux.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUCHES_APRES_LOAD, ORDRE_COUCHES, avantDe, rangCouche,
} from '../../../angular/src/app/features/carte/logique/ordre-couches';

/**
 * Chaque couche d'après le `load` → le fichier React qui la pose et l'identifiant qu'il y porte. Deux écarts de NOM,
 * pas de rang : les zones de risque (Angular réemploie les couches `atelier-zones-*` du module, React écrit
 * `zones-risque-*`) et le tracé libre (React : couches internes de terra-draw, sans identifiant à lui ; Angular : tracé
 * maison, arbitrage B8).
 */
const SOURCES_REACT: Record<string, { fichier: string; idReact: string } | { ecart: string }> = {
  'civic-cps-fill': { fichier: 'app/map/_components/CivicIndicatorsLayer.tsx', idReact: 'civic-cps-fill' },
  'civic-cps-line': { fichier: 'app/map/_components/CivicIndicatorsLayer.tsx', idReact: 'civic-cps-line' },
  'risques-zone': { fichier: 'app/map/_components/RisqueIndustrielLayer.tsx', idReact: 'risques-zone' },
  'risques-zone-contour': { fichier: 'app/map/_components/RisqueIndustrielLayer.tsx', idReact: 'risques-zone-contour' },
  'risques-halo': { fichier: 'app/map/_components/RisqueIndustrielLayer.tsx', idReact: 'risques-halo' },
  'risques-point': { fichier: 'app/map/_components/RisqueIndustrielLayer.tsx', idReact: 'risques-point' },
  'pprt-fond': { fichier: 'app/map/_components/PprtLayer.tsx', idReact: 'pprt-fond' },
  'pprt-contour': { fichier: 'app/map/_components/PprtLayer.tsx', idReact: 'pprt-contour' },
  'civic-health-zones-fill': { fichier: 'app/map/_components/CivicHealthMapLayer.tsx', idReact: 'civic-health-zones-fill' },
  'civic-health-zones-line': { fichier: 'app/map/_components/CivicHealthMapLayer.tsx', idReact: 'civic-health-zones-line' },
  'score-composite-cp-fill': { fichier: 'app/map/_components/ScoreMapLayer.tsx', idReact: 'score-composite-cp-fill' },
  'score-composite-cp-line': { fichier: 'app/map/_components/ScoreMapLayer.tsx', idReact: 'score-composite-cp-line' },
  'atelier-zones-fond': { fichier: 'app/map/_components/ZonesRisqueLayer.tsx', idReact: 'zones-risque-fond' },
  'atelier-zones-contour': { fichier: 'app/map/_components/ZonesRisqueLayer.tsx', idReact: 'zones-risque-contour' },
  'atelier-zones-pprt': { fichier: 'app/map/_components/ZonesRisqueLayer.tsx', idReact: 'zones-risque-contour-pprt' },
  'atelier-zones-etiquettes': { ecart: 'non posée sur la carte principale (etiquettes: false), rangée pour le cas où' },
  'custom-zone-*': { fichier: 'components/map/overlays/ZonesOverlay.tsx', idReact: 'custom-zone-fill-' },
  'apercu-rayon-fill': { fichier: 'app/map/_components/panneaux/CreerZoneRayon.tsx', idReact: 'apercu-rayon-fill' },
  'apercu-rayon-line': { fichier: 'app/map/_components/panneaux/CreerZoneRayon.tsx', idReact: 'apercu-rayon-line' },
  'dessin-trace-fill': { ecart: 'terra-draw chez React (DessinLibre.tsx)' },
  'dessin-trace-line': { ecart: 'terra-draw chez React (DessinLibre.tsx)' },
  'dessin-trace-point': { ecart: 'terra-draw chez React (DessinLibre.tsx)' },
};

/** Les fichiers Angular qui posent ces couches : chacun doit passer par `avantDe`. */
const POSEURS_ANGULAR = [
  'angular/src/app/features/carte/couches/couche-risques.ts',
  'angular/src/app/features/carte/couches/indicateurs-civiques.service.ts',
  'angular/src/app/features/carte/couches/sante.service.ts',
  'angular/src/app/features/carte/couches/couche-score.ts',
  'angular/src/app/features/carte/couches/zones-risque.service.ts',
  'angular/src/app/features/carte/couches/couche-zones-custom.ts',
  'angular/src/app/features/carte/couches/apercu-rayon.ts',
  'angular/src/app/features/carte/couches/dessin.service.ts',
];

/** Une carte minimale qui rejoue les `beforeId` comme MapLibre et rend son style (couches dans l'ordre rendu). */
function carteSimulee() {
  const couches: string[] = [];
  return {
    couches,
    getLayer: (id: string) => (couches.includes(id) ? {} : undefined),
    getStyle: () => ({ layers: couches.map((id) => ({ id })) }),
    poser(id: string) {
      const avant = avantDe(this, id);
      const i = avant ? couches.indexOf(avant) : -1;
      if (avant && i < 0) throw new Error(`avant inexistant : ${avant}`);
      if (i >= 0) couches.splice(i, 0, id);
      else couches.push(id);
    },
  };
}

describe('ORDRE_COUCHES (lot 4, T8 ; revue finale I-1)', () => {
  it('reprend, dans le même ordre, toutes les couches que useMapInit.ts ajoute', () => {
    const source = readFileSync('app/map/_hooks/useMapInit.ts', 'utf8');
    const ids: string[] = [];
    for (const m of source.matchAll(/addLayer\(\{\s*id:\s*'([^']+)'/g)) ids.push(m[1]);
    expect(ids.length).toBeGreaterThan(20);
    expect(ORDRE_COUCHES).toEqual([...ids, ...COUCHES_APRES_LOAD]);
  });

  it('chaque couche d’après le load a sa source React (ou un écart de nom écrit), et nulle n’est dans useMapInit.ts', () => {
    const init = readFileSync('app/map/_hooks/useMapInit.ts', 'utf8');
    expect(Object.keys(SOURCES_REACT)).toEqual([...COUCHES_APRES_LOAD]);
    for (const id of COUCHES_APRES_LOAD) {
      const s = SOURCES_REACT[id];
      if ('ecart' in s) continue;
      expect(init).not.toContain(s.idReact);
      expect(readFileSync(s.fichier, 'utf8')).toContain(s.idReact);
    }
  });

  it('l’ordre des couches d’après le load suit le montage de app/map/page.tsx', () => {
    const page = readFileSync('app/map/page.tsx', 'utf8');
    const montage = ['<CivicIndicatorsLayer', '<RisqueIndustrielLayer', '<PprtLayer', '<CivicHealthMapLayer', '<ScoreMapLayer', '<ZonesRisqueLayer'];
    const positions = montage.map((m) => page.indexOf(m));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const rangs = ['civic-cps-fill', 'risques-zone', 'pprt-fond', 'civic-health-zones-fill', 'score-composite-cp-fill', 'atelier-zones-fond']
      .map(rangCouche);
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs);
  });

  it('chaque poseur Angular d’une couche d’après le load passe par avantDe', () => {
    for (const f of POSEURS_ANGULAR) expect(readFileSync(f, 'utf8'), f).toContain('avantDe(carte');
  });

  it('avantDe : la première couche PLUS HAUTE déjà posée ; rien au-dessus ou hors liste → sommet', () => {
    const posees = new Set(['iris-fill', 'carreaux-mvt-fill']);
    const carte = { getLayer: (id: string) => (posees.has(id) ? {} : undefined) };
    expect(avantDe(carte, 'pois-heatmap')).toBe('iris-fill');
    expect(avantDe(carte, 'iris-border')).toBe('carreaux-mvt-fill');
    expect(avantDe(carte, 'carreaux-mvt-line')).toBeUndefined();
    expect(avantDe(carte, 'couche-inconnue')).toBeUndefined();
  });

  it('ICPE puis IRIS : les points ICPE restent au-dessus de l’IRIS', () => {
    const c = carteSimulee();
    for (const id of ['risques-zone', 'risques-zone-contour', 'risques-halo', 'risques-point']) c.poser(id);
    for (const id of ['iris-fill', 'iris-border']) c.poser(id);
    expect(c.couches).toEqual(['iris-fill', 'iris-border', 'risques-zone', 'risques-zone-contour', 'risques-halo', 'risques-point']);
  });

  it('dessin, zone enregistrée, puis carreaux et POI : les couches de données passent dessous', () => {
    const c = carteSimulee();
    for (const id of ['dessin-trace-fill', 'dessin-trace-line', 'custom-zone-fill-z1', 'custom-zone-line-z1']) c.poser(id);
    for (const id of ['carreaux-mvt-fill', 'pois-circles', 'civic-cps-fill']) c.poser(id);
    expect(c.couches).toEqual([
      'pois-circles', 'carreaux-mvt-fill', 'civic-cps-fill',
      'custom-zone-fill-z1', 'custom-zone-line-z1', 'dessin-trace-fill', 'dessin-trace-line',
    ]);
  });

  it('les zones enregistrées forment UN groupe : une nouvelle zone se pose au sommet du groupe', () => {
    const c = carteSimulee();
    for (const id of ['custom-zone-fill-a', 'custom-zone-line-a', 'apercu-rayon-fill', 'custom-zone-fill-b', 'custom-zone-line-b']) c.poser(id);
    expect(c.couches).toEqual(['custom-zone-fill-a', 'custom-zone-line-a', 'custom-zone-fill-b', 'custom-zone-line-b', 'apercu-rayon-fill']);
    expect(rangCouche('custom-zone-fill-b')).toBe(rangCouche('custom-zone-line-a'));
  });

  it('quel que soit l’ordre des gestes, toute couche d’après le load finit au-dessus de toute couche du load', () => {
    const apres = COUCHES_APRES_LOAD.map((e) => e.replace('*', 'fill-x'));
    const load = ORDRE_COUCHES.filter((e) => !COUCHES_APRES_LOAD.includes(e));
    // Ordre de pose alterné et inversé : une couche du load sur deux posée APRÈS celles d'après le load.
    const c = carteSimulee();
    for (const id of [...apres].reverse()) c.poser(id);
    for (const id of load) c.poser(id);
    const premierApres = Math.min(...apres.map((id) => c.couches.indexOf(id)));
    const dernierLoad = Math.max(...load.map((id) => c.couches.indexOf(id)));
    expect(dernierLoad).toBeLessThan(premierApres);
    expect(c.couches).toEqual([...load, ...apres]);
  });
});
