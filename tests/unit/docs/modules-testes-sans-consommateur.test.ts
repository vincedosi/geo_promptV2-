import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, sep, relative } from 'node:path';

/**
 * @file tests/unit/docs/modules-testes-sans-consommateur.test.ts
 *
 * ── L'angle mort de `npm run catalogue` ────────────────────────────────────
 *
 * Les fichiers de test sont des POINTS D'ENTRÉE de knip. Un module de `lib/`
 * ou `components/` qu'aucun code de production n'importe, mais qu'un test
 * importe, est donc « atteint » : il n'apparaît jamais dans
 * `docs/CATALOGUE_CODE.md`, et ses tests verts donnent l'impression que
 * quelque chose est gardé.
 *
 * ── Ce que la mesure a dit, le 2026-09-16 ──────────────────────────────────
 *
 * La ligne `"tests/**` + `/*.test.ts"` du tableau `entry` de `knip.json` a été
 * accusée d'en être la cause. **Elle ne l'est pas, et la retirer ne change
 * rien** — mesuré : 196 exports morts / 4 fichiers morts, avant comme après.
 * Le plugin Vitest de knip lit `vitest.config.ts` et ajoute lui-même son
 * `include` (`tests/**` + `/*.test.ts`) aux points d'entrée ; la ligne du
 * fichier de configuration est redondante, pas coupable. Elle est conservée
 * parce qu'explicite vaut mieux qu'implicite.
 *
 * La seule bascule qui change quelque chose est `"vitest": false`, et elle
 * coûte plus qu'elle ne rapporte : 196 → **302 exports morts**, la centaine
 * d'écart étant en grande partie des utilitaires légitimement propres aux
 * tests. Un cliquet posé sur 302 ne cliquette plus.
 *
 * D'où ce fichier : il pose LA question précise — « quel module de production
 * n'est importé que par un test ? » — au lieu de dérégler l'outil qui répond à
 * une autre. Sept modules aujourd'hui, chacun avec sa raison écrite. Un
 * huitième fait échouer la suite.
 *
 * C'est important parce que le cas nominal est un piège : `lib/qualite/
 * verdict.ts` se présentait comme « la règle de verdict de la page » et avait
 * douze tests verts, alors que la page lit une RPC et que le `CASE` qui décide
 * vit en SQL. Douze tests qui ne gardaient rien, et personne pour le voir.
 */

const RACINE = process.cwd();

/** Modules importés seulement par des tests, et pourquoi c'est (ou non) acceptable. */
const ATTENDUS: Record<string, string> = {
  'lib/analyses/score.ts':
    'JUMEAU TypeScript ASSUMÉ de `calculer_score_composite` (sql/146, sql/170), nommé comme '
    + "tel dans ARCHITECTURE.md. Il n'a pas à avoir de consommateur : son rôle est d'être "
    + "l'oracle testable sans base de la RPC qui, elle, tourne en production. "
    + '⚠ LIMITE : le croisement avec la RPC a eu lieu UNE FOIS, à la main, le 2026-09-14. '
    + 'Rien ne le rejoue — si sql/170 est retouchée, les tests restent verts et le score '
    + "affiché n'a plus d'oracle.",
  'lib/qualite/verdict.ts':
    'JUMEAU TypeScript de `qualite_indicateurs` (sql/149, corrigée sql/152) — troisième du '
    + "projet, et le seul qui ne se présentait PAS comme tel : son en-tête l'annonçait comme "
    + '« la règle de verdict de la page », ce qui laissait croire que /admin/qualite-donnees '
    + "l'exécutait. Elle lit la RPC ; le CASE qui décide vit en SQL. En-tête corrigé le "
    + '2026-09-16, et `tests/unit/qualite/verdicts.test.ts` compare désormais les six '
    + 'verdicts du jumeau aux branches réelles du CASE de sql/152.',
  'lib/dsp/push/index.ts':
    "PLOMBERIE SANS APPELANT — spec §5 (sélection du connecteur de push par canal). Aucune "
    + "route ne l'appelle : l'activation DV360 passe par "
    + '`/api/admin/dsp/dv360/targeting/push`, qu\'enveloppe '
    + '`/api/campaigns/[id]/activation/pousser`. Antérieur à feat/suivi-v2. À trancher — '
    + 'brancher ou retirer — c\'est un arbitrage produit, pas un nettoyage.',
  'lib/dsp/push/types.ts': 'Types de la plomberie ci-dessus. Même sort.',
  'lib/dsp/push/dv360.ts': 'Connecteur DV360 de la plomberie ci-dessus. Même sort.',
  'lib/dsp/push/simulated.ts': 'Connecteurs simulé/ignoré de la plomberie ci-dessus. Même sort.',
  // Les trois entrées TEMPORAIRES du lot 3 (`lib/zones/recette.ts`, `recette-schema.ts`,
  // `executer-recette.ts`) ont été retirées le 2026-10-15 (Task 8) : les routes `/api/zones`
  // les importent, par `lib/zones/session-zones.ts`. Celle de `lib/zones/conversion.ts` (lot 5,
  // Task 5) l'a été le 2026-10-24 (lot 5, Task 8) : `/api/zones/[id]/cercles` et l'extraction l'importent.
};

// ── Graphe d'imports ────────────────────────────────────────────────────────

function fichiers(dossier: string): string[] {
  const trouves: string[] = [];
  if (!existsSync(dossier)) return trouves;
  for (const entree of readdirSync(dossier)) {
    if (entree === 'node_modules' || entree === '.next') continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (/\.tsx?$/.test(entree)) trouves.push(chemin);
  }
  return trouves;
}

const posix = (p: string) => p.split(sep).join('/');

/** Clé canonique d'un module : chemin depuis la racine, sans extension ni `/index`. */
function cle(cheminRelatif: string): string {
  return cheminRelatif.replace(/\.tsx?$/, '').replace(/\/index$/, '');
}

/** Les spécifieurs d'import d'un fichier, résolus en clés canoniques. */
function importsDe(cheminAbsolu: string): string[] {
  const source = readFileSync(cheminAbsolu, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const dossier = posix(relative(RACINE, dirname(cheminAbsolu)));
  const cles: string[] = [];
  const motif = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(motif)) {
    const spec = m[1];
    if (spec.startsWith('@/')) cles.push(cle(spec.slice(2)));
    else if (spec.startsWith('.')) {
      // Résolution relative sans `path.resolve` (qui rendrait un chemin absolu
      // Windows) : on normalise à la main les `.` et `..`.
      const segments = [...dossier.split('/'), ...spec.split('/')];
      const pile: string[] = [];
      for (const s of segments) {
        if (s === '.' || s === '') continue;
        if (s === '..') pile.pop();
        else pile.push(s);
      }
      cles.push(cle(pile.join('/')));
    }
  }
  return cles;
}

describe('modules de production importés seulement par des tests', () => {
  const sources = [
    ...fichiers(join(RACINE, 'app')),
    ...fichiers(join(RACINE, 'lib')),
    ...fichiers(join(RACINE, 'components')),
    ...fichiers(join(RACINE, 'scripts')),
  ];
  const tests = fichiers(join(RACINE, 'tests'));

  /** `clé canonique → chemin réel`, pour tous les modules du projet. */
  const parCle = new Map<string, string>();
  for (const f of sources) parCle.set(cle(posix(relative(RACINE, f))), f);

  /**
   * Fermeture transitive des imports depuis un ensemble de racines.
   * Indispensable : sans elle, `lib/dsp/push/dv360.ts` passerait pour vivant
   * parce que `lib/dsp/push/index.ts` l'importe — alors que rien n'atteint
   * `index.ts` lui-même. C'est le raisonnement de knip, refait ici sur la
   * seule question qui nous intéresse.
   */
  function atteignables(racines: string[]): Set<string> {
    const vus = new Set<string>();
    const pile = [...racines];
    while (pile.length > 0) {
      const chemin = pile.pop()!;
      const k = cle(posix(relative(RACINE, chemin)));
      if (vus.has(k)) continue;
      vus.add(k);
      for (const importe of importsDe(chemin)) {
        const cible = parCle.get(importe);
        if (cible) pile.push(cible);
      }
    }
    return vus;
  }

  /**
   * Les points d'entrée de PRODUCTION — la même liste que `knip.json`, moins
   * les tests. Next.js atteint une page par convention de nom de fichier, pas
   * par un import : sans cette liste, tout le projet paraîtrait mort.
   */
  const RACINES_PRODUCTION = [
    ...sources.filter((f) => {
      const r = posix(relative(RACINE, f));
      return r.startsWith('app/') && /\/(page|layout|route|loading|error|not-found|template|default)\.tsx?$/.test(r);
    }),
    ...sources.filter((f) => posix(relative(RACINE, f)).startsWith('scripts/')),
    ...sources.filter((f) => posix(relative(RACINE, f)).startsWith('lib/inngest/')),
    ...['middleware.ts', 'instrumentation.ts', 'app/global-error.tsx']
      .map((f) => join(RACINE, f))
      .filter((f) => existsSync(f)),
  ];

  const vivants = atteignables(RACINES_PRODUCTION);
  const vusParTests = atteignables(tests);

  /** Les modules de `lib/` et `components/` que SEUL un test atteint. */
  const testSeulement = sources
    .map((f) => posix(relative(RACINE, f)))
    .filter((f) => f.startsWith('lib/') || f.startsWith('components/'))
    .filter((f) => vusParTests.has(cle(f)) && !vivants.has(cle(f)))
    .sort();

  it('le graphe d imports a bien été construit (garde-fou du test)', () => {
    expect(sources.length, 'aucune source trouvée').toBeGreaterThan(300);
    expect(tests.length, 'aucun test trouvé').toBeGreaterThan(100);
    expect(RACINES_PRODUCTION.length, 'aucun point d entrée de production trouvé').toBeGreaterThan(150);
    expect(vivants.size, 'la fermeture transitive de production n a presque rien atteint').toBeGreaterThan(300);
    expect(vusParTests.size, 'la fermeture transitive des tests n a presque rien atteint').toBeGreaterThan(150);
  });

  it('chacun a une raison écrite — sinon ce sont des tests qui ne gardent rien', () => {
    const nonJustifies = testSeulement.filter((f) => !ATTENDUS[f]);
    expect(
      nonJustifies,
      'Ces modules de production ne sont importés QUE par des tests :\n'
      + nonJustifies.map((f) => `  ${f}`).join('\n')
      + "\n\nknip ne les verra jamais (les tests sont des points d'entrée), et leurs tests "
      + 'verts donnent l\'impression que quelque chose est gardé. Trois issues :\n'
      + "  - c'est un JUMEAU d'une fonction SQL : le dire dans l'en-tête du fichier ET ici, "
      + "avec la date du dernier croisement — un oracle non rejoué se périme ;\n"
      + '  - le module devrait être branché : le brancher ;\n'
      + '  - il est mort : le supprimer avec son test.',
    ).toEqual([]);
  });

  it('aucune raison ne survit au module qu elle décrivait', () => {
    const perimees = Object.keys(ATTENDUS).filter((f) => !testSeulement.includes(f)).sort();
    expect(
      perimees,
      `Entrées périmées : ${perimees.join(', ')}. Le module a-t-il été branché (retirer `
      + `l'entrée) ou supprimé (retirer l'entrée et son test) ?`,
    ).toEqual([]);
  });

  it('les trois jumeaux TypeScript se déclarent comme tels dans leur en-tête', () => {
    // Le défaut de `lib/qualite/verdict.ts` n'était pas d'exister sans
    // consommateur — c'est le propre d'un jumeau — mais de ne pas le DIRE.
    // Un lecteur pressé en concluait que la page exécutait ce code.
    const jumeaux = [
      'lib/analyses/score.ts',
      'lib/campagne/alignement.ts',
      'lib/qualite/verdict.ts',
    ];
    const muets = jumeaux.filter((f) => {
      const entete = readFileSync(join(RACINE, f), 'utf8').slice(0, 2500);
      return !/[Jj]umeau/.test(entete);
    });
    expect(
      muets,
      `Ces fichiers sont des jumeaux TypeScript d'une fonction SQL mais ne le disent pas dans `
      + `leur en-tête : ${muets.join(', ')}. Sans cette mention, ils se lisent comme le code `
      + `que la production exécute — ce qu'ils ne sont pas.`,
    ).toEqual([]);
  });
});
