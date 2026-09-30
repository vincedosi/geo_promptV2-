/**
 * Modèle AIDA des services d'API (doc AIDA §4.2-4.3) : tout `*.api.ts` de
 * l'application Angular HÉRITE de `HttpBaseService` et appelle
 * `this.httpClient` / `this.baseUrl`. Il n'injecte ni `HttpClient` ni
 * `HttpBaseService` : ce serait revenir au modèle « service + base injectée »
 * que le siège n'attend pas d'une remote app.
 *
 * Écrit à la racine (Node + fs, comme `isolement.test.ts`) : `import.meta.glob`
 * est une primitive de Vite, absente du constructeur de tests de l'Angular CLI
 * (esbuild) — un test qui l'utiliserait n'y verrait aucun fichier et passerait
 * à vide. Le garde « au moins un service trouvé » ferme aussi ce cas ici.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const APP = path.join(RACINE, 'angular', 'src', 'app');

function servicesApi(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...servicesApi(complet));
    else if (nom.endsWith('.api.ts')) sortie.push(complet);
  }
  return sortie;
}

describe('modèle AIDA des services d\'API', () => {
  const fichiers = servicesApi(APP);

  it('trouve des services d\'API (le garde ne passe pas à vide)', () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it('chaque *.api.ts étend HttpBaseService', () => {
    const fautifs = fichiers.filter((f) => !/extends HttpBaseService\b/.test(readFileSync(f, 'utf8')));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });

  it('aucun *.api.ts n\'injecte HttpClient ni HttpBaseService', () => {
    const fautifs = fichiers.filter((f) =>
      /inject\(\s*(HttpClient|HttpBaseService)\s*\)/.test(readFileSync(f, 'utf8')));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});
