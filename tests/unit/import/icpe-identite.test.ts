import { describe, it, expect } from 'vitest';
import { identitePoiSourceExterne, identitePoi } from '@/lib/import/identite-poi';

/**
 * L'idempotence de l'import repose entièrement sur cette fonction : c'est elle
 * qui fait que `upsert onConflict: 'id'` rencontre un conflit au rejeu. Si elle
 * devenait instable, un réimport dupliquerait les 138 423 sites sans lever une
 * seule erreur — exactement le défaut ECH-001 documenté en tête du module.
 */
describe('identité sur identifiant externe de source', () => {
  it('est stable : même source + même référence → même UUID', () => {
    const a = identitePoiSourceExterne('georisques_icpe', '0006400036');
    const b = identitePoiSourceExterne('georisques_icpe', '0006400036');
    expect(a).toBe(b);
  });

  it('produit bien un UUID version 5, variante RFC 4122', () => {
    expect(identitePoiSourceExterne('georisques_icpe', '0006400036'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sépare deux références voisines', () => {
    expect(identitePoiSourceExterne('georisques_icpe', '0006400036'))
      .not.toBe(identitePoiSourceExterne('georisques_icpe', '0006400037'));
  });

  it('sépare deux sources portant la même référence', () => {
    expect(identitePoiSourceExterne('georisques_icpe', '1'))
      .not.toBe(identitePoiSourceExterne('autre_source', '1'));
  });

  it('ne collisionne pas avec identitePoi, qui compose une autre clé', () => {
    expect(identitePoiSourceExterne('georisques_icpe', 'X')).not.toBe(
      identitePoi({
        source: 'georisques_icpe', categorie: 'risque_industriel', nom: 'X',
        adresse: null, code_postal: null, ville: null, lat: 0, lng: 0,
      }),
    );
  });
});
