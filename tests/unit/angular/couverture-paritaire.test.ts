import { describe, it, expect } from 'vitest';
import * as S from '@/lib/zones/couverture';
import * as A from '../../../angular/src/app/features/carte/logique/analyses/couverture';

/**
 * La couverture d'une zone (lot 4, T7) : la copie Angular du contrat de `GET /api/zones/[id]/couverture` rend ce que
 * rend le serveur — découpages admis, messages des refus (mot pour mot) et forme de cible acceptée.
 */
describe('couverture d’une zone : Angular = serveur', () => {
  it('mêmes découpages, dans le même ordre', () => {
    expect([...A.DECOUPAGES]).toEqual([...S.DECOUPAGES]);
  });
  it('mêmes messages de refus, mêmes clés', () => {
    expect(A.MESSAGES_REFUS_COUVERTURE).toEqual(S.MESSAGES_REFUS_COUVERTURE);
  });
  it('mêmes défauts : la route et le paramètre d’URL lisent « ind.forme »', () => {
    const d = S.RequeteCouvertureSchema.parse({});
    expect({ cible: A.CIBLE_PAR_DEFAUT, decoupage: A.DECOUPAGE_PAR_DEFAUT }).toEqual(d);
  });
  it('une cible que le paramètre d’URL admet, la route l’admet aussi (et inversement)', () => {
    for (const cible of ['ind', 'ind_18_24', 'x', 'IND', 'a'.repeat(21), 'men_pauv', 'ind-18']) {
      const serveur = S.RequeteCouvertureSchema.safeParse({ cible }).success;
      const angular = A.lireParamCouverture(`${cible}.cp`).decoupage === 'cp';
      expect(angular, cible).toBe(serveur);
    }
  });
});
