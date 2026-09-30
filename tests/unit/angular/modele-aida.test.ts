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

/**
 * Retire commentaires de bloc et de ligne AVANT toute recherche : un
 * `extends HttpBaseService` écrit seulement dans un commentaire passait sinon
 * le premier garde. Approximation volontaire (pas un vrai analyseur) : un `//`
 * dans une chaîne, comme `'https://…'`, coupe la fin de sa ligne — sans
 * conséquence ici, ces fichiers ne portent pas d'URL absolue.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Lignes d'import retirées : un nom importé n'est pas un usage. */
function sansImports(code: string): string {
  return code.replace(/^\s*import\s[\s\S]*?;\s*$/gm, '');
}

describe("modèle AIDA des services d'API", () => {
  const fichiers = servicesApi(APP);
  const code = (f: string) => sansCommentaires(readFileSync(f, 'utf8'));

  it("trouve des services d'API (le garde ne passe pas à vide)", () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it('chaque *.api.ts étend HttpBaseService (hors commentaires)', () => {
    const fautifs = fichiers.filter((f) => !/\bextends\s+HttpBaseService\b/.test(code(f)));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });

  it('aucun *.api.ts ne nomme HttpClient, sous quelque forme que ce soit', () => {
    // `inject(HttpClient)`, `inject<HttpClient>(…)`, un paramètre de
    // constructeur `private http: HttpClient`, un import : tous nomment le
    // symbole. Le service passe par `this.httpClient`, hérité — il n'a jamais
    // à écrire `HttpClient`.
    const fautifs = fichiers.filter((f) => /\bHttpClient\b/.test(code(f)));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });

  it("HttpBaseService n'apparaît que dans son import et la clause extends", () => {
    const fautifs = fichiers.filter((f) => {
      const usages = sansImports(code(f)).replace(/\bextends\s+HttpBaseService\b/g, '');
      return /\bHttpBaseService\b/.test(usages);
    });
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});
