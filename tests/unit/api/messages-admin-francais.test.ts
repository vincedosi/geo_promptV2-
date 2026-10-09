/**
 * Les messages d'erreur des routes d'administration des espaces s'affichent
 * TELS QUELS dans l'interface (l'écran Espaces de travail relaie `error`).
 * Ils sont donc en français, comme le reste de l'interface.
 *
 * Constaté le 2026-10-09 : « Organization not found or inactive »,
 * « Cannot delete yourself »… apparaissaient au milieu d'un écran français.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIERS = ['app/api/admin/users', 'app/api/admin/organizations', 'app/api/admin/espaces'];
const ANGLAIS = /\b(cannot|not found|already exists|insufficient|permissions|required|only super_admin|inactive|another org)\b/i;

function routes(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return routes(chemin);
    return nom === 'route.ts' ? [chemin] : [];
  });
}

describe('routes admin des espaces — messages d erreur en français', () => {
  for (const fichier of DOSSIERS.flatMap(routes)) {
    it(fichier, () => {
      const source = readFileSync(fichier, 'utf8');
      const litteraux = [...source.matchAll(/error:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      expect(litteraux.filter((l) => ANGLAIS.test(l))).toEqual([]);
    });
  }
});
