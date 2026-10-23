import { readFileSync, readdirSync } from 'node:fs';
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
  it('mêmes bornes que la base (rayon, valeurs, carreaux)', () => {
    for (const c of ['RAYON_MIN_M', 'RAYON_MAX_M', 'MAX_VALEURS', 'MAX_CARREAUX_COUVERTURE'] as const) expect(A[c], c).toBe(S[c]);
    // Et la base les écrit telles quelles.
    const sql = (f: string) => readFileSync(`sql/${readdirSync('sql').find((n) => n.endsWith(f))}`, 'utf8');
    expect(sql('_couverture_rayon_poi.sql')).toContain(`p_rayon_max_m < ${S.RAYON_MIN_M} or p_rayon_max_m > ${S.RAYON_MAX_M}`);
    expect(sql('_couverture_rayon_poi.sql')).toContain(`coalesce(cardinality(p_valeurs), 0) > ${S.MAX_VALEURS}`);
    expect(sql('_couverture_geometrie.sql')).toContain(`p_max_carreaux integer default ${S.MAX_CARREAUX_COUVERTURE}`);
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
