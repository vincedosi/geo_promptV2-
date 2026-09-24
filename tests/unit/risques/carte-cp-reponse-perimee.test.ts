/**
 * La carte des codes postaux ignore-t-elle une réponse arrivée APRÈS sa
 * destruction ?
 *
 * ── CE QUE CE TEST PROTÈGE ────────────────────────────────────────────────
 *
 * `charger` capture l'instance MapLibre, attend `/cp-geo`, puis appelle
 * `m.getSource(...)`. Constaté dans le navigateur le 2026-09-24 : entre les
 * deux, la carte avait été détruite et remplacée (montage en double du
 * StrictMode, ou démontage de l'étape pendant la requête). `remove()` supprime
 * `map.style`, donc `getSource` levait « Cannot read properties of undefined
 * (reading 'getSource') », et le `catch` affichait ce message au-dessus de la
 * NOUVELLE carte — qui avait pourtant chargé ses propres données. Trace posée
 * pour le diagnostic : `carte.current === m` valait `false` au moment de
 * l'erreur. Si la réponse morte arrivait après la bonne, l'écran restait en
 * échec pour de bon.
 *
 * ── POURQUOI UN TEST QUI LIT LE SOURCE ───────────────────────────────────
 *
 * Même choix que `carte-suit-tableau.test.ts` : la garde vit dans un
 * `useCallback` qui dépend d'une instance WebGL qu'on ne monte pas sous jsdom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/risques/CarteCodesPostaux.tsx'),
  'utf8',
);

/** Le corps de `charger`, jusqu'à la fermeture de son `useCallback`. */
function corpsCharger(): string {
  const debut = SOURCE.indexOf('const charger = useCallback(');
  expect(debut, 'charger introuvable').toBeGreaterThan(-1);
  const fin = SOURCE.indexOf('}, [jeuId', debut);
  expect(fin, 'fin de charger introuvable').toBeGreaterThan(debut);
  return SOURCE.slice(debut, fin);
}

describe('CarteCodesPostaux — réponse périmée', () => {
  it('abandonne la réponse si la carte a été remplacée pendant la requête', () => {
    const corps = corpsCharger();
    const attente = corps.indexOf('await r.json()');
    const garde = corps.indexOf('carte.current !== m', attente);
    const getSource = corps.indexOf('m.getSource(');
    expect(attente).toBeGreaterThan(-1);
    // La garde vient APRÈS l'attente et AVANT tout usage de l'instance.
    expect(garde).toBeGreaterThan(attente);
    expect(garde).toBeLessThan(getSource);
  });

  it("n'affiche pas l'échec d'une carte qui n'est plus à l'écran", () => {
    const corps = corpsCharger();
    const capture = corps.indexOf('catch (e)');
    const garde = corps.indexOf('carte.current !== m', capture);
    const echec = corps.indexOf("setEtat('echec')", capture);
    expect(capture).toBeGreaterThan(-1);
    expect(garde).toBeGreaterThan(capture);
    expect(garde).toBeLessThan(echec);
  });
});
