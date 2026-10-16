/** sql/262 — les colonnes d'emplacement de `panneaux_affichage` (spec 2026-10-16-ooh-campagnes § 4.3) et leurs CHECK. */
import { afterAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-enrichis-${Date.now()}`;
let n = 0;
const base = () => ({ lat: 43.3, lng: 5.4, source: SOURCE, source_ref: String(++n) });

afterAll(async () => {
  const { error } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('sql/262 — panneaux enrichis', () => {
  it('écrit et relit toutes les colonnes d emplacement', async () => {
    const ligne = {
      ...base(), nom_lieu: 'Campus essai', reseau: 'DOOH borne de recharge', type_lieu: 'campus', numerique: true,
      nb_ecrans: 3, formats: ['43"'], contacts_semaine: 150000, contacts_18_25_semaine: 142500,
      geoloc_methode: 'adresse_ban', geoloc_qualite: 'a_verifier', geoloc_score: 0.48, geoloc_libelle: 'Rue Essai 13009 Marseille',
    };
    const { data, error } = await admin.from('panneaux_affichage').insert(ligne)
      .select('nom_lieu, reseau, type_lieu, numerique, nb_ecrans, formats, contacts_semaine, contacts_18_25_semaine, geoloc_methode, geoloc_qualite, geoloc_score, geoloc_libelle')
      .single();
    expect(error).toBeNull();
    const { lat: _lat, lng: _lng, source: _s, source_ref: _r, ...attendu } = ligne;
    expect(data).toEqual(attendu);
  });

  it.each([
    ['geoloc_methode', 'devine'],
    ['geoloc_qualite', 'peut-etre'],
    ['geoloc_score', 1.5],
    ['geoloc_score', -0.1],
  ] as const)('%s = %s est refusé', async (colonne, valeur) => {
    const { error } = await admin.from('panneaux_affichage').insert({ ...base(), [colonne]: valeur });
    expect(error?.code).toBe('23514');
  });
});
