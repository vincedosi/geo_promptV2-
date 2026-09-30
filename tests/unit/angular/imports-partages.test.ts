/**
 * Le remote n'importe À L'EXÉCUTION que des entrées d'Angular que TOUT hôte
 * navigateur partage.
 *
 * Pourquoi : un hôte Native Federation généré par défaut (`ignoreUnusedDeps:
 * true`) ne partage que les paquets qu'IL utilise. Une entrée secondaire dont
 * il ne se sert pas (constaté le 2026-09-30 avec `@angular/core/rxjs-interop`)
 * est alors chargée depuis le REMOTE, avec sa propre copie des morceaux privés
 * de `@angular/core` : `rxjs-interop.mjs` les importe par un chemin RELATIF
 * (`./_effect-chunk2.mjs`), donc son `inject()` n'est pas celui de l'hôte.
 * Résultat : `NG0203` dès `inject(DestroyRef)` — en production aussi, cet
 * appel n'étant pas réservé au mode développement.
 *
 * Les entrées autorisées ci-dessous sont partagées par tout hôte navigateur
 * (vérifié dans `node_modules` à la tâche 6 du lot AIDA) : `@angular/core`,
 * `@angular/common` et `@angular/platform-browser` par construction,
 * `@angular/common/http` parce que `platform-browser` l'importe,
 * `@angular/router` et `@angular/forms` parce qu'ils n'importent que
 * `@angular/core` NU (aucun morceau privé). `@angular/forms` reste limité à
 * `features/connexion/`, page qui n'existe qu'en lancement autonome : un hôte
 * par défaut ne le partage pas s'il ne s'en sert pas.
 *
 * Analyse par l'AST TypeScript et non par expression régulière : les
 * commentaires n'y existent pas (un import commenté ne compte pas), `import
 * type` / `export type` sont reconnus sans heuristique, et les `import('…')`
 * dynamiques sont vus comme les autres.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const RACINE = path.resolve(__dirname, '../../..');
const ANGULAR_SRC = path.join(RACINE, 'angular', 'src');

const PARTAGEES = new Set([
  '@angular/core',
  '@angular/common',
  '@angular/common/http',
  '@angular/router',
  '@angular/platform-browser',
]);

/** Entrées permises dans un dossier seulement (chemin relatif à angular/src, séparateurs `/`). */
const PERMISES_PAR_DOSSIER: Record<string, string> = {
  '@angular/forms': 'app/features/connexion/',
};

function sources(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...sources(complet));
    else if (nom.endsWith('.ts') && !nom.endsWith('.spec.ts') && !nom.endsWith('.d.ts')) sortie.push(complet);
  }
  return sortie;
}

/** Modules importés À L'EXÉCUTION par un source : statiques, réexports et `import()` dynamiques. */
function importsExecution(nomFichier: string, texte: string): string[] {
  const source = ts.createSourceFile(nomFichier, texte, ts.ScriptTarget.Latest, true);
  const modules: string[] = [];
  const visiter = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.importClause?.isTypeOnly) modules.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) modules.push(n.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      modules.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(source);
  return modules;
}

function autorise(module: string, relatif: string): boolean {
  if (PARTAGEES.has(module)) return true;
  const dossier = PERMISES_PAR_DOSSIER[module];
  return dossier !== undefined && relatif.startsWith(dossier);
}

describe("imports d'Angular partagés par tout hôte", () => {
  const fichiers = sources(ANGULAR_SRC);

  it('trouve les sources Angular (le garde ne passe pas à vide)', () => {
    expect(fichiers.length).toBeGreaterThan(20);
    const vus = fichiers.flatMap((f) => importsExecution(f, readFileSync(f, 'utf8')));
    expect(vus).toContain('@angular/core');
  });

  it("l'analyse ignore commentaires et `import type`, et voit les `import()` dynamiques", () => {
    const texte = [
      "// import { toSignal } from '@angular/core/rxjs-interop';",
      "/* import { x } from '@angular/animations'; */",
      "import type { Signal } from '@angular/core/rxjs-interop';",
      "export type { Routes } from '@angular/forms';",
      "import { inject } from '@angular/core';",
      "const m = () => import('@angular/cdk/overlay');",
      "export { a } from '@angular/common';",
    ].join('\n');
    expect(importsExecution('essai.ts', texte)).toEqual(['@angular/core', '@angular/cdk/overlay', '@angular/common']);
  });

  it("aucun source n'importe à l'exécution une entrée d'Angular que l'hôte pourrait ne pas partager", () => {
    const fautifs: string[] = [];
    for (const f of fichiers) {
      const relatif = path.relative(ANGULAR_SRC, f).split(path.sep).join('/');
      for (const m of importsExecution(f, readFileSync(f, 'utf8'))) {
        if (m.startsWith('@angular/') && !autorise(m, relatif)) fautifs.push(`${relatif} → ${m}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
