import { ApplicationRef, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../core/auth/auth.service';
import { RoleAdminService } from './role-admin.service';

type Profil = { role: string | null; nom: string | null } | null;

function monter(role: string | null | 'echec' = 'super_admin', id = 'u1') {
  const session = signal<{ user: { id: string } } | null>({ user: { id } });
  let reponse: Profil | 'echec' = role === 'echec' ? 'echec' : { role, nom: 'Nom' };
  const lireProfil = vi.fn(async (): Promise<Profil> => (reponse === 'echec' ? null : reponse));
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), RoleAdminService, { provide: AuthService, useValue: { session, lireProfil } }],
  });
  return {
    service: TestBed.inject(RoleAdminService),
    session,
    lireProfil,
    repondre: (r: Profil | 'echec') => (reponse = r),
  };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('RoleAdminService', () => {
  it('super_admin → super_admin', async () => {
    const { service } = monter('super_admin');
    expect(service.etat()).toBe('chargement');
    await service.charger();
    expect(service.etat()).toBe('super_admin');
  });

  it('client → refuse ; admin → refuse (requireAdmin = super_admin strict) ; profil sans rôle → refuse', async () => {
    for (const role of ['client', 'admin', null]) {
      TestBed.resetTestingModule();
      const { service } = monter(role);
      await service.charger();
      expect(service.etat()).toBe('refuse');
    }
  });

  it('lecture en échec → erreur, et reessayer() relit', async () => {
    const { service, lireProfil, repondre } = monter('echec');
    await service.charger();
    expect(service.etat()).toBe('erreur');
    // charger() reste idempotent pour la même session : pas de relecture implicite.
    await service.charger();
    expect(lireProfil).toHaveBeenCalledTimes(1);
    repondre({ role: 'super_admin', nom: null });
    await service.reessayer();
    expect(lireProfil).toHaveBeenCalledTimes(2);
    expect(service.etat()).toBe('super_admin');
  });

  it('une lecture qui lève → erreur', async () => {
    const { service, lireProfil } = monter('super_admin');
    lireProfil.mockRejectedValueOnce(new Error('réseau'));
    await service.charger();
    expect(service.etat()).toBe('erreur');
  });

  it('deux charger() simultanés → une seule lecture', async () => {
    const { service, lireProfil } = monter('super_admin');
    await Promise.all([service.charger(), service.charger(), service.reessayer()]);
    expect(lireProfil).toHaveBeenCalledTimes(1);
    expect(service.etat()).toBe('super_admin');
  });

  it("changement d'identifiant de session → relecture ; même identifiant (jeton rafraîchi) → aucune", async () => {
    const { service, session, lireProfil, repondre } = monter('super_admin', 'u1');
    await service.charger();
    session.set({ user: { id: 'u1' } });
    TestBed.inject(ApplicationRef).tick();
    await attendre();
    expect(lireProfil).toHaveBeenCalledTimes(1);

    repondre({ role: 'client', nom: null });
    session.set({ user: { id: 'u2' } });
    TestBed.inject(ApplicationRef).tick();
    await attendre();
    expect(lireProfil).toHaveBeenCalledTimes(2);
    expect(service.etat()).toBe('refuse');
  });

  it("sans session : rien n'est lu, l'état reste « chargement »", async () => {
    const { service, session, lireProfil } = monter('super_admin');
    session.set(null);
    await service.charger();
    expect(lireProfil).not.toHaveBeenCalled();
    expect(service.etat()).toBe('chargement');
  });

  it("une lecture dépassée par un changement de session n'écrit pas son résultat", async () => {
    const { service, session, lireProfil } = monter('super_admin', 'u1');
    let libere!: (p: Profil) => void;
    lireProfil.mockImplementationOnce(() => new Promise<Profil>((r) => (libere = r)));
    const premiere = service.charger();
    lireProfil.mockImplementationOnce(async () => ({ role: 'client', nom: null }));
    session.set({ user: { id: 'u2' } });
    await service.charger();
    expect(service.etat()).toBe('refuse');
    libere({ role: 'super_admin', nom: null });
    await premiere;
    expect(service.etat()).toBe('refuse');
  });
});
