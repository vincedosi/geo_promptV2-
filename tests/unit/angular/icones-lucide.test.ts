import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONES } from '../../../angular/src/app/ui/icone/icones';

/**
 * Verrou de fidélité des icônes : chaque entrée de `angular/src/app/ui/icone/icones.ts` doit
 * rester identique, élément par élément et attribut par attribut (hors `key`), à l'`__iconNode`
 * du fichier lucide-react qu'elle nomme. Sans lui, un tracé retouché à la main passerait.
 */
const DOSSIER = join(process.cwd(), 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');

type Noeud = [string, Record<string, string>];

function noeudsLucide(fichier: string): Noeud[] {
  const src = readFileSync(join(DOSSIER, `${fichier}.js`), 'utf8');
  const m = /const __iconNode = (\[[\s\S]*?\]);\s*\nconst /.exec(src);
  if (!m) throw new Error(`__iconNode introuvable dans ${fichier}.js`);
  // Littéral de données du paquet installé (lecture seule), jamais une entrée utilisateur.
  return new Function(`return ${m[1]}`)() as Noeud[];
}

function normaliser(noeuds: Noeud[]) {
  return noeuds.map(([t, attrs]) => {
    const { key: _ignore, ...reste } = attrs;
    return { t, ...reste };
  });
}

describe('icones.ts reste identique à lucide-react', () => {
  const entrees = Object.entries(ICONES);
  let compares = 0;

  it.each(entrees)('%s', (_nom, def) => {
    const attendu = normaliser(noeudsLucide(def.lucide));
    const obtenu = def.el.map((e) => ({ ...e }));
    expect(obtenu).toEqual(attendu);
    compares += 1;
  });

  it('a comparé exactement 56 icônes (pas de passage à vide)', () => {
    expect(entrees.length).toBe(56);
    expect(compares).toBe(56);
  });

  it('marque Feather exactement les icônes de la liste de la LICENSE', () => {
    const licence = readFileSync(join(process.cwd(), 'node_modules', 'lucide-react', 'LICENSE'), 'utf8');
    const liste = licence.slice(licence.indexOf('airplay'), licence.indexOf('The MIT License')).split(',').map((s) => s.trim());
    const aliasFeather: Record<string, string> = { 'circle-alert': 'alert-circle', 'circle-question-mark': 'help-circle', 'triangle-alert': 'alert-triangle' };
    for (const [nom, def] of entrees) {
      const estFeather = liste.includes(def.lucide) || liste.includes(aliasFeather[def.lucide] ?? '');
      expect(Boolean('feather' in def && def.feather), `${nom} (${def.lucide})`).toBe(estFeather);
    }
  });
});
