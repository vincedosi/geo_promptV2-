import { describe, it, expect } from 'vitest';
import { processRows } from '@/lib/import/validator';
import type { FieldMapping, GeoConfig } from '@/lib/import/types';

/**
 * `ECH-001` de bout en bout : rejouer un import ne doit plus rien dupliquer.
 *
 * `identite-poi.test.ts` prouve que la FONCTION d'identite est deterministe.
 * Celui-ci prouve la CHAINE : deux analyses successives du meme fichier, par
 * `processRows`, produisent des lignes portant les memes identifiants — donc un
 * second import est absorbe par le `onConflict: 'id', ignoreDuplicates: true`
 * de l'inserter.
 *
 * C'est la propriete que le defaut violait, et la seule qui compte pour
 * l'utilisateur : relancer apres une coupure reseau ne doit pas doubler ses
 * donnees.
 *
 * Aucun module n'est simule. En mode `gps` le pipeline ne touche ni le reseau
 * ni la base : les lignes portent deja leurs coordonnees, le geocodage BAN
 * n'est jamais sollicite. Simuler `@/lib/import/geocoder` casserait au
 * contraire le test — le validateur y prend aussi `validateGPS` et
 * `extractDeptFromCP`, qui sont du calcul pur.
 */

const lignesBrutes = [
  { nom: 'Pharmacie du Centre', adresse: '12 rue de la Paix', cp: '75002', ville: 'Paris',     lat: '48.869120', lng: '2.331450' },
  { nom: 'Boulangerie Dupont',  adresse: '3 place Bellecour', cp: '69002', ville: 'Lyon',      lat: '45.757800', lng: '4.832100' },
  { nom: 'Cabinet Martin',      adresse: '8 cours Julien',    cp: '13006', ville: 'Marseille', lat: '43.294400', lng: '5.383800' },
];

const mapping: FieldMapping = { nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'cp' };
const geoConfig: GeoConfig = { mode: 'gps', colLat: 'lat', colLng: 'lng' };

async function analyser(lignes: Record<string, string>[] = lignesBrutes) {
  const res = await processRows(lignes, mapping, geoConfig, 'poi', { category: 'sante' });
  // Une ligne rejetee fausserait silencieusement les comparaisons d'index.
  expect(res.errors).toEqual([]);
  return res.validRows;
}

describe('rejouer un import — ECH-001', () => {
  it('deux analyses du meme fichier produisent les MEMES identifiants', async () => {
    const premiere = await analyser();
    const seconde = await analyser();

    expect(premiere).toHaveLength(3);
    expect(seconde.map(r => r.id)).toEqual(premiere.map(r => r.id));
  });

  it('les identifiants sont des UUID de version 5, pas des aleatoires', async () => {
    // Avant le correctif, `randomUUID()` produisait des UUID v4. Le chiffre de
    // version est donc la signature visible du correctif dans la donnee.
    for (const r of await analyser()) {
      expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('trois lignes distinctes gardent trois identifiants distincts', async () => {
    const ids = (await analyser()).map(r => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('une ligne modifiee change d identifiant — c est une autre donnee', async () => {
    const avant = await analyser();
    const apres = await analyser(
      lignesBrutes.map((l, i) => (i === 1 ? { ...l, nom: 'Boulangerie Durand' } : l))
    );

    expect(apres[0].id).toBe(avant[0].id);      // inchangee
    expect(apres[1].id).not.toBe(avant[1].id);  // modifiee
    expect(apres[2].id).toBe(avant[2].id);      // inchangee
  });

  it('les espaces parasites d un re-export ne changent pas l identite', async () => {
    // CLAUDE.md : « .trim() obligatoire sur donnees CSV INSEE (espaces
    // invisibles) ». Un re-export du meme jeu ne doit pas creer 3 doublons.
    const avant = await analyser();
    const avecEspaces = lignesBrutes.map(l => ({ ...l, nom: `  ${l.nom} ` }));
    expect((await analyser(avecEspaces)).map(r => r.id)).toEqual(avant.map(r => r.id));
  });

  it('la categorie choisie a l import fait partie de l identite', async () => {
    // Choix assume et documente dans lib/import/identite-poi.ts : entre un
    // doublon visible et une fusion silencieuse de deux POI distincts, on
    // prend le doublon.
    const sante = await analyser();
    const autre = await processRows(lignesBrutes, mapping, geoConfig, 'poi', { category: 'commerce' });
    expect(autre.validRows.map(r => r.id)).not.toEqual(sante.map(r => r.id));
  });
});
