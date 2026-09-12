import { describe, it, expect } from 'vitest';
import { validerDegradeId, basculerDegrade } from '@/lib/carte/calques-actifs';

describe('validerDegradeId — validation a la frontiere', () => {
  it('accepte les six valeurs connues', () => {
    expect(validerDegradeId('carreaux')).toBe('carreaux');
    expect(validerDegradeId('iris')).toBe('iris');
    expect(validerDegradeId('civic-indicateurs')).toBe('civic-indicateurs');
    expect(validerDegradeId('civic-sante')).toBe('civic-sante');
    expect(validerDegradeId('meteo')).toBe('meteo');
    expect(validerDegradeId('campagne-impressions')).toBe('campagne-impressions');
  });

  it('rejette une valeur perimee ou corrompue', () => {
    expect(validerDegradeId('carreau')).toBeNull();
    expect(validerDegradeId('')).toBeNull();
    expect(validerDegradeId('CARREAUX')).toBeNull();
  });

  it('rejette tout ce qui n est pas une chaine', () => {
    expect(validerDegradeId(null)).toBeNull();
    expect(validerDegradeId(undefined)).toBeNull();
    expect(validerDegradeId(42)).toBeNull();
    expect(validerDegradeId({ id: 'carreaux' })).toBeNull();
    expect(validerDegradeId(['carreaux'])).toBeNull();
  });
});

describe('basculerDegrade — bascule visibilite d un calque a degrade', () => {
  it('active la cible et evince l ancien degrade actif', () => {
    expect(basculerDegrade('iris', 'carreaux', true)).toEqual({ degradeActif: 'carreaux', aEteindre: 'iris' });
  });

  it('active sans rien eteindre quand aucun degrade n etait actif', () => {
    expect(basculerDegrade(null, 'meteo', true)).toEqual({ degradeActif: 'meteo', aEteindre: null });
  });

  it('reactiver la cible deja active la LAISSE active (jamais un toggle-off)', () => {
    expect(basculerDegrade('carreaux', 'carreaux', true)).toEqual({ degradeActif: 'carreaux', aEteindre: null });
  });

  it('desactive la cible sans toucher a un autre degrade', () => {
    expect(basculerDegrade('carreaux', 'carreaux', false)).toEqual({ degradeActif: null, aEteindre: null });
  });

  it('desactiver une cible qui n etait pas le degrade actif ne fait rien', () => {
    expect(basculerDegrade('iris', 'carreaux', false)).toEqual({ degradeActif: 'iris', aEteindre: null });
  });

  it('desactiver sans aucun degrade actif reste a null', () => {
    expect(basculerDegrade(null, 'meteo', false)).toEqual({ degradeActif: null, aEteindre: null });
  });
});
