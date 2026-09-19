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
