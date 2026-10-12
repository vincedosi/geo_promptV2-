import { estPropose, rolesAffiches, textesConfirmationRole } from './fiche-utilisateur';

describe('rolesAffiches', () => {
  it('propose Client puis Super admin, jamais Admin', () => {
    expect(rolesAffiches('client')).toEqual(['client', 'super_admin']);
    expect(rolesAffiches('super_admin')).toEqual(['client', 'super_admin']);
  });

  it('garde le rôle ACTUEL `admin` à sa place, sans le proposer aux autres', () => {
    expect(rolesAffiches('admin')).toEqual(['client', 'admin', 'super_admin']);
  });
});

describe('estPropose', () => {
  it('accepte les deux rôles proposés, refuse `admin` et une valeur inconnue', () => {
    expect(estPropose('client')).toBe(true);
    expect(estPropose('super_admin')).toBe(true);
    expect(estPropose('admin')).toBe(false);
    expect(estPropose('root')).toBe(false);
  });
});

describe('textesConfirmationRole', () => {
  it('super_admin → client : retrait, en danger', () => {
    const t = textesConfirmationRole('a@b.fr', 'client', 'super_admin');
    expect(t).toEqual({
      titre: 'Retirer le rôle super-administrateur ?',
      message: 'a@b.fr ne verra plus tous les espaces : il ne gardera que ceux dont il est membre.',
      bouton: 'Retirer le rôle',
      variante: 'danger',
    });
  });

  it('admin → client : perte d\'un rôle qui ne se rend plus ici, en danger', () => {
    const t = textesConfirmationRole('a@b.fr', 'client', 'admin');
    expect(t.titre).toBe('Passer au rôle Client ?');
    expect(t.message).toBe('a@b.fr perd le rôle Admin. Ce rôle n\'est plus attribué depuis cette page : il ne pourra pas lui être rendu ici.');
    expect(t.bouton).toBe('Passer au rôle Client');
    expect(t.variante).toBe('danger');
  });

  it('vers super_admin : nomination, variante par défaut', () => {
    const t = textesConfirmationRole('a@b.fr', 'super_admin', 'client');
    expect(t.titre).toBe('Nommer super-administrateur ?');
    expect(t.variante).toBe('defaut');
  });
});
