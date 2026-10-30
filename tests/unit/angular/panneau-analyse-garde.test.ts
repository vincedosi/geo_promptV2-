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
 * ⚠️ Tout nouveau point de lancement s'ajoute à `HANDLERS_GARDE_OUTIL`. Le score composite (T18) et l'assistant de
 * clustering (T20, `lancerClustering`) y sont. Pour une RELECTURE gardée sans refus national (chargement des clusters, T19) : `HANDLERS_GARDE_GENERIQUE`.
 * Absences de garde ASSUMÉES : la corrélation (bornée par une campagne, elle ne balaie aucun territoire — avant-dernier
 * test) ; la couverture d'une zone (lot 4, T8 : la zone analysée EST le périmètre, bornée côté serveur à 100 000 km² et
 * 400 000 carreaux, quota 6/min — avant-dernier test) ; la couverture par rayon (lot 4, T12 : `resoudre_perimetre` refuse en
 * base la France, la région et plus de 12 000 km², quota 6/min — dernier test) ;
 * le changement de durée des clusters (`ClustersService.changerDuree`, relecture GET d'un autre modèle, sans garde chez
 * React — `onClusterDurationChange` — et seulement joignable une fois des clusters chargés sous garde).
 */
const RACINE = join(process.cwd(), 'angular/src/app/features/carte/panneaux/analyse');
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf-8');
const PANNEAU = lire('panneau-analyse.component.ts');
// `outil-isochrones.component.ts` (bataille V1) est retiré d'Angular le 27/10 (décision de Vincent) : plus de V1 à garder.
const OUTILS = ['outil-bataille-v2.component.ts', 'outil-score.component.ts'];

/** [gestionnaire du panneau, outil de `garde-perimetre.ts`, appel de service qu'il garde]. */
const HANDLERS_GARDE_OUTIL: Array<[nom: string, outil: string, appel: string]> = [
  ['verifierCacheV2', 'bataille_v2', 'this.v2.verifierCache('],
  ['remplirV2', 'bataille_v2', 'this.v2.remplir('],
  ['lancerV2', 'bataille_v2', 'this.v2.lancer('],
  ['lancerScore', 'score_composite', 'this.scoreComposite.lancer('],
  // L'assistant de clustering (T20) : le `POST /api/poi-clusters/run`, refusé sur la France entière.
  ['lancerClustering', 'clustering', 'this.calculClustering.lancer('],
];

/** [gestionnaire du panneau, appel de service] gardés par la garde GÉNÉRIQUE (sans refus national). */
const HANDLERS_GARDE_GENERIQUE: Array<[nom: string, appel: string]> = [
  ['chargerClusters', 'this.clusters.charger('],
];

/** Les composants du clustering : ils ÉMETTENT `charger`, jamais ne l'appellent sur le service. */
const CLUSTERING = ['clustering/section-clustering.component.ts', 'clustering/panneau-clusters.component.ts', 'clustering/etat-panneau-clusters.service.ts',
  'clustering/assistant-clustering.component.ts', 'clustering/assistant/etat-assistant-clustering.service.ts', 'clustering/assistant/etape-types.component.ts',
  'clustering/assistant/etape-perimetre.component.ts', 'clustering/assistant/etape-parametres.component.ts', 'clustering/assistant/choix-variables.component.ts',
  'clustering/assistant/etape-execution.component.ts'];

/** [balise de l'outil, sortie, appel attendu dans le gabarit]. */
const SORTIES: Array<[balise: string, sortie: string, appel: string]> = [
  ['mg-outil-bataille-v2', 'verifierCache', 'verifierCacheV2()'],
  ['mg-outil-bataille-v2', 'remplir', 'remplirV2()'],
  ['mg-outil-bataille-v2', 'lancer', 'lancerV2($event)'],
  ['mg-outil-score', 'lancer', 'lancerScore()'],
  ['mg-section-clustering', 'lancerCalcul', 'lancerClustering($event)'],
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

  it('verifierPerimetreOutil lit messageGardeCarte(outil, filtre, zone), qui délègue à messageGardeOutil hors métropole (retours 26/10, T4)', () => {
    expect(corpsDeMethode('verifierPerimetreOutil')).toContain('messageGardeCarte(outil, this.etat.filtre(), zone)');
    const enveloppe = readFileSync(join(process.cwd(), 'angular/src/app/features/carte/logique/perimetre-national.ts'), 'utf-8');
    expect(enveloppe).toContain('if (!estMetropole(filtre)) return messageGardeOutil(outil, filtre, zone);');
  });

  it('la bataille V2 refuse EN PLUS un filtre code postal ou zone, qu’elle ne transmet pas (registre, ligne 71)', () => {
    const corps = corpsDeMethode('verifierPerimetreOutil');
    expect(corps).toContain("outil === 'bataille_v2'");
    expect(corps).toContain('messageRefusTerritoireBataille(this.etat.filtre())');
  });

  it('④ finitions (T7) : la bataille ne passe sans garde de ① QUE sur la zone analysée qu’elle lit (« Sur : la zone »)', () => {
    const corps = corpsDeMethode('verifierPerimetreOutil');
    expect(corps).toContain('const zone = this.zoneDeLOutil(outil);');
    expect(corps).toContain('bataille && zone ? null : messageGardeCarte(outil, this.etat.filtre(), zone)');
    expect(PANNEAU).toContain("return outil === 'bataille_v2' ? this.v2.zoneBataille() : null;");
    // Le service : sur la zone, ni comptage de la métropole, ni vérification du cache, ni remplissage ORS (ils lisent ①).
    const service = readFileSync(join(process.cwd(), 'angular/src/app/features/carte/etat/bataille-v2.service.ts'), 'utf-8');
    expect(service).toContain('if (zone) this.lancerDans(ctx, paliers, force, zone);');
    expect(service.match(/\|\| this\.zoneBataille\(\)\) return;/g)?.length).toBe(2);
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

  // T20 : l'assistant ÉMET le corps du POST ; seul le panneau, gardé, appelle `CalculClusteringService.lancer`.
  it.each(CLUSTERING)('%s ne lance jamais le calcul lui-même (il émet, le panneau garde)', (f) => {
    expect(lire(f)).not.toMatch(/\.lancer\(/);
  });

  it('le relais du refus : <mg-section-clustering> reçoit le message de garde du panneau', () => {
    expect(baliseOuvrante('mg-section-clustering')).toContain('[refusCalcul]="gardeMessage()"');
  });

  it('le Voronoï est ABSENT du panneau (décision du propriétaire : il n’existait que par l’Assistant)', () => {
    expect(PANNEAU).not.toMatch(/voronoi'|VoronoiTool|Voronoï géométrique/);
  });

  it('la corrélation n’est PAS gardée, délibérément (PanneauAnalyse.tsx:442-450) : aucune sortie de lancement', () => {
    expect(baliseOuvrante('mg-outil-correlation')).toBe('<mg-outil-correlation />');
  });

  it('la couverture d’une zone n’est PAS gardée par ①, délibérément (lot 4, T8) : la zone est le périmètre', () => {
    expect(baliseOuvrante('mg-outil-couverture')).toBe('<mg-outil-couverture />');
    // Elle n'emploie aucune garde de ① ni le filtre : son seul calcul est `ZoneAnalyseeService.chiffrer()`, borné en SQL.
    const outil = lire('outil-couverture.component.ts');
    // Le CODE, pas l'en-tête (qui explique pourquoi il n'y a pas de `verifierPerimetreOutil`).
    expect(outil).not.toMatch(/\.verifierPerimetre|messageGarde\w*\(|etat\.filtre/);
    expect(outil).toContain('z.chiffrer()');
  });

  it('la couverture par rayon n’est PAS gardée par ①, délibérément (lot 4, T12) : la base borne le périmètre', () => {
    expect(baliseOuvrante('mg-outil-rayon')).toBe('<mg-outil-rayon />');
    // Le seul calcul est `CouvertureRayonService.lancer()` ; l'outil ne lit ni la garde ni le filtre.
    const outil = lire('outil-rayon.component.ts');
    expect(outil).not.toMatch(/\.verifierPerimetre|messageGarde\w*\(|etat\.filtre/);
    expect(outil).toContain('s.lancer()');
  });

  it('la bataille V1 est RETIRÉE (27/10) : ni outil, ni service, ni gestionnaire, ni appel V1 dans le panneau', () => {
    // Le code seul : les commentaires racontent le retrait et peuvent nommer ce qui est parti.
    const code = PANNEAU.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    expect(code).not.toMatch(/mg-outil-isochrones|BatailleV1Service|verifierCacheV1|lancerV1|appliquerBataille|'bataille_v1'|'application_bataille'/);
    const api = readFileSync(join(process.cwd(), 'angular/src/app/features/carte/data/isochrones.api.ts'), 'utf-8');
    expect(api).not.toContain("'isochrone-battle/apply-battle'");
    // La route protégée `/api/isochrone-battle` ne sert plus, côté Angular, QUE le remplissage ORS du cache de la V2.
    expect(api.match(/this\.flux\('isochrone-battle'/g)).toHaveLength(1);
    expect(api).toContain('remplirCache(');
  });
});
