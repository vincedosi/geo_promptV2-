/**
 * Aucun fichier `.ts` d'`angular/src` (hors `*.spec.ts`) ne dépasse 400 lignes.
 *
 * Pourquoi : demande du propriétaire au lot 4 (T22, 2026-10-10) — « un code hyper propre pour le dev qui va
 * reprendre ». Sept fichiers avaient dépassé ce plafond en grossissant tâche après tâche, sans que personne ne le
 * décide. Un fichier qui le franchit se DÉCOUPE : une responsabilité par fichier, la logique pure dans un `logique/`
 * testé sans TestBed, le gabarit long dans un `.html` voisin, les sous-parties de gabarit en composants enfants.
 *
 * Les exceptions sont NOMMÉES et justifiées ici, jamais un seuil relevé. Une exception qui repasse sous le plafond
 * fait échouer la suite : on la retire de la liste au lieu de la laisser couvrir un futur dépassement.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const ANGULAR_SRC = path.join(RACINE, 'angular', 'src');
const PLAFOND = 400;

/** Chemin relatif à `angular/src`, séparateurs `/` → pourquoi il échappe au plafond. */
const EXCEPTIONS: Record<string, string> = {
  'app/ui/icone/icones.ts':
    'table de DONNÉES (tracés lucide recopiés, comparés attribut par attribut par icones-lucide.test.ts), pas de logique',
};

function fichiersTs(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiersTs(complet));
    else if (nom.endsWith('.ts') && !nom.endsWith('.spec.ts')) sortie.push(complet);
  }
  return sortie;
}

/** Le nombre de lignes au sens de `wc -l` : un fichier terminé par un saut de ligne n'en gagne pas une vide. */
function compterLignes(texte: string): number {
  if (texte === '') return 0;
  const n = texte.split('\n').length;
  return texte.endsWith('\n') ? n - 1 : n;
}

const relatif = (f: string) => path.relative(ANGULAR_SRC, f).split(path.sep).join('/');

describe('taille des fichiers Angular', () => {
  it('compterLignes compte comme `wc -l`', () => {
    expect(compterLignes('')).toBe(0);
    expect(compterLignes('a\n')).toBe(1);
    expect(compterLignes('a\nb')).toBe(2);
    expect(compterLignes('a\nb\n')).toBe(2);
  });

  it(`aucun .ts non-spec d'angular/src au-delà de ${PLAFOND} lignes, hors exceptions nommées`, () => {
    const fichiers = fichiersTs(ANGULAR_SRC);
    expect(fichiers.length).toBeGreaterThan(100);
    const trop = fichiers
      .map((f) => ({ f: relatif(f), n: compterLignes(readFileSync(f, 'utf8')) }))
      .filter(({ f, n }) => n > PLAFOND && !(f in EXCEPTIONS))
      .map(({ f, n }) => `${f} (${n} lignes)`);
    expect(trop).toEqual([]);
  });

  it('chaque exception existe encore ET dépasse encore le plafond', () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      const complet = path.join(ANGULAR_SRC, ...f.split('/'));
      expect(compterLignes(readFileSync(complet, 'utf8')), f).toBeGreaterThan(PLAFOND);
    }
  });
});
