import { HttpErrorResponse } from '@angular/common/http';
import { formaterNombre } from '../../../../core/format/nombre';
import {
  DECOUPAGES, DECOUPAGES_ANALYSE, type LigneCouverture, avertissementNonCarroye, ecrireParamCouverture, libelleDecoupage, ligneHorsTerritoire, lireParamCouverture,
  lireZoneAnalyse, messageZoneVide, pageDeLignes, phraseMinimumMenages, phraseReference, trierLignes,
} from './couverture';
import { messageErreurCouverture, refusDeLErreur } from './couverture-erreurs';

const ligne = (code: string, pop_en_zone: number, part: number | null, nom: string | null = code): LigneCouverture => ({
  code, nom, commune: null, n_carreaux: 1, pop_en_zone, pop_totale: part === null ? null : 100, part, part_brute: part,
});

describe('lireParamCouverture / ecrireParamCouverture', () => {
  it('absent, vide ou illisible : les défauts, sans lever', () => {
    for (const brut of [null, undefined, '', '.', 'ind', '.cp', 'ind.commune', 'ind.departement', 'IND.cp', 'a.cp', 'x'.repeat(21) + '.cp', 'ind.cp.x']) {
      expect(lireParamCouverture(brut), String(brut)).toEqual({ cible: 'ind', decoupage: 'forme' });
    }
  });
  it('lit cible et découpage', () => {
    expect(lireParamCouverture('ind_18_24.iris')).toEqual({ cible: 'ind_18_24', decoupage: 'iris' });
    expect(lireParamCouverture('ind.cp')).toEqual({ cible: 'ind', decoupage: 'cp' });
  });
  it('le défaut ne s’écrit pas ; le reste fait l’aller-retour', () => {
    expect(ecrireParamCouverture({ cible: 'ind', decoupage: 'forme' })).toBeNull();
    for (const r of [{ cible: 'ind', decoupage: 'cp' }, { cible: 'men_pauv', decoupage: 'forme' }, { cible: 'ind_65p', decoupage: 'iris' }] as const) {
      expect(lireParamCouverture(ecrireParamCouverture(r))).toEqual(r);
    }
  });
});

describe('lireZoneAnalyse', () => {
  it('un uuid, mis en minuscules ; tout le reste : null', () => {
    expect(lireZoneAnalyse('0F8FAD5B-D9CB-469F-A165-70867728950E')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    for (const b of [null, '', 'zone', '0f8fad5b-d9cb-469f-a165-70867728950', '0f8fad5b-d9cb-469f-a165-70867728950e1']) {
      expect(lireZoneAnalyse(b)).toBeNull();
    }
  });
});

describe('trierLignes', () => {
  const lignes = [ligne('13100', 50, 80), ligne('13001', 200, null), ligne('13090', 50, 100), ligne('13002', 10, 5)];
  it('par part décroissante, valeur absente en dernier, code pour départager', () => {
    expect(trierLignes(lignes, 'part', 'desc').map((l) => l.code)).toEqual(['13090', '13100', '13002', '13001']);
    expect(trierLignes(lignes, 'part', 'asc').map((l) => l.code)).toEqual(['13002', '13100', '13090', '13001']);
  });
  it('par population dans la zone ; égalité départagée par le code ; la liste d’origine n’est pas touchée', () => {
    const avant = lignes.map((l) => l.code);
    expect(trierLignes(lignes, 'pop_en_zone', 'desc').map((l) => l.code)).toEqual(['13001', '13090', '13100', '13002']);
    expect(lignes.map((l) => l.code)).toEqual(avant);
  });
  it('par nom, à la française', () => {
    const l = [ligne('1', 1, 1, 'Étang'), ligne('2', 1, 1, 'Aix'), ligne('3', 1, 1, 'Zèbre')];
    expect(trierLignes(l, 'nom', 'asc').map((x) => x.nom)).toEqual(['Aix', 'Étang', 'Zèbre']);
  });
});

describe('pageDeLignes', () => {
  const n = Array.from({ length: 5486 }, (_, i) => i);
  it('50 par page ; 5 486 lignes → 110 pages ; la dernière en porte 36', () => {
    expect(pageDeLignes(n, 1).lignes).toHaveLength(50);
    const derniere = pageDeLignes(n, 110);
    expect(derniere).toMatchObject({ page: 110, nPages: 110 });
    expect(derniere.lignes).toHaveLength(36);
    expect(derniere.lignes[0]).toBe(5450);
  });
  it('page hors bornes ramenée ; liste vide : une page vide', () => {
    expect(pageDeLignes(n, 999).page).toBe(110);
    expect(pageDeLignes(n, -3).page).toBe(1);
    expect(pageDeLignes(n, Number.NaN).page).toBe(1);
    expect(pageDeLignes([], 1)).toEqual({ lignes: [], page: 1, nPages: 1 });
  });
});

describe('libelleDecoupage', () => {
  it('sentence case', () => {
    expect([libelleDecoupage('forme'), libelleDecoupage('cp'), libelleDecoupage('iris')]).toEqual(['Telle quelle', 'Par code postal', 'Par IRIS']);
    expect([libelleDecoupage('commune'), libelleDecoupage('departement')]).toEqual(['Par commune', 'Par département']);
  });
});

describe('découpages : le serveur en sert cinq, ④ en affiche trois (lot 5, T3)', () => {
  it('commune et département sont la maille de ⑤, jamais une pastille ni un paramètre d’URL de ④', () => {
    expect([...DECOUPAGES]).toEqual(['forme', 'cp', 'iris', 'commune', 'departement']);
    expect([...DECOUPAGES_ANALYSE]).toEqual(['forme', 'cp', 'iris']);
  });
});

describe('messageErreurCouverture / refusDeLErreur', () => {
  const erreur = (status: number, error: unknown) => new HttpErrorResponse({ status, error });
  it('la phrase de la route d’abord (refus compris)', () => {
    const e = erreur(404, { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
    expect(messageErreurCouverture(e)).toBe('Zone introuvable dans cet espace.');
    expect(refusDeLErreur(e)).toBe('zone_introuvable');
  });
  it('réseau coupé : « Connexion perdue : réessayez. »', () => {
    expect(messageErreurCouverture(erreur(0, null))).toBe('Connexion perdue : réessayez.');
  });
  it('sans phrase : le message commun (429 sans corps)', () => {
    expect(messageErreurCouverture(erreur(429, null))).toBe('Trop de demandes rapprochées. Réessayez dans une minute.');
    expect(messageErreurCouverture(new Error('x'))).toBe('x');
    expect(refusDeLErreur(erreur(422, { refus: 'inconnu' }))).toBeNull();
    expect(refusDeLErreur(new Error('x'))).toBeNull();
  });
});

describe('textes Q-J de la couverture (T8)', () => {
  const ref = { source: 's', millesime: 2021, population_france: 63783569, n_carreaux_france: 2324577 };
  it('phraseReference : « 63,78 M en France », et « pour cette cible » hors population totale', () => {
    expect(phraseReference({ reference: ref, cible: 'ind' })).toBe('Population des carreaux Filosofi 2021 (63,78 M en France)');
    expect(phraseReference({ reference: { ...ref, population_france: 523000 }, cible: 'men_pauv' }))
      .toBe(`Population des carreaux Filosofi 2021 (${formaterNombre(523000)} en France pour cette cible)`);
  });
  it('messageZoneVide : territoire non carroyé nommé, mer, ou rien', () => {
    expect(messageZoneVide({ motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{ code: '973', nom: 'Guyane' }] })).toContain('ne couvre pas ce territoire (Guyane)');
    expect(messageZoneVide({ motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [] })).toContain('ces territoires (Guadeloupe, Guyane, Mayotte)');
    expect(messageZoneVide({ motif_vide: 'aucun_carreau', territoires_non_carroyes: [] })).toContain('Aucun carreau habité');
    expect(messageZoneVide({ motif_vide: 'carreaux_tous_ecartes', territoires_non_carroyes: [] })).toContain('moins de ménages que le minimum');
    expect(messageZoneVide({ motif_vide: null, territoires_non_carroyes: [] })).toBeNull();
  });
  it('A5 phraseMinimumMenages : la valeur appliquée et les carreaux écartés, avant / après', () => {
    expect(phraseMinimumMenages({ min_menages: 11, n_carreaux: 581, carreaux_ecartes: { n_carreaux: 37 } }))
      .toBe('Minimum de ménages par carreau : 11 (secret statistique INSEE : en dessous, valeurs imputées) · 581 carreaux comptés sur 618, 37 écartés');
    expect(phraseMinimumMenages({ min_menages: 11, n_carreaux: 1, carreaux_ecartes: { n_carreaux: 1 } }))
      .toBe('Minimum de ménages par carreau : 11 (secret statistique INSEE : en dessous, valeurs imputées) · 1 carreau compté sur 2, 1 écarté');
    expect(phraseMinimumMenages({ min_menages: 0, n_carreaux: 618, carreaux_ecartes: { n_carreaux: 0 } }))
      .toBe('Minimum de ménages par carreau : 0 (population totale : tous les carreaux comptent)');
    expect(phraseMinimumMenages({ n_carreaux: 618 })).toBeNull();
  });
  it('avertissementNonCarroye : seulement une zone peuplée qui déborde sur un territoire non carroyé', () => {
    expect(avertissementNonCarroye({ motif_vide: null, territoires_non_carroyes: [{ code: '971', nom: 'Guadeloupe' }] })).toContain('Guadeloupe');
    expect(avertissementNonCarroye({ motif_vide: null, territoires_non_carroyes: [] })).toBeNull();
  });
  it('C21 round 1 : zone nationale moins une zone qui recouvre un DROM non carroyé → ses unités restent, et c’est dit', () => {
    const a = avertissementNonCarroye({
      motif_vide: null, territoires_non_carroyes: [], inconnues_recouvertes: [{ code: '973', nom: 'Guyane' }],
    });
    expect(a).toContain('Guyane');
    expect(a).toContain('restent dans la zone');
    expect(avertissementNonCarroye({ motif_vide: null, territoires_non_carroyes: [], inconnues_recouvertes: [] })).toBeNull();
  });
  it('ligneHorsTerritoire : CP / IRIS, jamais en forme ni à zéro', () => {
    const h = { n_carreaux: 12, population: 1786 };
    expect(ligneHorsTerritoire({ decoupage: 'cp', hors_territoire: h, cible: 'ind' })).toContain(`${formaterNombre(1786)} habitants hors code postal (12 carreaux)`);
    expect(ligneHorsTerritoire({ decoupage: 'iris', hors_territoire: h, cible: 'men_pauv' })).toContain('de la cible hors IRIS');
    expect(ligneHorsTerritoire({ decoupage: 'commune', hors_territoire: h, cible: 'ind' })).toContain('habitants hors commune');
    expect(ligneHorsTerritoire({ decoupage: 'departement', hors_territoire: h, cible: 'ind' })).toContain('habitants hors département');
    expect(ligneHorsTerritoire({ decoupage: 'forme', hors_territoire: h, cible: 'ind' })).toBeNull();
    expect(ligneHorsTerritoire({ decoupage: 'cp', hors_territoire: { n_carreaux: 0, population: 0 }, cible: 'ind' })).toBeNull();
  });
});
