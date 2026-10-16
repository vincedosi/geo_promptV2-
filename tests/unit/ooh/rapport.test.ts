import { describe, expect, it } from 'vitest';
import { formaterNombre } from '@/lib/format/nombre';
import { cheminRapportAutorise, compterParReseau, csvAReprendre, ligneProgression, nomRapport } from '@/lib/ooh/plan/rapport';
import type { EmplacementNonPlace, EmplacementPlace } from '@/types/campagnes-media';

const meta = { onglet: 'ESSAI', lignes: [] };
const place = (adaptateur: EmplacementPlace['adaptateur'], qualite: EmplacementPlace['geoloc_qualite'], nom: string): EmplacementPlace => ({
  adaptateur, cle: nom, nom_lieu: nom, type_lieu: 'lieu', reseau: 'DOOH essai', numerique: true, nb_ecrans: 1, formats: [],
  adresse: null, code_postal: null, ville: null, reference_panneau: null, contacts_semaine: null, contacts_18_25_semaine: null,
  recherche: { type: 'gare', nom, bloc: 'idf' }, metadata: meta, source_ref: nom, lat: 48.1, lng: 2.2,
  code_insee: null, code_departement: null, geoloc_methode: 'adresse_ban', geoloc_qualite: qualite, geoloc_score: 0.45, geoloc_libelle: `Rue ${nom}; Ville`,
});
const nonPlace = (adaptateur: EmplacementNonPlace['adaptateur'], nom: string, raison: string): EmplacementNonPlace => ({ adaptateur, cle: nom, nom, raison, metadata: meta });

describe('rapport d import', () => {
  it('compteurs par réseau : lus, sûrs, à vérifier, non placés', () => {
    expect(compterParReseau(
      [place('basic-fit', 'sure', 'a'), place('basic-fit', 'a_verifier', 'b'), place('stride-campus', 'sure', 'c')],
      [nonPlace('basic-fit', 'd', 'adresse introuvable (BAN)')],
    )).toEqual([
      { adaptateur: 'basic-fit', lus: 3, surs: 1, a_verifier: 1, non_places: 1 },
      { adaptateur: 'stride-campus', lus: 1, surs: 1, a_verifier: 0, non_places: 0 },
    ]);
  });

  it('le CSV à reprendre : à vérifier et non placés, séparateur point-virgule, valeurs échappées', () => {
    const aVerifier = { ...place('basic-fit', 'a_verifier', 'b'), geoloc_raison: 'score BAN 0,45 sous 0,60 ; commune seule (pas de rue dans la liste)' };
    const csv = csvAReprendre([place('basic-fit', 'sure', 'a'), aVerifier], [nonPlace('stride-campus', 'Campus "X"', 'score BAN 0,20 sous 0,30')]);
    expect(csv.split('\n')).toEqual([
      'reseau;nom;etat;raison;methode;score;reconnu;latitude;longitude',
      'basic-fit;b;a_verifier;"score BAN 0,45 sous 0,60 ; commune seule (pas de rue dans la liste)";adresse_ban;0,45;"Rue b; Ville";48.1;2.2',
      'stride-campus;"Campus ""X""";non_place;score BAN 0,20 sous 0,30;;;;;',
    ]);
  });

  it('le rapport ne s écrit jamais dans le dépôt', () => {
    expect(cheminRapportAutorise('C:/Temp/rapports', 'C:/GENESIS/genesis_app')).toBe(true);
    expect(cheminRapportAutorise('C:/GENESIS/genesis_app/docs', 'C:/GENESIS/genesis_app')).toBe(false);
    expect(cheminRapportAutorise('C:/GENESIS/genesis_app', 'C:/GENESIS/genesis_app')).toBe(false);
  });

  it('nom du rapport et ligne de progression', () => {
    expect(nomRapport('marine-tf4-2026', new Date(Date.UTC(2026, 9, 16, 8, 5, 9)))).toBe('rapport-ooh-marine-tf4-2026-20261016-080509.csv');
    expect(ligneProgression('géolocalisation', 420, 1000)).toBe(`[géolocalisation] 42 % — ${formaterNombre(420)} / ${formaterNombre(1000)}`);
    expect(ligneProgression('écriture', 0, 0)).toBe('[écriture] 100 % — 0 / 0');
  });
});
