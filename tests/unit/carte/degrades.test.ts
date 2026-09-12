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

  it('donne un libelle francais a chaque degrade, pour le toast', () => {
    const ids: DegradeId[] = [
      'carreaux', 'iris', 'civic-indicateurs', 'civic-sante', 'meteo', 'campagne-impressions',
    ];
    for (const id of ids) expect(libelleDegrade(id).length).toBeGreaterThan(2);
  });
});
