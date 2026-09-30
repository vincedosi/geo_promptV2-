/**
 * Deux gardes de l'isolation CSS (revue finale du lot AIDA) :
 *
 * 1. **`inject: false` sur CHAQUE feuille globale d'`angular/angular.json`.**
 *    Une feuille émise sans lui est posée par Angular dans le `<head>` du
 *    DOCUMENT — celui du shell AIDA : Tailwind, jetons et `maplibre.css`
 *    restyleraient toute la page de l'hôte, exactement la fuite que l'isolation
 *    CSS (tâche 8) a fermée. Les feuilles sont chargées par `DemarrageService`
 *    (adoptée par les racines d'ombre, ou posée pour les polices) et par
 *    `mg-carte` (`maplibre.css`, dans la racine) — jamais par Angular.
 *
 * 2. **Aucun `rem` dans les styles de composant** (`styles`, `styleUrl`,
 *    `styleUrls`) sous `angular/src/app`. `rem` renvoie à la taille de police
 *    de `<html>`, qui appartient au shell. La feuille globale est convertie en
 *    px à la lecture (`remEnPx`, feuilles.ts) ; les styles de composant, eux,
 *    sont compilés dans le JavaScript et ne passent PAS par cette conversion.
 *
 * Écrit à la racine (Node + fs), comme `modele-aida.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const ANGULAR = path.join(RACINE, 'angular');
const APP = path.join(ANGULAR, 'src', 'app');

type EntreeStyle = string | { input: string; bundleName?: string; inject?: boolean };

/** Toutes les listes `styles` d'angular.json (options ET configurations de chaque cible). */
function listesStyles(config: unknown): { cible: string; styles: EntreeStyle[] }[] {
  const sortie: { cible: string; styles: EntreeStyle[] }[] = [];
  const projets = (config as { projects: Record<string, { architect: Record<string, { options?: { styles?: EntreeStyle[] }; configurations?: Record<string, { styles?: EntreeStyle[] }> }> }> }).projects;
  for (const [nomProjet, projet] of Object.entries(projets)) {
    for (const [nomCible, cible] of Object.entries(projet.architect)) {
      if (cible.options?.styles) sortie.push({ cible: `${nomProjet}:${nomCible}`, styles: cible.options.styles });
      for (const [nomConf, conf] of Object.entries(cible.configurations ?? {})) {
        if (conf.styles) sortie.push({ cible: `${nomProjet}:${nomCible}:${nomConf}`, styles: conf.styles });
      }
    }
  }
  return sortie;
}

/** Les entrées posées par Angular dans le document : chaîne nue (`inject` vaut vrai par défaut) ou `inject` différent de `false`. */
function entreesInjectees(styles: EntreeStyle[]): string[] {
  return styles
    .filter((e) => typeof e === 'string' || e.inject !== false)
    .map((e) => (typeof e === 'string' ? e : e.input));
}

function fichiersTs(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiersTs(complet));
    else if (nom.endsWith('.ts') && !nom.endsWith('.spec.ts')) sortie.push(complet);
  }
  return sortie;
}

const sansCommentairesCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Un `rem` de VALEUR (`1rem`, `.5rem`, `-2rem`) — pas un mot qui contient « rem ». */
const REM = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)rem\b/;

/** Le CSS des styles de composant d'un fichier : `styles` en ligne + feuilles de `styleUrl(s)`. */
function stylesDeComposant(fichier: string, source: string): { origine: string; css: string }[] {
  const sortie: { origine: string; css: string }[] = [];
  for (const m of source.matchAll(/\bstyles\s*:\s*(`[\s\S]*?`|\[[\s\S]*?\])/g)) {
    sortie.push({ origine: `${fichier} (styles)`, css: m[1] });
  }
  for (const m of source.matchAll(/\bstyleUrls?\s*:\s*(['"][^'"]+['"]|\[[^\]]*\])/g)) {
    for (const u of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
      const feuille = path.resolve(path.dirname(fichier), u[1]);
      sortie.push({ origine: feuille, css: existsSync(feuille) ? readFileSync(feuille, 'utf8') : '' });
    }
  }
  return sortie;
}

const contientRem = (css: string) => REM.test(sansCommentairesCss(css));

describe("angular.json : aucune feuille globale n'est posée par Angular dans le document", () => {
  const config = JSON.parse(readFileSync(path.join(ANGULAR, 'angular.json'), 'utf8'));
  const listes = listesStyles(config);

  it('trouve au moins une liste de styles (le garde ne passe pas à vide), dont la cible esbuild', () => {
    expect(listes.some((l) => l.cible === 'magelian:esbuild' && l.styles.length > 0)).toBe(true);
  });

  it.each(listes.map((l) => [l.cible, l.styles] as const))('%s : chaque entrée porte `inject: false`', (_cible, styles) => {
    expect(entreesInjectees(styles)).toEqual([]);
  });

  it('auto-test : reconnaît une chaîne nue, un `inject` absent ou vrai', () => {
    expect(entreesInjectees(['src/a.css', { input: 'src/b.css' }, { input: 'src/c.css', inject: true }, { input: 'src/d.css', inject: false }]))
      .toEqual(['src/a.css', 'src/b.css', 'src/c.css']);
  });
});

describe('styles de composant : aucun rem (la taille de police de <html> appartient au shell)', () => {
  const fichiers = fichiersTs(APP);
  const styles = fichiers.flatMap((f) => stylesDeComposant(f, readFileSync(f, 'utf8')));

  it('trouve des styles de composant (le garde ne passe pas à vide)', () => {
    expect(styles.length).toBeGreaterThan(0);
  });

  it("aucun `rem` dans un `styles` ou une feuille de `styleUrl(s)` sous angular/src/app", () => {
    const fautifs = styles.filter((s) => contientRem(s.css)).map((s) => path.relative(RACINE, s.origine.split(' (')[0]));
    expect(fautifs).toEqual([]);
  });

  it('auto-test : reconnaît un rem de valeur, ignore les noms et les commentaires', () => {
    const src = "@Component({ selector: 'x', styles: `:host { padding: 1rem }` })";
    expect(stylesDeComposant('x.ts', src).map((s) => contientRem(s.css))).toEqual([true]);
    expect(contientRem('.a { margin: .5rem }')).toBe(true);
    expect(contientRem('.a { margin: -2rem 0 }')).toBe(true);
    expect(contientRem('.a { gap: var(--gap-2rem) }')).toBe(false);
    expect(contientRem('.remise { color: red } /* 1rem */')).toBe(false);
    expect(stylesDeComposant('x.ts', "styles: [`.a{top:0}`, `.b{left:1rem}`]").some((s) => contientRem(s.css))).toBe(true);
  });
});
