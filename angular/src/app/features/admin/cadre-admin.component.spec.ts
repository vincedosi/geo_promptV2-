import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CadreAdminComponent, MESSAGE_ACCES_REFUSE, MESSAGE_ROLE_ILLISIBLE } from './cadre-admin.component';
import { RoleAdminService, type EtatRoleAdmin } from './etat/role-admin.service';
import { NotificationsService } from '../../ui/notifications/notifications.service';

let constructions = 0;

/** Page enfant factice qui compte ses constructions. */
@Component({ selector: 'mg-enfant-factice', template: '<p data-enfant>page admin</p>' })
class EnfantFactice {
  constructor() {
    constructions++;
  }
}

function roleFactice(etat: EtatRoleAdmin) {
  const s = signal<EtatRoleAdmin>(etat);
  return { etat: s.asReadonly(), _s: s, charger: vi.fn(async () => undefined), reessayer: vi.fn(async () => undefined) };
}

async function monter(etat: EtatRoleAdmin) {
  constructions = 0;
  const role = roleFactice(etat);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: RoleAdminService, useValue: role },
      provideRouter([{ path: 'admin', component: CadreAdminComponent, children: [{ path: 'page', component: EnfantFactice }] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/admin/page');
  await harness.fixture.whenStable();
  return { role, harness, el: harness.fixture.nativeElement as HTMLElement };
}

describe('CadreAdminComponent', () => {
  it("refuse : le message, et AUCUNE page enfant instanciée", async () => {
    const { el } = await monter('refuse');
    expect(el.querySelector('[data-refus]')?.textContent?.trim()).toBe(MESSAGE_ACCES_REFUSE);
    expect(el.querySelector('[data-enfant]')).toBeNull();
    expect(constructions).toBe(0);
  });

  it('super_admin : la page enfant est montée', async () => {
    const { el } = await monter('super_admin');
    expect(el.querySelector('[data-enfant]')).not.toBeNull();
    expect(constructions).toBe(1);
    expect(el.querySelector('[data-refus]')).toBeNull();
  });

  it('chargement : rien, pas même la page', async () => {
    const { el } = await monter('chargement');
    expect(el.querySelector('mg-cadre-admin')?.textContent?.trim()).toBe('');
    expect(constructions).toBe(0);
  });

  it('erreur : le message et un bouton « Réessayer » qui relit le rôle ; la page apparaît une fois le rôle résolu', async () => {
    const { el, role, harness } = await monter('erreur');
    const alerte = el.querySelector('[role="alert"]')!;
    expect(alerte.textContent).toContain(MESSAGE_ROLE_ILLISIBLE);
    const bouton = alerte.querySelector('button')!;
    expect(bouton.textContent?.trim()).toBe('Réessayer');
    expect(bouton.getAttribute('type')).toBe('button');
    bouton.click();
    expect(role.reessayer).toHaveBeenCalledTimes(1);
    expect(constructions).toBe(0);
    role._s.set('super_admin');
    await harness.fixture.whenStable();
    expect(el.querySelector('[data-enfant]')).not.toBeNull();
  });

  it('fournit les notifications aux pages (C7) : rangée collante de 1 px, jamais `fixed`', async () => {
    const { el, harness } = await monter('super_admin');
    const rangee = el.querySelector('mg-cadre-admin > [data-rangee-notifications]') as HTMLElement;
    expect(rangee.className).toContain('sticky');
    expect(rangee.className).toContain('h-px');
    expect(rangee.className).not.toContain('fixed');
    expect(rangee.querySelector('mg-notifications')).not.toBeNull();
    const injecteur = harness.routeDebugElement!.injector;
    const service = injecteur.get(NotificationsService);
    service.info('Bonjour');
    await harness.fixture.whenStable();
    expect(rangee.querySelector('[data-notification]')?.textContent).toContain('Bonjour');
  });

  it('refus et erreur : décalés sous le chrome du haut (réserve T1)', async () => {
    const { el } = await monter('refuse');
    expect(el.querySelector('[data-refus]')!.parentElement!.className).toContain('pt-8');
  });
});
