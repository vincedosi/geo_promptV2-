import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DUREE_NOTIFICATION, DUREE_SORTIE, MAX_NOTIFICATIONS, NotificationsService } from './notifications.service';

/** Le service est fourni par un composant (le cadre admin) : on le reproduit. */
@Component({ template: '', providers: [NotificationsService] })
class Porteur { readonly service = inject(NotificationsService); }

function creer() {
  const f = TestBed.createComponent(Porteur);
  return { f, s: f.componentInstance.service };
}

describe('NotificationsService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reprend les valeurs de geo-toast.tsx : 4 s, sortie 280 ms, 3 au plus', () => {
    expect(DUREE_NOTIFICATION).toBe(4000);
    expect(DUREE_SORTIE).toBe(280);
    expect(MAX_NOTIFICATIONS).toBe(3);
  });

  it('pousse les quatre variantes, avec titre et message', () => {
    const { s } = creer();
    s.success('Ok', 'tout va bien');
    s.error('Erreur');
    s.warning('Attention');
    expect(s.notifications().map((n) => n.variante)).toEqual(['success', 'error', 'warning']);
    expect(s.notifications()[0].message).toBe('tout va bien');
    expect(s.notifications()[1].message).toBeUndefined();
    s.info('Info');
    expect(s.notifications().map((n) => n.variante)).toEqual(['error', 'warning', 'info']);
  });

  it('retire une notification 4 s après, par une sortie animée de 280 ms', () => {
    const { s } = creer();
    s.success('Ok');
    vi.advanceTimersByTime(DUREE_NOTIFICATION - 1);
    expect(s.notifications()).toHaveLength(1);
    expect(s.notifications()[0].sortie).toBeFalsy();
    vi.advanceTimersByTime(1);
    expect(s.notifications()[0].sortie).toBe(true);
    vi.advanceTimersByTime(DUREE_SORTIE);
    expect(s.notifications()).toHaveLength(0);
  });

  it('une quatrième poussée fait disparaître la plus ancienne, sans attendre', () => {
    const { s } = creer();
    s.info('un'); s.info('deux'); s.info('trois'); s.info('quatre');
    expect(s.notifications().map((n) => n.titre)).toEqual(['deux', 'trois', 'quatre']);
  });

  it('retirer(id) lance la sortie puis retire', () => {
    const { s } = creer();
    s.info('un');
    const id = s.notifications()[0].id;
    s.retirer(id);
    expect(s.notifications()[0].sortie).toBe(true);
    vi.advanceTimersByTime(DUREE_SORTIE);
    expect(s.notifications()).toHaveLength(0);
  });

  it('à la destruction du porteur, plus aucune minuterie ne reste', () => {
    const { f, s } = creer();
    s.info('un'); s.warning('deux');
    s.retirer(s.notifications()[0].id);
    const avant = s.notifications();
    f.destroy();
    // Si une minuterie avait survécu, elle aurait retiré ou fait sortir une notification.
    vi.advanceTimersByTime(DUREE_NOTIFICATION * 3);
    expect(s.notifications()).toBe(avant);
    expect(s.notifications()).toHaveLength(2);
  });
});
