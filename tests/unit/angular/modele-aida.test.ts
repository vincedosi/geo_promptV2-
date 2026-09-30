/**
 * Modèle AIDA des services d'API (doc AIDA §4.2-4.3) : tout `*.api.ts` de
 * l'application Angular HÉRITE de `HttpBaseService` et appelle
 * `this.httpClient` / `this.baseUrl`. Il n'injecte ni `HttpClient` ni
 * `HttpBaseService` : ce serait revenir au modèle « service + base injectée »
 * que le siège n'attend pas d'une remote app.
 *
 * FOURNITURE (revue finale du lot AIDA, I2) : tout `*.api.ts` est
 * `@Injectable()` SANS `providedIn`, et fourni par une route sous
 * `remoteRoutes` (`FOURNISSEURS_DISTANTS`, app.routes.ts). Un service
 * `providedIn: 'root'` serait construit dans l'injecteur RACINE — celui du
 * shell AIDA — et recevrait son `HttpClient` : sans aucun de nos intercepteurs
 * (jeton, limiteur à 3 appels, session expirée). Rien ne le signalerait :
 * les appels partiraient simplement sans `Authorization`.
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

/**
 * Vrai si le code déclare `@Injectable()` SANS argument — donc sans
 * `providedIn`, quelle qu'en soit la valeur (`'root'`, `'any'`, `'platform'`).
 * Tout `@Injectable(` suivi d'autre chose qu'une parenthèse fermante est fautif.
 */
function injectableSansProvidedIn(code: string): boolean {
  const decorateurs = [...code.matchAll(/@Injectable\s*\(([^)]*)\)/g)];
  return decorateurs.length > 0 && decorateurs.every((m) => m[1].trim() === '');
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

  it("chaque *.api.ts est `@Injectable()` SANS providedIn (sinon il reçoit le HttpClient de l'hôte, sans nos intercepteurs)", () => {
    const fautifs = fichiers.filter((f) => !injectableSansProvidedIn(code(f)));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });

  it('auto-test : le garde de fourniture reconnaît les cas fautifs', () => {
    expect(injectableSansProvidedIn(`@Injectable()
export class A extends HttpBaseService {}`)).toBe(true);
    expect(injectableSansProvidedIn(`@Injectable({ providedIn: 'root' })
export class A {}`)).toBe(false);
    expect(injectableSansProvidedIn(`@Injectable({
  providedIn: 'any',
})
export class A {}`)).toBe(false);
    expect(injectableSansProvidedIn(`@Injectable({})
export class A {}`)).toBe(false);
    // Pas de décorateur du tout : le service ne serait fourni nulle part — fautif aussi.
    expect(injectableSansProvidedIn('export class A extends HttpBaseService {}')).toBe(false);
    // Commentaires retirés avant : un `@Injectable()` en commentaire ne compte pas.
    expect(injectableSansProvidedIn(sansCommentaires(`// @Injectable()
@Injectable({ providedIn: 'root' })`))).toBe(false);
  });

  it("HttpBaseService n'apparaît que dans son import et la clause extends", () => {
    const fautifs = fichiers.filter((f) => {
      const usages = sansImports(code(f)).replace(/\bextends\s+HttpBaseService\b/g, '');
      return /\bHttpBaseService\b/.test(usages);
    });
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});
