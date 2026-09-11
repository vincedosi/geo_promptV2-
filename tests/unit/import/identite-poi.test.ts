import { describe, it, expect } from 'vitest';
import { identitePoi, uuidV5, type ChampsIdentitePoi } from '@/lib/import/identite-poi';

/**
 * `ECH-001` — l'import de POI doit être rejouable sans dupliquer.
 *
 * Le test qui compte est le premier : deux analyses successives du même contenu
 * doivent produire le MÊME identifiant. C'est ce qui manquait, et c'est ce qui
 * rend `onConflict: 'id'` enfin opérant.
 */

const base: ChampsIdentitePoi = {
  source: 'import_universel',
  categorie: 'pharmacie',
  nom: 'Pharmacie du Centre',
  adresse: '12 rue de la Paix',
  code_postal: '75002',
  ville: 'Paris',
  lat: 48.869_12,
  lng: 2.331_45,
};

describe('identitePoi', () => {
  it('rend le MÊME identifiant pour le même contenu — le cœur du correctif', () => {
    expect(identitePoi(base)).toBe(identitePoi({ ...base }));
  });

  it('produit un UUID conforme, de version 5', () => {
    const id = identitePoi(base);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('absorbe les espaces invisibles des CSV INSEE', () => {
    // CLAUDE.md : « .trim() obligatoire sur données CSV INSEE (espaces invisibles) ».
    // Sans cette normalisation, un export et sa copie produiraient deux POI.
    expect(identitePoi({ ...base, nom: '  Pharmacie du Centre  ' })).toBe(identitePoi(base));
    expect(identitePoi({ ...base, adresse: '12  rue   de la Paix' })).toBe(identitePoi(base));
  });

  it('ignore la casse et la forme Unicode', () => {
    expect(identitePoi({ ...base, nom: 'PHARMACIE DU CENTRE' })).toBe(identitePoi(base));
    // Precompose (U+00E9) contre decompose (e + U+0301) : deux suites d'octets
    // differentes pour le meme caractere affiche. Un export Excel et un export
    // depuis un Mac peuvent produire l'une ou l'autre.
    const precompose = { ...base, ville: 'Orl' + String.fromCharCode(0x00e9) + 'ans' };
    const decompose  = { ...base, ville: 'Orle' + String.fromCharCode(0x0301) + 'ans' };
    expect(precompose.ville).not.toBe(decompose.ville);            // bien deux chaines distinctes
    expect(identitePoi(precompose)).toBe(identitePoi(decompose));  // mais une seule identite
  });

  it('distingue deux POI differents au meme endroit', () => {
    expect(identitePoi({ ...base, nom: 'Pharmacie du Nord' })).not.toBe(identitePoi(base));
    expect(identitePoi({ ...base, adresse: '14 rue de la Paix' })).not.toBe(identitePoi(base));
  });

  it('distingue deux categories au meme endroit — un doublon visible vaut mieux qu une perte silencieuse', () => {
    // Choix assumé : inclure `categorie`. L'exclure ferait fusionner deux POI
    // distincts partageant nom et adresse — une perte silencieuse.
    expect(identitePoi({ ...base, categorie: 'sante' })).not.toBe(identitePoi(base));
  });

  it('distingue deux positions distinctes', () => {
    expect(identitePoi({ ...base, lat: 48.870_00 })).not.toBe(identitePoi(base));
  });

  it('ignore le bruit de flottant au-dela de la 6e decimale', () => {
    // ~11 cm : en deça, c'est du bruit de representation, pas un autre lieu.
    expect(identitePoi({ ...base, lat: 48.869_120_000_04 })).toBe(identitePoi(base));
  });

  it('applique les memes valeurs par defaut que l inserter', () => {
    // L'inserter ecrit `source: r.source || 'import_universel'` et
    // `categorie: r.categorie || 'autre'`. L'identite doit etre calculee sur ce
    // qui sera REELLEMENT stocke, sinon elle ne retrouve pas la ligne existante.
    expect(identitePoi({ ...base, source: undefined }))
      .toBe(identitePoi({ ...base, source: 'import_universel' }));
    expect(identitePoi({ ...base, categorie: null }))
      .toBe(identitePoi({ ...base, categorie: 'autre' }));
  });

  it('traite null, undefined et chaine vide comme equivalents', () => {
    const a = identitePoi({ ...base, adresse: null });
    expect(identitePoi({ ...base, adresse: undefined })).toBe(a);
    expect(identitePoi({ ...base, adresse: '' })).toBe(a);
  });

  it('ne laisse pas un champ en deborder sur un autre', () => {
    // Le separateur est un caractere « unit separator » absent des donnees
    // reelles. Sans separateur robuste, « ab » + « c » et « a » + « bc »
    // donneraient la meme cle.
    const a = identitePoi({ ...base, nom: 'ab', adresse: 'c' });
    const b = identitePoi({ ...base, nom: 'a', adresse: 'bc' });
    expect(a).not.toBe(b);
  });

  it('reste stable quelle que soit la ligne data_source_id', () => {
    // Chaque import cree une NOUVELLE ligne data_sources : l'inclure ferait
    // changer l'identifiant a chaque execution. Le type ne l'accepte meme pas —
    // ce test documente l'intention.
    const avecBruit = { ...base, data_source_id: 'peu-importe' } as ChampsIdentitePoi;
    expect(identitePoi(avecBruit)).toBe(identitePoi(base));
  });
});

describe('uuidV5 — conformité RFC 4122', () => {
  it('reproduit le vecteur de test canonique de la RFC', () => {
    // Sans cette vérification, une implémentation subtilement fausse produirait
    // des identifiants stables mais non conformes — et le défaut ne se verrait
    // que le jour où une autre brique calculerait la même clé.
    const ESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidV5('www.example.com', ESPACE_DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('force la version 5 et la variante RFC 4122', () => {
    const id = uuidV5('peu importe', '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(id[14]).toBe('5');                       // version
    expect('89ab').toContain(id[19]);               // variante 10x
  });
});
