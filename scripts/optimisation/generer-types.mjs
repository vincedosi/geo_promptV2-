#!/usr/bin/env node
/**
 * Génère `lib/optimisation/types-openapi.ts` depuis `services/optimisation/openapi.json` (tâche 1.6).
 *
 * Le service ne sert pas `/openapi.json` (relecture A, M1) : le schéma est exporté par le test pytest
 * `services/optimisation/tests/api/test_openapi.py` (`OPTIMISATION_ECRIRE_OPENAPI=1`). Ce script en tire les types TS
 * par `openapi-typescript`, version ÉPINGLÉE, installée dans un dossier temporaire (outil de génération seulement : aucune dépendance du
 * projet, rien n'est importé à l'exécution), et écrit en tête l'empreinte sha256 du schéma source.
 * `tests/unit/optimisation/types-openapi.test.ts` recalcule cette empreinte : un schéma changé sans régénération échoue.
 *
 * Usage : node scripts/optimisation/generer-types.mjs
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const VERSION = '7.13.0';
const racine = resolve(import.meta.dirname, '..', '..');
const source = join(racine, 'services', 'optimisation', 'openapi.json');
const cible = join(racine, 'lib', 'optimisation', 'types-openapi.ts');

const schema = readFileSync(source);
const empreinte = createHash('sha256').update(schema).digest('hex');

const dossier = mkdtempSync(join(tmpdir(), 'types-openapi-'));
try {
  const sortie = join(dossier, 'types.ts');
  // Installés dans un dossier JETABLE (rien dans package.json ni node_modules du projet) : `typescript` est un pair
  // d'openapi-typescript, pris à la version du projet. `npx -p` ne le résolvait pas depuis son cache (04/11).
  const ts = JSON.parse(readFileSync(join(racine, 'node_modules', 'typescript', 'package.json'), 'utf-8')).version;
  execFileSync('npm', ['install', '--prefix', dossier, '--no-save', '--no-audit', '--no-fund', '--loglevel=error',
    `openapi-typescript@${VERSION}`, `typescript@${ts}`], { stdio: 'inherit', shell: process.platform === 'win32' });
  const cli = join(dossier, 'node_modules', 'openapi-typescript', 'bin', 'cli.js');
  execFileSync(process.execPath, [cli, source, '-o', sortie], { stdio: 'inherit' });
  const genere = readFileSync(sortie, 'utf-8').replace(/\r\n/g, '\n');
  const entete = [
    '/**',
    ' * GÉNÉRÉ — ne pas modifier à la main. Source : services/optimisation/openapi.json',
    ` * (exporté par services/optimisation/tests/api/test_openapi.py), openapi-typescript ${VERSION}.`,
    ' * Régénérer : node scripts/optimisation/generer-types.mjs',
    ` * openapi-sha256: ${empreinte}`,
    ' */',
    '/* eslint-disable */',
    '',
  ].join('\n');
  mkdirSync(dirname(cible), { recursive: true });
  writeFileSync(cible, entete + genere, 'utf-8');
  console.log(`types écrits : ${cible} (openapi.json sha256 ${empreinte.slice(0, 12)}…)`);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}
