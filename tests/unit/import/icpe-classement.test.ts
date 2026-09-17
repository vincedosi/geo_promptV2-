import { describe, it, expect } from 'vitest';
import {
  graviteIcpe,
  natureDominante,
  naturesDuSite,
  normaliserSiteIcpe,
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
