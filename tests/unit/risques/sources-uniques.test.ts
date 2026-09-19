import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous sur les SOURCES UNIQUES du périmètre « zone à risque ».
 *
 * Chaque règle gardée ici avait été recopiée entre deux et six fois, et
 * plusieurs de ces copies avaient déjà DIVERGÉ — ce qui est le moment où une
 * duplication cesse d'être un désagrément pour devenir un bug (constats R-08,
 * R-17, R-18, R-19 et R-24 de `docs/AUDIT_ZONE_RISQUE.md`).
 *
 * Ces tests ne vérifient pas que le code est joli. Ils vérifient qu'il n'existe
 * qu'UN endroit où chaque règle est écrite, donc qu'une correction future
 * s'appliquera partout.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf-8');

/** Les fichiers du périmètre, front et routes. */
const PERIMETRE = [
  'components/risques/AnalysePopulationOverlay.tsx',
  'components/risques/OngletRayonInfluence.tsx',
  'components/risques/CarteMiniFrance.tsx',
  'components/risques/Kpi.tsx',
  'app/api/risques/exposition/agregats/route.ts',
  'app/api/risques/exposition/export/route.ts',
  'app/api/risques/exposition/rayon/route.ts',
  'app/api/risques/[siteId]/exposition/route.ts',
  'app/api/map/risques-industriels/route.ts',
  'app/api/map/pprt/route.ts',
];

describe('validateurs de paramètres — une seule définition', () => {
  it('aucune route ne redéfinit `liste` ni `bboxValide`', () => {
    // Elles étaient copiées dans cinq routes. Un durcissement — refuser une
    // bbox hors de France, plafonner le nombre de codes — ne se serait
    // appliqué qu'à la copie qu'on aurait pensé à modifier.
    for (const f of PERIMETRE.filter((p) => p.startsWith('app/api/'))) {
      const s = lire(f);
      expect(s, `${f} redéfinit liste()`).not.toMatch(/^function liste\(/m);
      expect(s, `${f} redéfinit bboxValide()`).not.toMatch(/^function bboxValide\(/m);
    }
  });

  it('les routes qui en ont besoin importent le module partagé', () => {
    for (const f of [
      'app/api/risques/exposition/agregats/route.ts',
      'app/api/risques/exposition/export/route.ts',
      'app/api/risques/exposition/rayon/route.ts',
      'app/api/map/risques-industriels/route.ts',
      'app/api/map/pprt/route.ts',
    ]) {
      expect(lire(f), `${f}`).toMatch(/from '@\/lib\/api\/parametres-requete'/);
    }
  });
});

describe('mise en forme des nombres — `lib/format/nombre.ts` fait foi', () => {
  it('plus aucun `toFixed(n).replace` dans le périmètre', () => {
    // `CLAUDE.md` désigne ce module comme source unique : « il y en avait
    // quinze avant le 2026-09-11 ». Six s'étaient reformées ici, dont une
    // côté serveur.
    for (const f of PERIMETRE) {
      expect(lire(f), `${f} reforme un formateur local`).not.toMatch(/toFixed\(\d\)\.replace/);
    }
  });

  it('le formateur décimal partagé existe et est en français', () => {
    const s = lire('lib/format/nombre.ts');
    expect(s).toMatch(/export function formaterDecimal\(/);
    // `toLocaleString` et non un `replace` : il gère aussi le séparateur de
    // milliers, qu'un remplacement du point décimal laissait en anglais.
    expect(s).toMatch(/toLocaleString\('fr-FR'/);
  });
});

describe('polices — une seule définition dans tout le dépôt', () => {
  it('`lib/design/polices.ts` porte le repli `Fira Mono` du design system', () => {
    const s = lire('lib/design/polices.ts');
    expect(s).toMatch(/export const fInter/);
    expect(s).toMatch(/Fira Mono/);
  });

  it('aucun fichier du périmètre ne redéclare fInter ou fMono', () => {
    // Les trois fichiers de `components/risques/` écrivaient
    // `"'JetBrains Mono', monospace"` — sans le repli `Fira Mono`. Le design
    // system sautait sur tout l'écran d'analyse, sans rien casser ni signaler.
    for (const f of PERIMETRE) {
      const s = lire(f);
      expect(s, `${f} redéclare fInter`).not.toMatch(/^const fInter\s*=/m);
      expect(s, `${f} redéclare fMono`).not.toMatch(/^const fMono\s*=/m);
    }
  });

  it('`tokens.ts` ré-exporte au lieu de redéfinir', () => {
    const s = lire('app/map/_components/filter-panel/tokens.ts');
    expect(s).toMatch(/export \{ fInter, fMono \} from '@\/lib\/design\/polices'/);
  });
});

describe('composant Kpi — un seul, pour les deux écrans', () => {
  it('ni l’overlay ni l’onglet ne redéfinissent Kpi', () => {
    for (const f of [
      'components/risques/AnalysePopulationOverlay.tsx',
      'components/risques/OngletRayonInfluence.tsx',
    ]) {
      const s = lire(f);
      expect(s, `${f} redéfinit Kpi`).not.toMatch(/^function Kpi\(/m);
      expect(s, `${f} n'importe pas le Kpi partagé`).toMatch(/from '@\/components\/risques\/Kpi'/);
    }
  });

  it('la note de lecture est OBLIGATOIRE', () => {
    // Tous les chiffres de cet écran demandent une précaution : la colonne
    // « sites » ne s'additionne pas, une zone peut venir d'un arrêté ou d'un
    // rayon choisi, l'outre-mer n'est pas calculable partout.
    const s = lire('components/risques/Kpi.tsx');
    expect(s).toMatch(/\n {2}note: string;/);
    expect(s).not.toMatch(/note\?: string/);
  });
});

describe('ce qui est demandé — une seule fabrique', () => {
  const s = lire('components/risques/AnalysePopulationOverlay.tsx');

  it('l’écran et l’export construisent leurs paramètres au même endroit', () => {
    // Douze lignes identiques des deux côtés. C'est la définition de « ce qui
    // est demandé » : un filtre ajouté d'un seul côté ferait diverger le
    // tableur de l'écran, ce que l'en-tête de `export/route.ts` déclare
    // vouloir empêcher.
    expect(s).toMatch(/const parametresDemande = useCallback\(/);
    expect(s.match(/new URLSearchParams\(\{ dimension, cible \}\)/g)?.length ?? 0).toBe(1);
    expect(s.match(/parametresDemande\(\)/g)?.length ?? 0).toBe(2);
  });

  it('les déclarations précèdent leurs consommateurs', () => {
    // R-26 : `exporter` capturait `natures` et `libelleCible` declarés plus
    // bas. Correct à l'exécution — l'export n'est appelé qu'après le rendu —
    // mais `useCallback` évalue ses dépendances AU rendu, et `tsc` l'a
    // signalé dès que la fabrique est devenue un hook.
    const ordre = ['const natures = useMemo', 'const libelleCible', 'const parametresDemande', 'const exporter'];
    const positions = ordre.map((m) => s.indexOf(m));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `${ordre[i]} introuvable`).toBeGreaterThan(-1);
      if (i > 0) expect(pos, `${ordre[i]} doit suivre ${ordre[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe('couleurs — jamais de hex en dur (règle formelle du projet)', () => {
  it('aucune couleur littérale dans les composants du périmètre', () => {
    // `DESIGN_SYSTEM.md` : toujours `var(--token)`. Huit hex s'étaient posés
    // dans la palette de courbes (R-05), sans variante de thème clair et hors
    // de tout verrou — alors que le même fichier prouvait trois lignes plus
    // bas que `var()` fonctionne dans Recharts.
    for (const f of PERIMETRE.filter((p) => p.endsWith('.tsx'))) {
      const s = lire(f);
      const hex = s.match(/#[0-9a-fA-F]{6}/g) ?? [];
      expect(hex, `${f} porte des couleurs en dur : ${hex.join(', ')}`).toEqual([]);
    }
  });

  it('la palette de courbes passe par des jetons, dans les DEUX thèmes', () => {
    const s = lire('components/risques/OngletRayonInfluence.tsx');
    expect(s).toMatch(/'var\(--nature-1\)'/);
    const css = lire('app/globals.css');
    // Huit jetons, deux fois : `:root` (sombre) et `html.light`.
    expect((css.match(/--nature-\d:/g) ?? []).length).toBe(16);
  });

  it('le cerne du point de carte s’inverse entre thèmes', () => {
    // R-12 : il valait `rgba(255,255,255,0.9)` en dur, alors que toutes les
    // autres peintures de la couche sont déjà indexées. Sur fond clair, un
    // cerne blanc ne détoure plus rien.
    const p = lire('lib/carte/palette-risques.ts');
    expect(p).toMatch(/export const CONTOUR_POINT: Record<'dark' \| 'light', string>/);
    const l = lire('app/map/_components/RisqueIndustrielLayer.tsx');
    expect(l).toMatch(/'circle-stroke-color': CONTOUR_POINT\[theme\]/);
    // Et la bascule de thème doit le reprendre, pas seulement la création.
    expect(l).toMatch(/setPaintProperty\(ID_POINT, 'circle-stroke-color', CONTOUR_POINT\[theme\]/);
  });
});

describe('méthode et limites — une seule substance, deux rendus', () => {
  it('la route d’export ne rédige plus son texte elle-même', () => {
    // Vingt lignes de méthodologie étaient écrites en dur dans la route :
    // corriger une phrase imposait de toucher une API (R-23).
    const s = lire('app/api/risques/exposition/export/route.ts');
    expect(s).toMatch(/from '@\/lib\/risques\/methode'/);
    expect(s).toMatch(/for \(const n of LIMITES\) ligne\(n\.titre, n\.texte\)/);
    expect(s).toMatch(/for \(const n of SOURCES\) ligne\(n\.titre, n\.texte\)/);
  });

  it('l’écran et le classeur disent les MÊMES faits sur l’outre-mer', () => {
    // Les deux rendus diffèrent légitimement — l'écran met en forme, le
    // classeur est plat. Ce qui ne doit pas diverger, ce sont les FAITS : un
    // lecteur qui compare les deux ne doit pas trouver deux vérités.
    const ecran = lire('components/risques/AnalysePopulationOverlay.tsx');
    const methode = lire('lib/risques/methode.ts');
    for (const fait of ['603 sites', '31', '27 de Guyane', '26 022 carreaux']) {
      expect(ecran, `l'écran a perdu « ${fait} »`).toContain(fait);
      expect(methode, `le classeur a perdu « ${fait} »`).toContain(fait);
    }
    // Et la distinction qui compte le plus, des deux côtés.
    for (const s of [ecran, methode]) {
      expect(s).toMatch(/donnée absente à la source/);
      expect(s).toMatch(/pas une exposition nulle/);
    }
  });
});

describe('aucun code de débogage dans le périmètre', () => {
  it('ni console.log, ni debugger', () => {
    for (const f of PERIMETRE) {
      const s = lire(f);
      expect(s, `${f}`).not.toMatch(/\bconsole\.log\(/);
      expect(s, `${f}`).not.toMatch(/\bdebugger\b/);
    }
  });

  it('les fichiers du périmètre existent tous — la liste ne se périme pas en silence', () => {
    // Un test qui lit une liste de chemins devient vert par accident le jour
    // où un fichier est renommé : il ne garde plus rien.
    const presents = readdirSync(join(RACINE, 'components/risques'));
    expect(presents).toContain('Kpi.tsx');
    for (const f of PERIMETRE) expect(() => lire(f), `${f} introuvable`).not.toThrow();
  });
});
