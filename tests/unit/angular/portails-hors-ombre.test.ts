/**
 * Rien de MAGELIAN ne s'affiche HORS de sa racine d'ombre.
 *
 * Pourquoi : depuis l'isolation CSS (tâche 8 du lot AIDA), toute l'interface
 * vit dans des racines d'ombre (`RacineDistanteComponent`, la page de
 * connexion autonome) qui ADOPTENT `magelian.css` ; la feuille n'est jamais
 * posée dans le document. Tout élément rendu hors d'une racine — un portail
 * vers `document.body`, un overlay du CDK, une infobulle `appendTo: 'body'` —
 * s'affiche donc SANS AUCUN STYLE : ni jetons, ni Tailwind, ni polices
 * appliquées. Et dans le shell AIDA, il se retrouve dans le document de
 * l'HÔTE, exposé à ses feuilles.
 *
 * Interdits dans `angular/src/app` (specs et harnais `testing/` exclus : ils
 * montent leurs propres éléments de test) :
 * - `document.body` (et `doc.body`, `ownerDocument.body`) ;
 * - `appendTo` / `appendToBody` (ECharts, bibliothèques d'infobulles) ;
 * - les entrées du CDK qui portent un portail (`overlay`, `portal`, `dialog`,
 *   `menu`) ;
 * - `document.querySelector('body')` / `getElementsByTagName('body')` ;
 * - `::ng-deep` et `ViewEncapsulation.None` : Angular (SharedStylesHost)
 *   recopie aussi les styles des composants dans le `<head>` du DOCUMENT ; ils
 *   n'y sont inoffensifs que parce qu'ils sont confinés par attribut
 *   (`_ngcontent-…`) — ces deux-là lèvent le confinement ;
 * - `position: fixed` (feuille, `.style.position`, `setProperty`,
 *   `[style.position]`) et la classe Tailwind `fixed` (attribut `class`,
 *   `host: { class }`, `[class.fixed]`). Aucun cas légitime
 *   aujourd'hui : un élément fixe resterait certes dans l'arbre, mais se
 *   positionne par rapport à la fenêtre de l'HÔTE — par-dessus son menu. Si un
 *   besoin apparaît, montrer qu'il reste dans la racine et l'autoriser ICI,
 *   nommément.
 * UNE exception, nommée dans `EXCEPTIONS` : `core/demarrage/erreur-demarrage.ts`
 * remplace le `<body>` quand Angular LUI-MÊME n'a pas pu démarrer. Il n'est
 * appelé que par `main.ts` / `bootstrap.ts`, les points d'entrée du lancement
 * AUTONOME — le shell AIDA ne les exécute jamais (il charge `./Routes`). Il n'y
 * a alors ni application ni racine d'ombre où écrire ; le document est le
 * nôtre.
 * Ce qui reste permis : `<dialog>` natif et l'API popover (couche supérieure,
 * mais toujours DANS l'arbre, donc stylés) ; les popups MapLibre et
 * l'infobulle ECharts par défaut, rendues dans leur conteneur (mesuré).
 *
 * Commentaires retirés avant l'analyse (TypeScript : imprimante sans
 * commentaires ; HTML : `<!-- -->` ; CSS : `/* *\/`) : une explication qui
 * cite un interdit ne compte pas.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const RACINE = path.resolve(__dirname, '../../..');
const APP = path.join(RACINE, 'angular', 'src', 'app');

const INTERDITS: Array<[string, RegExp]> = [
  ['document.body', /\b(?:document|doc|ownerDocument)\s*\??\.\s*body\b/],
  ['sélection de <body>', /\b(?:querySelector(?:All)?|getElementsByTagName)\s*\(\s*['"`]body['"`]/],
  ['appendTo / appendToBody', /\bappendTo(?:Body)?\b/],
  ['portail du CDK', /@angular\/cdk\/(?:overlay|portal|dialog|menu)\b/],
  [
    'position: fixed',
    /position\s*:\s*fixed\b|\.style\.position\s*=\s*['"`]fixed|setProperty\(\s*['"`]position['"`]\s*,\s*['"`]fixed|\[style\.position\]\s*=\s*"\s*'fixed'/,
  ],
  ['classe Tailwind `fixed`', /(?:\bclass(?:Name)?\s*[=:]\s*["'`][^"'`]*|\[class\.)(?<![\w:-])fixed(?![\w-])/],
  // Ces deux-là sortent un style de son composant : or SharedStylesHost recopie
  // AUSSI les styles des composants dans le <head> du document — un sélecteur
  // non confiné y atteindrait le shell.
  ['::ng-deep', /::ng-deep\b/],
  ['ViewEncapsulation.None', /\bViewEncapsulation\s*\.\s*None\b/],
];

/** Fichier (relatif à angular/src/app) → interdits qu'il peut porter, avec la raison dans l'en-tête ci-dessus. */
const EXCEPTIONS: Record<string, string[]> = {
  'core/demarrage/erreur-demarrage.ts': ['document.body'],
};

function fichiers(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) {
      if (nom !== 'testing') sortie.push(...fichiers(complet));
    } else if (/\.(ts|html|css)$/.test(nom) && !nom.endsWith('.spec.ts')) {
      sortie.push(complet);
    }
  }
  return sortie;
}

/** Le texte d'un fichier, commentaires retirés. */
function sansCommentaires(nom: string, texte: string): string {
  if (nom.endsWith('.ts')) {
    const source = ts.createSourceFile(nom, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return ts.createPrinter({ removeComments: true }).printFile(source);
  }
  if (nom.endsWith('.html')) return texte.replace(/<!--[\s\S]*?-->/g, '');
  return texte.replace(/\/\*[\s\S]*?\*\//g, '');
}

function infractions(nom: string, texte: string): string[] {
  const code = sansCommentaires(nom, texte);
  return INTERDITS.filter(([, motif]) => motif.test(code)).map(([libelle]) => libelle);
}

describe('garde : aucun rendu hors de la racine d\'ombre', () => {
  it('reconnaît chaque interdit, et ignore ceux qui ne sont que cités en commentaire', () => {
    expect(infractions('a.ts', 'const el = this.document.body;')).toEqual(['document.body']);
    expect(infractions('a.ts', 'doc?.body.appendChild(x);')).toEqual(['document.body']);
    expect(infractions('a.ts', "echarts.init(el, null, { tooltip: { appendTo: 'body' } });")).toEqual(['appendTo / appendToBody']);
    expect(infractions('a.ts', "import { Overlay } from '@angular/cdk/overlay';")).toEqual(['portail du CDK']);
    expect(infractions('a.css', '.x { position : fixed; }')).toEqual(['position: fixed']);
    expect(infractions('a.html', '<div class="inset-0 fixed z-50"></div>')).toEqual(['classe Tailwind `fixed`']);
    expect(infractions('a.ts', "racine.className = 'fixed top-0';")).toEqual(['classe Tailwind `fixed`']);
    expect(infractions('a.html', '<div [class.fixed]="ouvert()"></div>')).toEqual(['classe Tailwind `fixed`']);
    expect(infractions('a.ts', "el.style.position = 'fixed';")).toEqual(['position: fixed']);
    expect(infractions('a.ts', "el.style.setProperty('position', 'fixed');")).toEqual(['position: fixed']);
    expect(infractions('a.html', `<div [style.position]="'fixed'"></div>`)).toEqual(['position: fixed']);
    expect(infractions('a.ts', "@Component({ host: { class: 'block fixed inset-0' } }) class A {}")).toEqual(['classe Tailwind `fixed`']);
    expect(infractions('a.ts', "@Component({ host: { '[class.fixed]': 'ouvert()' } }) class A {}")).toEqual(['classe Tailwind `fixed`']);
    expect(infractions('a.ts', "doc.querySelector('body')!.append(x);")).toEqual(['sélection de <body>']);
    expect(infractions('a.ts', 'document.getElementsByTagName("body")[0];')).toEqual(['sélection de <body>']);
    expect(infractions('a.css', ':host ::ng-deep .x { color: red; }')).toEqual(['::ng-deep']);
    expect(infractions('a.ts', "styles: [':host ::ng-deep p { margin: 0 }']")).toEqual(['::ng-deep']);
    expect(infractions('a.ts', 'encapsulation: ViewEncapsulation.None,')).toEqual(['ViewEncapsulation.None']);
    // Cités en commentaire : ne comptent pas.
    expect(infractions('a.ts', '// document.body interdit\n/* appendTo: body */\nconst x = 1;')).toEqual([]);
    expect(infractions('a.html', '<!-- class="fixed" --><p></p>')).toEqual([]);
    expect(infractions('a.css', '/* position: fixed */ .a{}')).toEqual([]);
    // Voisins légitimes : ne comptent pas.
    expect(infractions('a.html', '<div class="table-fixed sm:fixed-thing"></div>')).toEqual([]);
    expect(infractions('a.ts', 'const reponse = await fetch(u); reponse.body;')).toEqual([]);
  });

  it('angular/src/app ne porte aucun rendu hors de la racine', () => {
    const liste = fichiers(APP);
    // Garde-fou contre un balayage vide : les trois sortes de fichiers sont vues.
    expect(liste.length).toBeGreaterThan(40);
    expect(liste.some((f) => f.endsWith('.html'))).toBe(true);
    expect(liste.some((f) => f.endsWith('.css'))).toBe(true);
    expect(liste.some((f) => f.endsWith(path.join('layout', 'racine-distante.component.ts')))).toBe(true);

    const trouvees = liste.flatMap((f) => {
      const relatif = path.relative(APP, f).split(path.sep).join('/');
      const permis = EXCEPTIONS[relatif] ?? [];
      return infractions(f, readFileSync(f, 'utf8')).filter((i) => !permis.includes(i)).map((i) => `${relatif} → ${i}`);
    });
    expect(trouvees).toEqual([]);
  });

  it("chaque exception existe encore et porte encore son interdit (pas d'exception morte)", () => {
    for (const [relatif, permis] of Object.entries(EXCEPTIONS)) {
      const f = path.join(APP, ...relatif.split('/'));
      expect(infractions(f, readFileSync(f, 'utf8'))).toEqual(permis);
    }
  });
});
