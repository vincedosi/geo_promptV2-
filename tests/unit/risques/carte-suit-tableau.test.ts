/**
 * La mini-carte de l'étape ③ lit-elle le MÊME calcul que le tableau ?
 *
 * ── CE QUE CE TEST PROTÈGE ────────────────────────────────────────────────
 *
 * L'écran porte DEUX calculs : `resultatBandes` (la maille globale) et
 * `resultatExplore` (l'exploration locale du tableau). `bandesTableau` choisit
 * entre les deux. Constaté dans le navigateur le 2026-09-22 : le tableau lisait
 * `bandesTableau`, la carte `resultatBandes`. En descendant dans
 * l'Île-de-France, le tableau listait ses 8 départements pendant que la carte
 * en dessinait 96, peints avec des valeurs de RÉGION.
 *
 * Le défaut ne ressemblait pas à une erreur de données. Les nomenclatures
 * INSEE de région et de département se recouvrent sur 18 codes : la carte
 * affichait « Aude 26,0 % » (la valeur de la région 11, Île-de-France, posée
 * sur le département 11) et « Paris 12,3 % » (Nouvelle-Aquitaine, région 75,
 * sur le département 75). Des noms justes, des nombres plausibles, une carte
 * entièrement fausse. Même piège que sql/171.
 *
 * ── POURQUOI UN TEST QUI LIT LE SOURCE ───────────────────────────────────
 *
 * Le lien vit dans un `useMemo` au milieu d'un composant de 1 500 lignes, que
 * rien ne permet d'appeler isolément. Même choix que
 * `tests/unit/carte/panneau-analyse-garde.test.ts` : lire le composant RÉEL
 * plutôt que simuler son comportement — un test isolé resterait vert pendant
 * que l'écran afficherait faux.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/risques/AnalysePopulationOverlay.tsx'),
  'utf8',
);

/** Extrait le corps d'un `useMemo`/`const` depuis sa déclaration. */
function bloc(depuis: string, lignes = 30): string {
  const i = SOURCE.indexOf(depuis);
  expect(i, `déclaration introuvable : ${depuis}`).toBeGreaterThan(-1);
  return SOURCE.slice(i, i + lignes * 90);
}

describe('la mini-carte lit le calcul du tableau, jamais le calcul global', () => {
  it('les deux calculs existent toujours, et bandesTableau arbitre', () => {
    // Si cette ligne disparaît, le test suivant ne veut plus rien dire.
    expect(SOURCE).toContain(
      'const bandesTableau = exploration.length > 0 ? resultatExplore : resultatBandes;',
    );
  });

  for (const memo of [
    'const zonesAffichees = useMemo',
    'const valeurs = useMemo',
    'const valeursCarte = useMemo',
  ]) {
    it(`${memo.replace('const ', '').replace(' = useMemo', '')} ne lit pas resultatBandes`, () => {
      const corps = bloc(memo);
      // On s'arrête au memo suivant pour ne pas déborder.
      const fin = corps.indexOf('\n  const ', 10);
      const portee = fin > 0 ? corps.slice(0, fin) : corps;
      expect(portee).toContain('bandesTableau.bandes');
      expect(portee).not.toMatch(/resultatBandes\.bandes/);
    });
  }

  it('encodageIndisponible compare deux termes du MÊME calcul', () => {
    const corps = bloc('const encodageIndisponible', 8);
    const portee = corps.slice(0, corps.indexOf('const encodageEffectif'));
    expect(portee).toContain('bandesTableau.bandes');
    expect(portee).not.toMatch(/resultatBandes\.bandes/);
  });

  it('le filtre des contours passe par la fonction pure, pas par chemin seul', () => {
    const corps = bloc('const zonesAffichees = useMemo');
    const portee = corps.slice(0, corps.indexOf('\n  const ', 10));
    expect(portee).toContain('codesDessines(');
    // La sortie anticipée qui ignorait l'exploration.
    expect(portee).not.toContain('if (chemin.length === 0) return zones;');
    expect(portee).toContain('exploration');
  });
});
