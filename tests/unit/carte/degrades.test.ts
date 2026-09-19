import { describe, it, expect } from 'vitest';
import { activerDegrade, libelleDegrade, type DegradeId } from '@/lib/carte/degrades';

describe('exclusivite des degrades de couleur', () => {
  it('activer un degrade eteint le precedent', () => {
    expect(activerDegrade('carreaux', 'iris')).toEqual({ actif: 'iris', eteint: 'carreaux' });
  });

  it('n eteint rien quand aucun degrade n etait actif', () => {
    expect(activerDegrade(null, 'iris')).toEqual({ actif: 'iris', eteint: null });
  });

  it('re-activer le degrade courant l eteint', () => {
    expect(activerDegrade('iris', 'iris')).toEqual({ actif: null, eteint: 'iris' });
  });

  it('les impressions de campagne excluent les donnees INSEE, et l inverse', () => {
    expect(activerDegrade('campagne-impressions', 'carreaux').eteint).toBe('campagne-impressions');
    expect(activerDegrade('carreaux', 'campagne-impressions').eteint).toBe('carreaux');
  });

  it('la carte Diffusion (Tache 13B) exclut aussi les six autres, et l inverse', () => {
    expect(activerDegrade('diffusion', 'iris').eteint).toBe('diffusion');
    expect(activerDegrade('score', 'diffusion').eteint).toBe('score');
  });

  it('donne le libelle francais exact de chaque degrade', () => {
    expect(libelleDegrade('carreaux')).toBe('Carreaux Filosofi');
    expect(libelleDegrade('iris')).toBe('IRIS');
    expect(libelleDegrade('civic-indicateurs')).toBe('Indicateurs civiques');
    expect(libelleDegrade('civic-sante')).toBe('Santé environnementale');
    expect(libelleDegrade('meteo')).toBe('Météo');
    expect(libelleDegrade('campagne-impressions')).toBe('Impressions de la campagne');
    expect(libelleDegrade('diffusion')).toBe('Diffusion campagne');
  });
});
