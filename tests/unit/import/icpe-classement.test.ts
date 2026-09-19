import { describe, it, expect } from 'vitest';
import {
  graviteIcpe,
  natureDominante,
  naturesDuSite,
  normaliserSiteIcpe,
  estInstallationClassee,
  codeDepartementDepuisInsee,
  SOURCE_ICPE,
  CATEGORIE_ICPE,
} from '@/lib/import/georisques/classement';
import type { SiteIcpeBrut } from '@/lib/import/georisques/classement';
import { identitePoiSourceExterne } from '@/lib/import/identite-poi';

const site = (p: Partial<SiteIcpeBrut>): SiteIcpeBrut => ({
  codeAIOT: '0006400036',
  raisonSociale: 'TEST',
  longitude: 5.3,
  latitude: 43.3,
  ...p,
});

/**
 * Table de vérité bâtie sur les valeurs RÉELLEMENT relevées sur l'API le
 * 2026-09-17 (400 sites du département 13), et non sur la nomenclature telle
 * qu'on l'imagine.
 */
describe('gravité ICPE — première règle qui s applique', () => {
  it('Seveso seuil haut prime sur IED et sur le régime', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Seveso seuil haut', regime: 'Autorisation', ied: true })))
      .toBe('seveso_haut');
  });

  it('Seveso seuil bas prime sur IED — mesuré : STMICROELECTRONICS est les deux', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Seveso seuil bas', ied: true, regime: 'Autorisation' })))
      .toBe('seveso_bas');
  });

  it('IED sans Seveso', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', ied: true, regime: 'Autorisation' })))
      .toBe('ied');
  });

  it('Autorisation — le régime le plus fréquent (96 sur 200)', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', ied: false, regime: 'Autorisation' })))
      .toBe('autorisation');
  });

  it('Enregistrement', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', regime: 'Enregistrement' })))
      .toBe('enregistrement');
  });

  it('« Autres régimes » et « Non ICPE » tombent dans autre', () => {
    expect(graviteIcpe(site({ regime: 'Autres régimes' }))).toBe('autre');
    expect(graviteIcpe(site({ regime: 'Non ICPE' }))).toBe('autre');
  });

  it('statutSeveso nul ne fait pas échouer — 31 sites sur 200 mesurés', () => {
    expect(graviteIcpe(site({ statutSeveso: null, regime: null, ied: null }))).toBe('autre');
  });
});

describe('nature du risque', () => {
  it('rend toutes les natures, dédoublonnées et du plus grave au moins', () => {
    const s = site({
      rubriques: [
        { numeroRubrique: '4734' }, // GPL et produits pétroliers (rang 90)
        { numeroRubrique: '4718' }, // même famille → une seule entrée
        { numeroRubrique: '2515' }, // Matériaux et minéraux (rang 40)
      ],
    });
    expect(naturesDuSite(s)).toEqual(['GPL et produits pétroliers', 'Matériaux et minéraux']);
  });

  it('retient la nature de plus haut rang comme dominante', () => {
    const s = site({ rubriques: [{ numeroRubrique: '2515' }, { numeroRubrique: '4110' }] });
    expect(natureDominante(s)).toBe('Toxicité aiguë');
  });

  it('ne dépend pas de l ordre de réponse de l API', () => {
    const a = site({ rubriques: [{ numeroRubrique: '2515' }, { numeroRubrique: '4110' }] });
    const b = site({ rubriques: [{ numeroRubrique: '4110' }, { numeroRubrique: '2515' }] });
    expect(natureDominante(a)).toBe(natureDominante(b));
  });

  it('départage un rang égal par la quantité stockée', () => {
    const s = site({
      rubriques: [
        { numeroRubrique: '4734', quantiteTotale: '10' },
        { numeroRubrique: '4718', quantiteTotale: '900' },
      ],
    });
    // Même famille 47 : le libellé est le même, mais le tri doit rester total
    // pour qu'un réimport ne change pas la couleur du point.
    expect(natureDominante(s)).toBe('GPL et produits pétroliers');
  });

  it('rubriques vides ou absentes → nature non précisée (40 % des sites)', () => {
    expect(natureDominante(site({ rubriques: [] }))).toBe('Nature non précisée');
    expect(natureDominante(site({ rubriques: null }))).toBe('Nature non précisée');
    expect(natureDominante(site({}))).toBe('Nature non précisée');
  });

  it('préfixe hors registre → nature non précisée, sans exception', () => {
    expect(natureDominante(site({ rubriques: [{ numeroRubrique: '9999' }] })))
      .toBe('Nature non précisée');
  });

  it('numéro nul ou trop court est ignoré', () => {
    expect(natureDominante(site({ rubriques: [{ numeroRubrique: null }, { numeroRubrique: '4' }] })))
      .toBe('Nature non précisée');
  });

  it('une quantité non numérique ne fait pas échouer le tri', () => {
    expect(natureDominante(site({ rubriques: [{ numeroRubrique: '4110', quantiteTotale: 'NC' }] })))
      .toBe('Toxicité aiguë');
  });
});

describe('normalisation vers poi_france', () => {
  const brut: SiteIcpeBrut = {
    codeAIOT: '0006400036',
    raisonSociale: 'BRENNTAG MEDITERRANEE',
    adresse1: '  ZI LES ESTROUBLANS ',
    adresse2: 'RUE DE LA MER',
    adresse3: null,
    codePostal: '13127',
    codeInsee: '13117',
    commune: 'Vitrolles',
    longitude: 5.2467,
    latitude: 43.4419,
    regime: 'Autorisation',
    statutSeveso: 'Seveso seuil haut',
    ied: false,
    prioriteNationale: true,
    etatActivite: 'En exploitation avec titre',
    serviceAIOT: 'DREAL PACA',
    siret: '30000000000018',
    codeNaf: '4675Z',
    date_maj: '2026-06-11/15-11-56',
    rubriques: [
      { numeroRubrique: '4110', nature: 'Toxicité aiguë catégorie 1', quantiteTotale: '12.5', unite: 't' },
    ],
    inspections: [{ dateInspection: '2026-04-07' }, { dateInspection: '2025-02-01' }],
  };

  it('pose un id déterministe dérivé du codeAIOT', () => {
    expect(normaliserSiteIcpe(brut)!.id).toBe(identitePoiSourceExterne(SOURCE_ICPE, '0006400036'));
  });

  it('classe la gravité en sous_categorie, la nature en metadata', () => {
    const l = normaliserSiteIcpe(brut)!;
    expect(l.categorie).toBe(CATEGORIE_ICPE);
    expect(l.sous_categorie).toBe('seveso_haut');
    expect(l.metadata.libelle_nature).toBe('Toxicité aiguë');
    expect(l.metadata.natures_risque).toEqual(['Toxicité aiguë']);
  });

  it('recolle et détrime l adresse', () => {
    expect(normaliserSiteIcpe(brut)!.adresse).toBe('ZI LES ESTROUBLANS RUE DE LA MER');
  });

  it('garde la traçabilité de la source et de sa fraîcheur', () => {
    const m = normaliserSiteIcpe(brut)!.metadata;
    expect(m.code_aiot).toBe('0006400036');
    expect(m.date_maj_source).toBe('2026-06-11');
    expect(m.derniere_inspection).toBe('2026-04-07');
    expect(m.nb_inspections).toBe(2);
    expect(m.dreal).toBe('DREAL PACA');
    expect(m.priorite_nationale).toBe(true);
    expect(m.ied).toBe(false);
  });

  it('écarte un site sans coordonnées plutôt que de le poser en (0,0)', () => {
    expect(normaliserSiteIcpe({ ...brut, longitude: null })).toBeNull();
    expect(normaliserSiteIcpe({ ...brut, latitude: null })).toBeNull();
    expect(normaliserSiteIcpe({ ...brut, latitude: Number.NaN })).toBeNull();
  });

  it('écarte un site sans codeAIOT — sans lui, aucune identité stable', () => {
    expect(normaliserSiteIcpe({ ...brut, codeAIOT: '' })).toBeNull();
    expect(normaliserSiteIcpe({ ...brut, codeAIOT: '   ' })).toBeNull();
  });

  it('survit à un site presque vide, comme l API en renvoie', () => {
    const l = normaliserSiteIcpe({
      codeAIOT: '0000000001', raisonSociale: null, longitude: 2.3, latitude: 48.8,
    })!;
    expect(l.nom).toBeNull();
    expect(l.adresse).toBeNull();
    expect(l.sous_categorie).toBe('autre');
    expect(l.metadata.libelle_nature).toBe('Nature non précisée');
    expect(l.metadata.nb_inspections).toBe(0);
  });
});

describe('périmètre : ce qui est une installation classée', () => {
  it('écarte « Non ICPE » — 451 sites sur 1 985 au premier import réel du 13', () => {
    expect(estInstallationClassee(site({ regime: 'Non ICPE' }))).toBe(false);
  });

  it('conserve « Autres régimes » — de vraies ICPE, au régime le plus léger', () => {
    expect(estInstallationClassee(site({ regime: 'Autres régimes' }))).toBe(true);
  });

  it('conserve Autorisation, Enregistrement, et un régime absent', () => {
    expect(estInstallationClassee(site({ regime: 'Autorisation' }))).toBe(true);
    expect(estInstallationClassee(site({ regime: 'Enregistrement' }))).toBe(true);
    expect(estInstallationClassee(site({ regime: null }))).toBe(true);
  });
});

describe('code département déduit du code INSEE', () => {
  it('métropole : deux premiers chiffres', () => {
    expect(codeDepartementDepuisInsee('13117')).toBe('13');
    expect(codeDepartementDepuisInsee('69123')).toBe('69');
    expect(codeDepartementDepuisInsee('01001')).toBe('01');
  });

  it('Corse : 2A et 2B, qui ne sont pas des chiffres', () => {
    expect(codeDepartementDepuisInsee('2A004')).toBe('2A');
    expect(codeDepartementDepuisInsee('2B033')).toBe('2B');
  });

  it('DROM : trois caractères', () => {
    expect(codeDepartementDepuisInsee('97411')).toBe('974');
    expect(codeDepartementDepuisInsee('97101')).toBe('971');
    expect(codeDepartementDepuisInsee('98411')).toBe('984');
  });

  it('rend null sur une entrée inexploitable plutôt qu un code tronqué', () => {
    expect(codeDepartementDepuisInsee(null)).toBeNull();
    expect(codeDepartementDepuisInsee('')).toBeNull();
    expect(codeDepartementDepuisInsee('7')).toBeNull();
  });

  it('les colonnes géographiques sont renseignées dans la ligne produite', () => {
    // Sans elles, /api/map/pois filtre sur code_departement ET departement, et
    // rend ZERO POI sans erreur : les 94 652 sites seraient en base et
    // invisibles. C'est ce qui est arrivé au premier import.
    const geo = {
      nomDepartement: new Map([['13', 'BOUCHES-DU-RHONE']]),
      nomRegion: new Map([['13', "PROVENCE-ALPES-COTE D'AZUR"]]),
    };
    const l = normaliserSiteIcpe(
      { codeAIOT: '1', raisonSociale: 'X', codeInsee: '13117', longitude: 5.2, latitude: 43.4 },
      geo,
    )!;
    expect(l.code_departement).toBe('13');
    expect(l.departement).toBe('BOUCHES-DU-RHONE');
    expect(l.region).toBe("PROVENCE-ALPES-COTE D'AZUR");
  });

  it('sans référentiel, le code reste posé et les noms restent nuls', () => {
    const l = normaliserSiteIcpe(
      { codeAIOT: '1', raisonSociale: 'X', codeInsee: '13117', longitude: 5.2, latitude: 43.4 },
    )!;
    expect(l.code_departement).toBe('13');
    expect(l.departement).toBeNull();
  });
});
