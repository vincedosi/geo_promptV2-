import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @file tests/unit/angular/panneau-analyse-garde.test.ts — verrou structurel de la garde de périmètre, côté Angular
 * (lot 4, T17). Pendant de `tests/unit/carte/panneau-analyse-garde.test.ts`, et pour la même raison : un test qui
 * exercerait une façade ne verrait pas un câblage NU dans le vrai composant (en-tête de `garde-perimetre.ts`). Ce test
 * lit le SOURCE du panneau Analyse Angular et de ses deux outils.
 *
 * Le contrat :
 *   1. chaque gestionnaire de lancement du panneau commence par `if (!this.verifierPerimetreOutil('<outil>')) return;`
 *      — AVANT tout appel de service, donc avant toute requête ;
 *   2. les sorties de lancement des outils sont câblées sur CES gestionnaires, et sur aucun autre ;
 *   3. les outils n'appellent JAMAIS eux-mêmes une méthode de lancement d'un service : ils émettent, le panneau garde ;
 *   4. les méthodes de lancement des services ne sont appelées QUE depuis un gestionnaire gardé.
 *
 * ⚠️ Tout nouveau point de lancement (assistant de clustering T20) s'ajoute à `HANDLERS_GARDE_OUTIL`. Le score composite
 * (T18) y est. Pour une RELECTURE gardée sans refus national (chargement des clusters, T19) : `HANDLERS_GARDE_GENERIQUE`.
 * La corrélation n'y est PAS, délibérément : bornée par une campagne, elle ne balaie aucun territoire (dernier test).
 */
const RACINE = join(process.cwd(), 'angular/src/app/features/carte/panneaux/analyse');
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf-8');
const PANNEAU = lire('panneau-analyse.component.ts');
const OUTILS = ['outil-isochrones.component.ts', 'outil-bataille-v2.component.ts', 'outil-score.component.ts'];

/** [gestionnaire du panneau, outil de `garde-perimetre.ts`, appel de service qu'il garde]. */
const HANDLERS_GARDE_OUTIL: Array<[nom: string, outil: string, appel: string]> = [
  ['verifierCacheV1', 'bataille_v1', 'this.v1.verifierCache('],
  ['lancerV1', 'bataille_v1', 'this.v1.lancer('],
  ['appliquerBataille', 'application_bataille', 'this.v1.appliquer('],
  ['verifierCacheV2', 'bataille_v2', 'this.v2.verifierCache('],
  ['remplirV2', 'bataille_v2', 'this.v2.remplir('],
  ['lancerV2', 'bataille_v2', 'this.v2.lancer('],
  ['lancerScore', 'score_composite', 'this.scoreComposite.lancer('],
];

/** [gestionnaire du panneau, appel de service] gardés par la garde GÉNÉRIQUE (sans refus national). */
const HANDLERS_GARDE_GENERIQUE: Array<[nom: string, appel: string]> = [
  ['chargerClusters', 'this.clusters.charger('],
];

/** Les composants du clustering : ils ÉMETTENT `charger`, jamais ne l'appellent sur le service. */
const CLUSTERING = ['clustering/section-clustering.component.ts', 'clustering/panneau-clusters.component.ts'];

/** [balise de l'outil, sortie, appel attendu dans le gabarit]. */
const SORTIES: Array<[balise: string, sortie: string, appel: string]> = [
  ['mg-outil-isochrones', 'verifierCache', 'verifierCacheV1()'],
  ['mg-outil-isochrones', 'lancer', 'lancerV1($event)'],
  ['mg-outil-isochrones', 'appliquer', 'appliquerBataille()'],
  ['mg-outil-bataille-v2', 'verifierCache', 'verifierCacheV2()'],
  ['mg-outil-bataille-v2', 'remplir', 'remplirV2()'],
  ['mg-outil-bataille-v2', 'lancer', 'lancerV2($event)'],
  ['mg-outil-score', 'lancer', 'lancerScore()'],
];

/** Le corps d'une méthode de classe `nom(…) … {`, par comptage d'accolades — exactement une déclaration. */
function corpsDeMethode(nom: string): string {
  const declarations = [...PANNEAU.matchAll(new RegExp(`\\n\\s*(?:protected |private |public )?${nom}\\(([^)]*)\\)(?::\\s*\\w+)?\\s*\\{`, 'g'))];
  expect(declarations.length, `méthode "${nom}" : ${declarations.length} déclaration(s) dans panneau-analyse.component.ts`).toBe(1);
  const debut = declarations[0].index! + declarations[0][0].length - 1;
  let profondeur = 0;
  let i = debut;
  for (; i < PANNEAU.length; i++) {
    if (PANNEAU[i] === '{') profondeur++;
    else if (PANNEAU[i] === '}' && --profondeur === 0) break;
  }
  return PANNEAU.slice(debut + 1, i);
}

/** La balise ouvrante complète d'un élément du gabarit (attributs multi-lignes compris). */
function baliseOuvrante(balise: string): string {
  const m = PANNEAU.match(new RegExp(`<${balise}\\b[^>]*>`));
  expect(m, `<${balise}> introuvable dans le gabarit du panneau`).not.toBeNull();
  return m![0];
}

describe('Panneau Analyse Angular — verrou structurel de la garde de périmètre (T17)', () => {
  it.each(HANDLERS_GARDE_OUTIL)('« %s » commence par verifierPerimetreOutil(\'%s\'), puis appelle %s', (nom, outil, appel) => {
    const corps = corpsDeMethode(nom).trim();
    expect(corps.startsWith(`if (!this.verifierPerimetreOutil('${outil}')) return;`), `premier énoncé de ${nom} :\n${corps}`).toBe(true);
    expect(corps).toContain(appel);
  });

  it.each(SORTIES)('<%s> : la sortie (%s) est câblée sur %s', (balise, sortie, appel) => {
    expect(baliseOuvrante(balise)).toContain(`(${sortie})="${appel}"`);
  });

  it.each(OUTILS)('%s n’appelle aucune méthode de lancement d’un service (il émet, le panneau garde)', (f) => {
    expect(lire(f)).not.toMatch(/\.(lancer|verifierCache|remplir|appliquer)\(/);
  });

  it('les lancements de service ne sont appelés QUE depuis les gestionnaires gardés', () => {
    const gardes = HANDLERS_GARDE_OUTIL.map(([nom]) => corpsDeMethode(nom)).join('\n');
    for (const [, , appel] of HANDLERS_GARDE_OUTIL) {
      const total = PANNEAU.split(appel).length - 1;
      const dansGardes = gardes.split(appel).length - 1;
      expect(total, `${appel} appelé hors d’un gestionnaire gardé`).toBe(dansGardes);
    }
  });

  it('verifierPerimetreOutil lit messageGardeOutil(outil, filtre) — la logique pure, jamais une copie', () => {
    expect(corpsDeMethode('verifierPerimetreOutil')).toContain('messageGardeOutil(outil, this.etat.filtre())');
  });

  // ── Clustering (T19) : la RELECTURE d'un modèle déjà calculé (`GET /api/poi-clusters?duration=`) passe par la garde
  // GÉNÉRIQUE, sans refus national — `handleLoadClustersGarde` de `PanneauAnalyse.tsx:278` (« pas le calcul lourd »).
  // Le calcul lourd (`POST /api/poi-clusters/run`, T20) s'ajoutera à `HANDLERS_GARDE_OUTIL` avec l'outil `clustering`.
  it.each(HANDLERS_GARDE_GENERIQUE)('« %s » commence par verifierPerimetre(), puis appelle %s', (nom, appel) => {
    const corps = corpsDeMethode(nom).trim();
    expect(corps.startsWith('if (!this.verifierPerimetre()) return;'), `premier énoncé de ${nom} :\n${corps}`).toBe(true);
    expect(corps).toContain(appel);
    expect(PANNEAU.split(appel).length - 1, `${appel} appelé hors de ${nom}`).toBe(1);
  });

  it('verifierPerimetre lit messageGardePerimetre(this.etat.filtre()) — la logique pure', () => {
    expect(corpsDeMethode('verifierPerimetre')).toContain('messageGardePerimetre(this.etat.filtre())');
  });

  it('<mg-section-clustering> : la sortie (charger) est câblée sur chargerClusters()', () => {
    expect(baliseOuvrante('mg-section-clustering')).toContain('(charger)="chargerClusters()"');
  });

  it.each(CLUSTERING)('%s ne charge jamais les clusters lui-même (il émet, le panneau garde)', (f) => {
    expect(lire(f)).not.toMatch(/\.charger\(/);
  });

  it('le Voronoï est ABSENT du panneau (décision du propriétaire : il n’existait que par l’Assistant)', () => {
    expect(PANNEAU).not.toMatch(/voronoi'|VoronoiTool|Voronoï géométrique/);
  });

  it('la corrélation n’est PAS gardée, délibérément (PanneauAnalyse.tsx:442-450) : aucune sortie de lancement', () => {
    expect(baliseOuvrante('mg-outil-correlation')).toBe('<mg-outil-correlation />');
  });
});
