import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotificationsComponent } from './notifications.component';
import { DUREE_SORTIE, NotificationsService } from './notifications.service';

@Component({
  imports: [NotificationsComponent],
  providers: [NotificationsService],
  template: '<mg-notifications />',
})
class Hote { readonly service = inject(NotificationsService); }

describe('NotificationsComponent', () => {
  it('annonce poliment et rend une carte par notification, 3 au plus', async () => {
    const f = TestBed.createComponent(Hote);
    const s = f.componentInstance.service;
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const zone = el.querySelector('[role="status"]')!;
    expect(zone.getAttribute('aria-live')).toBe('polite');
    s.success('Un'); s.error('Deux', 'détail'); s.warning('Trois'); s.info('Quatre');
    await f.whenStable();
    const cartes = el.querySelectorAll('[data-notification]');
    expect(cartes).toHaveLength(3);
    expect(cartes[0].textContent).toContain('Deux');
    expect(cartes[0].textContent).toContain('détail');
    expect(cartes[2].getAttribute('data-variante')).toBe('info');
  });

  it('la croix retire la carte après la sortie animée', async () => {
    const f = TestBed.createComponent(Hote);
    const s = f.componentInstance.service;
    s.warning('Attention');
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    (el.querySelector('[data-notification] button') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelector('[data-notification]')!.classList).toContain('sortie');
    // Vraie attente : des minuteries factices bloqueraient le planificateur sans zone de whenStable.
    await new Promise((r) => setTimeout(r, DUREE_SORTIE + 30));
    await f.whenStable();
    expect(el.querySelector('[data-notification]')).toBeNull();
  });

  it('chaque variante porte son icône (geo-toast.tsx : Check, X, AlertTriangle, Info)', async () => {
    const f = TestBed.createComponent(Hote);
    const s = f.componentInstance.service;
    s.success('a'); s.error('b'); s.warning('c');
    await f.whenStable();
    const noms = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-notification] mg-icone[data-role="variante"]'))
      .map((i) => i.getAttribute('data-nom'));
    expect(noms).toEqual(['coche', 'croix', 'triangle-alerte']);
  });
});
