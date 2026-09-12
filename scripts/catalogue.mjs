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
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    const stdout = err.stdout?.toString();
    if (!stdout) {
      console.error('[catalogue] knip n’a produit aucune sortie exploitable.');
      console.error(err.stderr?.toString() ?? err.message);
      process.exit(1);
    }
    try {
      return JSON.parse(stdout);
    } catch (parseErr) {
      console.error('[catalogue] sortie knip illisible en JSON :', parseErr.message);
      console.error(stdout.slice(0, 2000));
      process.exit(1);
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

const data = lancerKnip();
const rapport = construireRapport(data);
const sha = shaCourant();
const date = new Date().toISOString().slice(0, 10);
const markdown = formaterMarkdown(rapport, sha, date);

writeFileSync(OUT_FILE, markdown, 'utf8');

console.log(`[catalogue] docs/CATALOGUE_CODE.md régénéré.`);
console.log(
  `[catalogue] exports morts : ${rapport.totalExportsMorts} · fichiers morts : ${rapport.totalFichiersMorts} · dépendances inutilisées : ${rapport.totalDependancesInutilisees}`,
);
