import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * @file tests/unit/design/jetons-css.test.ts — VERROU DE FAMILLE.
 *
 * ── Le défaut, rencontré deux fois ─────────────────────────────────────────
 *
 * Un `var(--truc)` dont le jeton n'existe pas **échoue en silence**. Ce n'est
 * pas une erreur CSS : la déclaration entière est ignorée, l'élément retombe
 * sur sa valeur héritée (un fond devient transparent), la console ne dit rien,
 * TypeScript ne peut rien voir — la valeur est une chaîne — et aucun test ne
 * rougit.
 *
 * Le 2026-09-16, la relecture finale de `feat/suivi-v2` a trouvé **huit**
 * `background: var(--elevated)` et un `var(--overlay)` écrits de bonne foi
 * d'après `DESIGN_SYSTEM.md` §3, qui les documentait comme des jetons du
 * système. `app/globals.css` ne les a jamais portés. Neuf fonds transparents,
 * dans un thème sombre, sans le moindre signal.
 *
 * La correction ponctuelle (définir les deux jetons) ne protège de rien : le
 * prochain jeton documenté-mais-absent produira exactement le même écran.
 *
 * ── Ce que ce fichier verrouille, dans les DEUX sens ───────────────────────
 *
 *  1. code → CSS : tout `var(--x)` employé sans valeur de repli est défini ;
 *  2. CSS clair → CSS sombre : aucun jeton n'existe dans le seul thème clair ;
 *  3. CSS sombre → CSS clair : toute COULEUR littérale de `:root` est
 *     redéfinie sous `html.light` (sinon un aplat sombre survit en thème
 *     clair, illisible mais parfaitement valide, donc muet) ;
 *  4. DESIGN_SYSTEM.md → CSS : tout jeton que le document présente comme
 *     existant existe — **c'est ce sens-là qui a menti** — et porte bien une
 *     COULEUR, pas un triplet HSL shadcn (`0 0% 4%`), qui est le second piège
 *     du même fichier (`background: var(--card)` ne produit rien non plus).
 */

const RACINE = process.cwd();
const CSS = readFileSync(join(RACINE, 'app', 'globals.css'), 'utf8');

/** Retire les commentaires de bloc — `var(--token)` cité en prose dans une JSDoc n'est pas un usage. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Corps `{ … }` équilibré qui suit la n-ième occurrence d'un sélecteur. */
function blocsDuSelecteur(selecteur: string): string[] {
  const blocs: string[] = [];
  let k = -1;
  while ((k = CSS.indexOf(selecteur, k + 1)) >= 0) {
    // Éviter les faux positifs de préfixe (`html.light-x`) et les mentions en commentaire.
    const suivant = CSS[k + selecteur.length];
    if (suivant && !/[\s{,]/.test(suivant)) continue;
    const ouvrante = CSS.indexOf('{', k);
    if (ouvrante < 0) break;
    let profondeur = 0;
    let i = ouvrante;
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') profondeur++;
      else if (CSS[i] === '}') { profondeur--; if (profondeur === 0) break; }
    }
    blocs.push(CSS.slice(ouvrante, i));
  }
  return blocs;
}

/** `{ jeton → valeur déclarée }` d'un ensemble de blocs. */
function declarations(blocs: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const bloc of blocs) {
    for (const d of sansCommentaires(bloc).matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      m.set(d[1], d[2].trim());
    }
  }
  return m;
}

const ROOT = declarations(blocsDuSelecteur(':root'));
const LIGHT = declarations(blocsDuSelecteur('html.light'));

/** Résout un alias `var(--x)` jusqu'à une valeur littérale (profondeur bornée). */
function resoudre(valeur: string, table: Map<string, string>, profondeur = 0): string {
  const alias = valeur.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
  if (!alias || profondeur > 4) return valeur;
  const cible = table.get(alias[1]);
  return cible === undefined ? valeur : resoudre(cible, table, profondeur + 1);
}

const estCouleur = (v: string) => /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(v);
/** Triplet HSL nu de shadcn — `0 0% 4%`. Valide pour `hsl(var(--x))`, inerte pour `var(--x)` seul. */
const estTripletHsl = (v: string) => /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(v);

function fichiers(dossier: string, extensions: string[]): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    if (entree === 'node_modules' || entree === '.next') continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin, extensions));
    else if (extensions.some((x) => entree.endsWith(x))) trouves.push(chemin);
  }
  return trouves;
}

/**
 * Familles de jetons dont le NOM est construit dynamiquement
 * (`` `var(--atmo-level-${level})` ``). Le balayage ne peut pas les résoudre ;
 * chaque membre possible est donc énuméré ici et vérifié un par un — ce qui
 * est plus fort que le cas statique, pas moins : c'est la seule façon de voir
 * qu'un niveau sur sept manque.
 */
const FAMILLES_DYNAMIQUES: Array<[string, string[]]> = [
  ['lib/civic-health/levels.ts — atmoLevelToken', [
    '--atmo-level-1', '--atmo-level-2', '--atmo-level-3',
    '--atmo-level-4', '--atmo-level-5', '--atmo-level-6', '--atmo-level-na',
  ]],
  ['lib/civic-health/levels.ts — pollenLevelToken', [
    '--pollen-level-0', '--pollen-level-1', '--pollen-level-2', '--pollen-level-3',
    '--pollen-level-4', '--pollen-level-5', '--pollen-level-6',
  ]],
];

describe('jetons CSS — code, globals.css et DESIGN_SYSTEM.md disent la même chose', () => {
  it('globals.css a bien été lu (garde-fou du test lui-même)', () => {
    // Sans cette garde, un changement de structure du fichier viderait les
    // deux tables et TOUS les contrôles ci-dessous passeraient à vide.
    expect(ROOT.size, ':root n\'a produit aucune déclaration — le découpage du fichier a-t-il changé ?').toBeGreaterThan(80);
    expect(LIGHT.size, 'html.light n\'a produit aucune déclaration').toBeGreaterThan(60);
  });

  it('tout var(--x) employé sans valeur de repli est défini dans :root', () => {
    const usages = new Map<string, Set<string>>();
    const racines: Array<[string, string[]]> = [
      ['app', ['.ts', '.tsx', '.css']],
      ['components', ['.ts', '.tsx', '.css']],
      ['lib', ['.ts', '.tsx']],
    ];
    for (const [dossier, exts] of racines) {
      for (const chemin of fichiers(join(RACINE, dossier), exts)) {
        const relatif = chemin.slice(RACINE.length + 1).split(sep).join('/');
        if (relatif === 'app/globals.css') continue; // c'est lui qui les définit
        const source = sansCommentaires(readFileSync(chemin, 'utf8'));
        // `var(--x)` ou `var(--x,` — on ne retient que la forme SANS repli :
        // avec un repli, un jeton absent ne casse rien, c'est justement à quoi
        // sert le repli (`var(--backdrop-blur, 4px)`).
        for (const m of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
          if (m[2] !== ')') continue;
          if (!usages.has(m[1])) usages.set(m[1], new Set());
          usages.get(m[1])!.add(relatif);
        }
      }
    }

    expect(usages.size, 'aucun var(--x) trouvé dans le code — le balayage a-t-il divergé ?').toBeGreaterThan(30);

    const orphelins = [...usages.keys()]
      .filter((t) => !ROOT.has(t))
      // Noms tronqués par une interpolation `${…}` : couverts par le cas suivant.
      .filter((t) => !FAMILLES_DYNAMIQUES.some(([, membres]) => membres.some((m) => m.startsWith(t))))
      .sort();

    expect(
      orphelins,
      'Jetons CSS employés par le code mais ABSENTS de app/globals.css :\n'
      + orphelins.map((t) => `  ${t} — ${[...usages.get(t)!].slice(0, 5).join(', ')}`).join('\n')
      + '\nUn var() inconnu ne lève pas : la déclaration est ignorée en silence. '
      + 'Définir le jeton dans :root ET html.light, ou donner une valeur de repli explicite.',
    ).toEqual([]);
  });

  it.each(FAMILLES_DYNAMIQUES)('famille de jetons construite dynamiquement : %s', (_ou, membres) => {
    const absents = membres.filter((t) => !ROOT.has(t));
    expect(absents, `membres absents de :root : ${absents.join(', ')}`).toEqual([]);
  });

  it('aucun jeton n existe dans le seul thème clair', () => {
    const clairSeul = [...LIGHT.keys()].filter((t) => !ROOT.has(t)).sort();
    expect(
      clairSeul,
      `Jetons définis sous html.light mais absents de :root : ${clairSeul.join(', ')}. `
      + ':root porte le thème SOMBRE, qui est le défaut — ces jetons seraient donc inertes '
      + 'partout sauf en thème clair.',
    ).toEqual([]);
  });

  it('toute couleur littérale de :root est redéfinie en thème clair', () => {
    // Les alias (`var(--bg-level-1)`), les durées, les courbes d'easing et les
    // longueurs n'ont pas à basculer : seules les COULEURS écrites en dur.
    const INVARIANTS = new Set([
      // L'accent de marque et son texte ne basculent pas — c'est une identité,
      // pas une surface (cf. DESIGN_SYSTEM.md §3, « Accent de marque »).
      '--brand-teal', '--brand-teal-hover', '--brand-teal-10', '--brand-teal-30',
      '--brand-teal-50', '--brand-teal-fg',
      // Gris neutre de « donnée absente » : il doit rester HORS de toute
      // échelle, dans les deux thèmes.
      '--donnee-absente',
    ]);
    const sansEquivalent = [...ROOT.entries()]
      .filter(([t, v]) => estCouleur(v) && !INVARIANTS.has(t) && !LIGHT.has(t))
      .map(([t]) => t)
      .sort();

    expect(
      sansEquivalent,
      `Couleurs de :root sans équivalent sous html.light : ${sansEquivalent.join(', ')}. `
      + 'En thème clair elles resteront à leur valeur sombre — parfaitement valide, donc muet, '
      + "et illisible à l'écran. Soit définir la valeur claire, soit ajouter le jeton à INVARIANTS "
      + 'avec la raison.',
    ).toEqual([]);
  });

  // ── Le sens qui a menti ──────────────────────────────────────────────────

  const DS = readFileSync(join(RACINE, 'DESIGN_SYSTEM.md'), 'utf8');
  /**
   * Lignes de tableau `| --token | valeur | …`. Le nom peut être suivi d'alias
   * entre parenthèses (`--bg-level-1 (alias **--surface**, --bg-surface)`) :
   * tous les jetons nommés dans la cellule comptent.
   */
  const jetonsDocumentes = (() => {
    const trouves = new Map<string, string>(); // jeton → valeur annoncée (colonne 2)
    for (const ligne of DS.split('\n')) {
      const m = ligne.match(/^\|\s*(--[^|]+?)\s*\|\s*([^|]+?)\s*\|/);
      if (!m) continue;
      const valeur = m[2].replace(/\*\*/g, '').trim();
      // Une LETTRE est exigée après `--` : sinon la ligne de séparation d'un
      // tableau markdown (`|-------|-----|`) passerait pour trois jetons.
      for (const nom of m[1].matchAll(/--[a-zA-Z][a-zA-Z0-9-]*/g)) {
        trouves.set(nom[0], valeur);
      }
    }
    return trouves;
  })();

  it('DESIGN_SYSTEM.md documente au moins les quarante jetons du système', () => {
    expect(
      jetonsDocumentes.size,
      'moins de 40 jetons extraits des tableaux de DESIGN_SYSTEM.md — le format des tableaux a-t-il changé ?',
    ).toBeGreaterThanOrEqual(40);
  });

  it('tout jeton documenté par DESIGN_SYSTEM.md existe réellement dans globals.css', () => {
    const fantomes = [...jetonsDocumentes.keys()].filter((t) => !ROOT.has(t)).sort();
    expect(
      fantomes,
      `DESIGN_SYSTEM.md présente ces jetons comme existants, app/globals.css ne les définit pas : `
      + `${fantomes.join(', ')}. C'est le défaut du 2026-09-16 : neuf background: var(--elevated) `
      + 'rendus transparents, sans erreur, parce que le document faisait autorité et le CSS non.',
    ).toEqual([]);
  });

  it('un jeton documenté avec une couleur porte une COULEUR, jamais un triplet HSL shadcn', () => {
    const inertes: string[] = [];
    for (const [jeton, annoncee] of jetonsDocumentes) {
      if (!estCouleur(annoncee)) continue;         // « alias », prose, etc.
      const reelle = resoudre(ROOT.get(jeton) ?? '', ROOT);
      if (estTripletHsl(reelle)) inertes.push(`${jeton} (CSS: "${reelle}")`);
    }
    expect(
      inertes,
      `DESIGN_SYSTEM.md annonce une couleur pour ces jetons, mais globals.css y met un triplet HSL `
      + `shadcn : ${inertes.join(', ')}. « background: var(--x) » est alors INERTE — il faut `
      + '« hsl(var(--x)) ». Documenter le jeton MAGELIAN équivalent à la place.',
    ).toEqual([]);
  });

  it('les valeurs hex annoncées par DESIGN_SYSTEM.md sont celles de globals.css', () => {
    const divergences: string[] = [];
    for (const [jeton, annoncee] of jetonsDocumentes) {
      if (!/^#[0-9a-fA-F]{3,8}$/.test(annoncee)) continue;
      const reelle = resoudre(ROOT.get(jeton) ?? '', ROOT);
      if (!/^#[0-9a-fA-F]{3,8}$/.test(reelle)) continue; // alias non résolu / rgba : hors de ce contrôle
      if (reelle.toLowerCase() !== annoncee.toLowerCase()) {
        divergences.push(`${jeton} : doc "${annoncee}", CSS "${reelle}"`);
      }
    }
    expect(
      divergences,
      `DESIGN_SYSTEM.md a dérivé de app/globals.css : ${divergences.join(' ; ')}. `
      + 'Le CSS fait foi — un composant qui retape la valeur du document en dur serait décalé '
      + "du reste de l'interface tout en se croyant conforme (c'est arrivé sur --text-secondary "
      + 'et --text-tertiary, éclaircis pour le contraste sans que le document suive).',
    ).toEqual([]);
  });
});
