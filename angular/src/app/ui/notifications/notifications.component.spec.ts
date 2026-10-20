import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotificationsComponent } from './notifications.component';
import { DUREE_NOTIFICATION, DUREE_SORTIE, NotificationsService } from './notifications.service';

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
  describe('pile en popover (vague finale A2, A4, A5)', () => {
    let montrer: ReturnType<typeof vi.fn>;
    let cacher: ReturnType<typeof vi.fn>;
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const avant = { show: proto['showPopover'], hide: proto['hidePopover'] };

    beforeEach(() => {
      montrer = vi.fn();
      cacher = vi.fn();
      // jsdom ne connaît pas l'API popover : on la double.
      proto['showPopover'] = montrer;
      proto['hidePopover'] = cacher;
    });
    afterEach(() => {
      proto['showPopover'] = avant.show;
      proto['hidePopover'] = avant.hide;
    });

    it("l'hôte est un popover manuel, transparent aux clics hors des cartes", async () => {
      const f = TestBed.createComponent(Hote);
      await f.whenStable();
      const hote = (f.nativeElement as HTMLElement).querySelector('mg-notifications') as HTMLElement;
      expect(hote.getAttribute('popover')).toBe('manual');
      expect(hote.classList).not.toContain('block');
      expect(hote.hasAttribute('data-pile-notifications')).toBe(true);
    });

    it("chaque poussée réaffiche la pile (cacher puis montrer) pour repasser au-dessus d'un modal ouvert après elle", async () => {
      const f = TestBed.createComponent(Hote);
      const s = f.componentInstance.service;
      await f.whenStable();
      expect(montrer).not.toHaveBeenCalled();
      s.info('Un');
      await f.whenStable();
      expect(montrer).toHaveBeenCalledTimes(1);
      s.error('Deux');
      await f.whenStable();
      expect(montrer).toHaveBeenCalledTimes(2);
      expect(cacher).toHaveBeenCalledTimes(1);
      const hote = (f.nativeElement as HTMLElement).querySelector('mg-notifications');
      expect(montrer.mock.contexts[1]).toBe(hote);
    });

    it('la pile vide se referme', async () => {
      const f = TestBed.createComponent(Hote);
      const s = f.componentInstance.service;
      s.info('Un');
      await f.whenStable();
      (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-notification] button')!.click();
      await new Promise((r) => setTimeout(r, DUREE_SORTIE + 30));
      await f.whenStable();
      expect(cacher).toHaveBeenCalledTimes(1);
    });

    it('la durée de la barre de temps vient de DUREE_NOTIFICATION', async () => {
      const f = TestBed.createComponent(Hote);
      await f.whenStable();
      const zone = (f.nativeElement as HTMLElement).querySelector('[role="status"]') as HTMLElement;
      expect(zone.style.getPropertyValue('--duree')).toBe(`${DUREE_NOTIFICATION}ms`);
    });
  });
});
