#!/usr/bin/env node
/**
 * scripts/catalogue.mjs — génère docs/CATALOGUE_CODE.md à partir de `knip`.
 *
 * Répond en une passe à « qu'est-ce qui sert encore ? » : exports morts,
 * fichiers morts, dépendances déclarées jamais importées. Jamais une liste
 * tenue à la main (voir CLAUDE.md — `docs/architecture.md` qui affirmait
 * « 70 tables — RLS partout » est l'exemple à ne pas reproduire).
 *
 * Usage : `npm run catalogue`. Ne modifie que `docs/CATALOGUE_CODE.md`.
 *
 * ── UN ANGLE MORT CONNU, mesuré le 2026-09-16 ──────────────────────────────
 *
 * Les fichiers de test sont des POINTS D'ENTRÉE de knip. Un module de `lib/`
 * ou `components/` qu'aucun code de production n'importe, mais qu'un test
 * importe, compte donc comme « utilisé » et n'apparaît JAMAIS dans ce
 * catalogue.
 *
 * La ligne `"tests/**` + `/*.test.ts"` du tableau `entry` de `knip.json` en a
 * été accusée. Elle est **redondante, pas coupable** : le plugin Vitest de
 * knip lit `vitest.config.ts` et ajoute lui-même son `include` aux points
 * d'entrée. Retirer la ligne ne change rien — mesuré, 196 exports morts et
 * 4 fichiers morts avant comme après. Elle est conservée parce qu'explicite
 * vaut mieux qu'implicite.
 *
 * La seule bascule qui change le résultat est `"vitest": false`, et elle coûte
 * plus qu'elle ne rapporte : 196 → 302 exports morts, l'écart étant en grande
 * partie des utilitaires légitimement propres aux tests. Un cliquet posé sur
 * 302 ne cliquette plus.
 *
 * La question précise — « quel module de production n'est atteint que par un
 * test ? » — est donc posée ailleurs, par
 * `tests/unit/docs/modules-testes-sans-consommateur.test.ts`, qui refait la
 * fermeture transitive depuis les points d'entrée de production et exige une
 * raison écrite pour chacun des sept modules concernés.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'docs', 'CATALOGUE_CODE.md');

/**
 * Chemin vers le binaire knip. Appele via `node <bin.js>` plutot que
 * `npx knip` : `execFileSync('npx', ...)` echoue en ENOENT sous Windows
 * (npx.cmd n'est pas resolu sans `shell: true`, qu'on veut eviter ici).
 * Lu directement via `fs` (pas `require('knip/package.json')`, que
 * l'`exports` de knip interdit) : chemin stable, `node_modules/knip` est le
 * seul endroit ou npm installe ce paquet.
 */
function cheminKnipBin() {
  const pkgPath = join(ROOT, 'node_modules', 'knip', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return join(ROOT, 'node_modules', 'knip', pkg.bin.knip);
}

function shaCourant() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'inconnu';
  }
}

function lancerKnip() {
  try {
    // knip rend un code de sortie non-nul des qu'il trouve un probleme —
    // c'est le cas normal ici, pas une erreur du script.
    const stdout = execFileSync(process.execPath, [cheminKnipBin(), '--reporter', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    });
    return JSON.parse(stdout);
  } catch (err) {
    // execFileSync leve quand le process fils sort en erreur — knip le fait
    // des qu'il liste au moins un probleme. La sortie utile est dans err.stdout.
    // LEVE plutot que process.exit(1) : cette fonction est aussi appelee depuis
    // `tests/unit/docs/catalogue-code.test.ts`, et un `process.exit` y tuerait
    // le worker Vitest au lieu de faire echouer proprement le test — on
    // perdrait le message qui dit pourquoi. Le chemin CLI, lui, attrape et sort
    // en erreur (voir plus bas).
    const stdout = err.stdout?.toString();
    if (!stdout) {
      throw new Error(
        '[catalogue] knip n’a produit aucune sortie exploitable : '
        + (err.stderr?.toString() ?? err.message),
      );
    }
    try {
      return JSON.parse(stdout);
    } catch (parseErr) {
      throw new Error(
        `[catalogue] sortie knip illisible en JSON : ${parseErr.message}
`
        + stdout.slice(0, 2000),
      );
    }
  }
}

function estFichierMort(issue) {
  return (
    issue.files?.length > 0 &&
    issue.exports.length === 0 &&
    issue.types.length === 0 &&
    issue.dependencies.length === 0 &&
    issue.devDependencies.length === 0 &&
    issue.duplicates.length === 0
  );
}

function construireRapport(data) {
  const issues = data.issues ?? [];

  const fichiersMorts = [];
  const exportsParFichier = []; // { file, count, exports: string[], types: string[] }
  const dependancesInutilisees = [];
  const devDependancesInutilisees = [];
  const doublons = [];

  for (const issue of issues) {
    if (estFichierMort(issue)) {
      fichiersMorts.push(issue.file);
      continue;
    }
    const nomsExports = issue.exports.map((e) => e.name);
    const nomsTypes = issue.types.map((t) => t.name);
    if (nomsExports.length > 0 || nomsTypes.length > 0) {
      exportsParFichier.push({
        file: issue.file,
        count: nomsExports.length + nomsTypes.length,
        exports: nomsExports,
        types: nomsTypes,
      });
    }
    for (const dep of issue.dependencies) dependancesInutilisees.push({ file: issue.file, name: dep.name });
    for (const dep of issue.devDependencies) devDependancesInutilisees.push({ file: issue.file, name: dep.name });
    for (const dup of issue.duplicates) {
      doublons.push({ file: issue.file, noms: dup.map((d) => d.name).join(' / ') });
    }
  }

  exportsParFichier.sort((a, b) => b.count - a.count);
  fichiersMorts.sort();

  const totalExportsMorts = exportsParFichier.reduce((acc, r) => acc + r.count, 0);
  const totalFichiersMorts = fichiersMorts.length;
  const totalDependancesInutilisees = dependancesInutilisees.length + devDependancesInutilisees.length;

  return {
    totalExportsMorts,
    totalFichiersMorts,
    totalDependancesInutilisees,
    fichiersMorts,
    exportsParFichier,
    dependancesInutilisees,
    devDependancesInutilisees,
    doublons,
  };
}

function formaterMarkdown(rapport, sha, date) {
  const lignes = [];

  lignes.push('# Catalogue du code');
  lignes.push('');
  lignes.push(`> Fichier **généré** par \`npm run catalogue\` (\`scripts/catalogue.mjs\`, via \`knip\`).`);
  lignes.push('> Ne JAMAIS éditer ce fichier à la main — toute modification manuelle sera écrasée au');
  lignes.push('> prochain lancement, et une correction faite ici mentirait dès le prochain import.');
  lignes.push('>');
  lignes.push(`> Généré le ${date} — commit \`${sha}\`.`);
  lignes.push('');
  lignes.push('## Totaux');
  lignes.push('');
  lignes.push(`- Exports morts : ${rapport.totalExportsMorts}`);
  lignes.push(`- Fichiers morts : ${rapport.totalFichiersMorts}`);
  lignes.push(`- Dépendances inutilisées : ${rapport.totalDependancesInutilisees}`);
  lignes.push('');
  lignes.push(
    '`tests/unit/docs/catalogue-code.test.ts` verrouille « Exports morts » avec un cliquet : ' +
      'la baisse est libre, la hausse fait échouer le test.',
  );
  lignes.push('');

  lignes.push('## Fichiers morts');
  lignes.push('');
  if (rapport.fichiersMorts.length === 0) {
    lignes.push('_Aucun._');
  } else {
    lignes.push('Fichiers du périmètre analysé qu’aucun point d’entrée ne référence, directement ou');
    lignes.push('transitivement.');
    lignes.push('');
    for (const f of rapport.fichiersMorts) lignes.push(`- \`${f}\``);
  }
  lignes.push('');

  lignes.push('## Exports et types morts, par fichier');
  lignes.push('');
  lignes.push('Trié par nombre d’occurrences décroissant.');
  lignes.push('');
  if (rapport.exportsParFichier.length === 0) {
    lignes.push('_Aucun._');
  } else {
    lignes.push('| Fichier | Occurrences | Exports | Types |');
    lignes.push('|---|---|---|---|');
    for (const r of rapport.exportsParFichier) {
      lignes.push(
        `| \`${r.file}\` | ${r.count} | ${r.exports.join(', ') || '—'} | ${r.types.join(', ') || '—'} |`,
      );
    }
  }
  lignes.push('');

  lignes.push('## Dépendances déclarées jamais importées');
  lignes.push('');
  if (rapport.dependancesInutilisees.length === 0 && rapport.devDependancesInutilisees.length === 0) {
    lignes.push('_Aucune._');
  } else {
    if (rapport.dependancesInutilisees.length > 0) {
      lignes.push('`dependencies` :');
      lignes.push('');
      for (const d of rapport.dependancesInutilisees) lignes.push(`- \`${d.name}\``);
      lignes.push('');
    }
    if (rapport.devDependancesInutilisees.length > 0) {
      lignes.push('`devDependencies` :');
      lignes.push('');
      for (const d of rapport.devDependancesInutilisees) lignes.push(`- \`${d.name}\``);
    }
  }
  lignes.push('');

  lignes.push('## Doublons d’export (même valeur exportée sous deux noms)');
  lignes.push('');
  lignes.push('Informationnel — pas comptabilisé dans « exports morts » : un alias assumé n’est pas mort.');
  lignes.push('');
  if (rapport.doublons.length === 0) {
    lignes.push('_Aucun._');
  } else {
    for (const d of rapport.doublons) lignes.push(`- \`${d.file}\` : ${d.noms}`);
  }
  lignes.push('');

  return lignes.join('\n');
}

/**
 * `lancerKnip` et `construireRapport` sont EXPORTES pour que
 * `tests/unit/docs/catalogue-code.test.ts` mesure la realite au lieu de relire
 * le nombre que le fichier commite annonce sur lui-meme.
 *
 * C'est le trou que ce meme fichier raconte : le catalogue est reste a 188 du
 * 12/09 au 15/09 pendant que la mesure etait a 208, sur sept taches, parce que
 * le cliquet ne lisait qu'un nombre ecrit dans un document. Exporter plutot que
 * recopier la regle de comptage dans le test : une seule definition de « ce
 * qu'est un export mort », pas deux qui divergeraient.
 */
export { lancerKnip, construireRapport };

/** Vrai quand ce fichier est lance directement (`npm run catalogue`), faux a l'import. */
const lanceDirectement = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (lanceDirectement) {
  let data;
  try {
    data = lancerKnip();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const rapport = construireRapport(data);
  const sha = shaCourant();
  const date = new Date().toISOString().slice(0, 10);
  const markdown = formaterMarkdown(rapport, sha, date);

  writeFileSync(OUT_FILE, markdown, 'utf8');

  console.log(`[catalogue] docs/CATALOGUE_CODE.md régénéré.`);
  console.log(
    `[catalogue] exports morts : ${rapport.totalExportsMorts} · fichiers morts : ${rapport.totalFichiersMorts} · dépendances inutilisées : ${rapport.totalDependancesInutilisees}`,
  );
}
