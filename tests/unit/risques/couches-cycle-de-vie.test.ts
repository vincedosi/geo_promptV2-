import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous sur le cycle de vie des deux couches carte du périmètre risque.
 *
 * `RisqueIndustrielLayer` et `PprtLayer` sont deux couches sœurs qui font le
 * même travail : créer des couches MapLibre, poser des écouteurs délégués,
 * recharger au déplacement, nettoyer. Elles avaient DEUX cycles de vie
 * différents — l'une corrigée, l'autre non (constats R-03 et R-04 de
 * `docs/AUDIT_ZONE_RISQUE.md`).
 *
 * Ces tests exigent la symétrie, parce que c'est elle qui garantit qu'une
 * correction future s'appliquera aux deux.
 *
 * ── LE DÉFAUT GARDÉ ICI ────────────────────────────────────────────────────
 *
 * `map.removeLayer()` ne retire PAS les écouteurs posés par
 * `map.on(type, layerId, fn)`. Poser les écouteurs dans la branche de création
 * de couche, puis supprimer la couche au décochage, en rajoute donc un à chaque
 * ré-affichage. Après N cycles, un clic déclenche N appels réseau — et sur
 * `RisqueIndustrielLayer` ces appels visent la route qui calcule.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(join(RACINE, 'app/map/_components', p), 'utf-8');

const COUCHES = ['RisqueIndustrielLayer.tsx', 'PprtLayer.tsx'] as const;

describe('écouteurs délégués — posés une fois, retirés au démontage', () => {
  it('les deux couches gardent un drapeau de pose unique', () => {
    for (const f of COUCHES) {
      const s = lire(f);
      expect(s, `${f} : drapeau de pose absent`).toMatch(/clicPoseRef = useRef\(false\)/);
      expect(s, `${f} : le drapeau n'est pas testé`).toMatch(/if \(!clicPoseRef\.current\)/);
    }
  });

  it('les écouteurs ne sont PAS posés dans la branche de création de couche', () => {
    // C'est la formulation exacte du défaut : `if (!map.getLayer(ID))` est vrai
    // de nouveau après chaque `removeLayer`, donc la pose s'y répète.
    const s = lire('RisqueIndustrielLayer.tsx');
    const poseCreation = s.indexOf('if (!m2.getLayer(ID_POINT))');
    const poseClic = s.indexOf('if (!clicPoseRef.current)');
    expect(poseCreation, 'la branche de création doit exister').toBeGreaterThan(-1);
    expect(poseClic, 'le garde de pose doit exister').toBeGreaterThan(-1);
    expect(poseClic, 'la pose des écouteurs doit être HORS de la création de couche')
      .toBeGreaterThan(poseCreation);
  });

  it('RisqueIndustrielLayer retire ses écouteurs et ses couches au démontage', () => {
    // `PprtLayer` appelait déjà `nettoyer()` dans son `return` ; l'autre non.
    const s = lire('RisqueIndustrielLayer.tsx');
    expect(s, 'les écouteurs doivent être gardés pour être retirés')
      .toMatch(/ecouteursRef = useRef</);
    expect(s, 'les écouteurs doivent être retirés').toMatch(/map\.off\(type as 'click', ID_POINT/);
    expect(s, 'le drapeau doit être réarmé pour le prochain montage')
      .toMatch(/clicPoseRef\.current = false/);
  });

  it('les deux couches nettoient leurs couches MapLibre au démontage', () => {
    for (const f of COUCHES) {
      const s = lire(f);
      const retour = s.lastIndexOf('return () => {');
      expect(retour, `${f} : pas de fonction de nettoyage`).toBeGreaterThan(-1);
      expect(s.slice(retour), `${f} : nettoyer() n'est pas appelé au démontage`)
        .toMatch(/nettoyer\(\);/);
    }
  });
});

describe('rappels vers le parent — jamais capturés en closure', () => {
  it('les deux couches passent leur rappel par une ref', () => {
    // Les deux effets ont une liste de dépendances `eslint-disable`d : un
    // rappel capturé en closure y reste figé à la valeur du dernier passage.
    const paires = [
      ['RisqueIndustrielLayer.tsx', 'onCompteRef'],
      ['PprtLayer.tsx', 'onEtatRef'],
    ] as const;
    for (const [f, ref] of paires) {
      const s = lire(f);
      expect(s, `${f} : ${ref} absent`).toMatch(new RegExp(`${ref} = useRef\\(`));
      expect(s, `${f} : ${ref} n'est pas tenu à jour`).toMatch(new RegExp(`${ref}\\.current = `));
      expect(s, `${f} : le rappel est appelé hors de sa ref`)
        .toMatch(new RegExp(`${ref}\\.current\\?\\.\\(`));
    }
  });
});
