/**
 * Le projet Angular et le code React/Next ne s'importent JAMAIS l'un l'autre
 * (décision D3 de docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md).
 *
 * Un seul import croisé suffit à faire dépendre l'application Angular du code
 * qu'elle doit remplacer — et le jour où l'écran React est supprimé, elle
 * casse. Ce test lit les SOURCES, pas le graphe de build : il échoue avant
 * que quiconque ait eu à lancer les deux compilations.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const ANGULAR_SRC = path.join(RACINE, 'angular', 'src');

function fichiers(dossier: string, extensions: string[]): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiers(complet, extensions));
    else if (extensions.some((e) => nom.endsWith(e))) sortie.push(complet);
  }
  return sortie;
}

const IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function imports(fichier: string): string[] {
  const texte = readFileSync(fichier, 'utf8');
  return [...texte.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
}

describe('isolement du projet Angular', () => {
  it('aucun fichier Angular n\'importe hors de angular/', () => {
    const fautifs: string[] = [];
    for (const f of fichiers(ANGULAR_SRC, ['.ts'])) {
      for (const cible of imports(f)) {
        if (cible.startsWith('@/')) fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
        if (cible.startsWith('.')) {
          const resolu = path.resolve(path.dirname(f), cible);
          if (!resolu.startsWith(path.join(RACINE, 'angular'))) {
            fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('aucun fichier React/Next n\'importe depuis angular/', () => {
    const fautifs: string[] = [];
    for (const dossier of ['app', 'components', 'lib']) {
      for (const f of fichiers(path.join(RACINE, dossier), ['.ts', '.tsx'])) {
        for (const cible of imports(f)) {
          if (/(^|\/)angular\//.test(cible) && !cible.startsWith('@angular/')) {
            fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('le test voit bien les sources Angular (garde contre un test vide)', () => {
    expect(fichiers(ANGULAR_SRC, ['.ts']).length).toBeGreaterThan(3);
  });
});
