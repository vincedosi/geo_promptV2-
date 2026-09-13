/**
 * Verrous sur le cache de tuiles partagé.
 *
 * Les deux premiers blocs testent précisément les deux défauts que ce module
 * remplace : une purge par ordre d'insertion, et une borne en nombre d'entrées
 * qui ne bornait pas la mémoire.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { creerCacheTuiles } from '@/lib/tiles/cache-lru';

const ko = (n: number) => Buffer.alloc(n * 1024, 1);

describe('éviction par usage, pas par insertion', () => {
  it('évince la tuile la moins récemment LUE, pas la plus anciennement écrite', () => {
    const cache = creerCacheTuiles({ budgetOctets: 30 * 1024, ttlMs: 60_000 });

    cache.ecrire('a', ko(10));
    cache.ecrire('b', ko(10));
    cache.ecrire('c', ko(10));

    // `a` est la plus ancienne à l'écriture, mais on vient de la lire.
    expect(cache.lire('a')).not.toBeNull();

    // Écrire `d` force une éviction : c'est `b` qui doit partir, pas `a`.
    cache.ecrire('d', ko(10));

    expect(cache.lire('a'), 'a a été relue, elle doit survivre').not.toBeNull();
    expect(cache.lire('b'), 'b est la moins récemment utilisée').toBeNull();
    expect(cache.lire('c')).not.toBeNull();
    expect(cache.lire('d')).not.toBeNull();
  });

  it('relire une entrée la protège durablement', () => {
    const cache = creerCacheTuiles({ budgetOctets: 20 * 1024, ttlMs: 60_000 });
    cache.ecrire('chaude', ko(10));

    for (let i = 0; i < 10; i++) {
      cache.lire('chaude');
      cache.ecrire(`froide${i}`, ko(10));
    }

    expect(cache.lire('chaude')).not.toBeNull();
  });
});

describe('borne en octets', () => {
  it('respecte le budget quelle que soit la taille des tuiles', () => {
    const cache = creerCacheTuiles({ budgetOctets: 100 * 1024, ttlMs: 60_000 });

    // Une tuile carreaux va de 101 ko a 827 ko : une borne en NOMBRE d'entrees
    // ne bornerait donc rien. Ici, huit tuiles de 30 ko depassent le budget.
    for (let i = 0; i < 8; i++) cache.ecrire(`t${i}`, ko(30));

    expect(cache.etat().octets).toBeLessThanOrEqual(100 * 1024);
    expect(cache.etat().entrees).toBeLessThanOrEqual(3);
  });

  it('le compteur d’octets reste juste après réécriture d’une même clé', () => {
    const cache = creerCacheTuiles({ budgetOctets: 100 * 1024, ttlMs: 60_000 });
    cache.ecrire('t', ko(10));
    cache.ecrire('t', ko(20));
    // Sans le retrait prealable, l'ancienne taille resterait comptee et le
    // budget derivrait a la hausse a chaque reecriture.
    expect(cache.etat().octets).toBe(20 * 1024);
    expect(cache.etat().entrees).toBe(1);
  });

  it('refuse une tuile plus grosse que le budget entier', () => {
    const cache = creerCacheTuiles({ budgetOctets: 50 * 1024, ttlMs: 60_000 });
    cache.ecrire('petite', ko(10));
    cache.ecrire('enorme', ko(80));

    // L'accepter reviendrait a vider le cache pour une seule entree.
    expect(cache.lire('enorme')).toBeNull();
    expect(cache.lire('petite')).not.toBeNull();
  });

  it('le plafond d’entrées borne aussi, pour des tuiles minuscules', () => {
    const cache = creerCacheTuiles({ budgetOctets: 10 * 1024 * 1024, ttlMs: 60_000, maxEntrees: 3 });
    for (let i = 0; i < 10; i++) cache.ecrire(`t${i}`, Buffer.alloc(16, 1));
    expect(cache.etat().entrees).toBe(3);
  });
});

describe('expiration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('une entrée expirée est rendue comme absente et cesse de compter', () => {
    const cache = creerCacheTuiles({ budgetOctets: 100 * 1024, ttlMs: 1000 });
    cache.ecrire('t', ko(10));
    expect(cache.lire('t')).not.toBeNull();

    vi.advanceTimersByTime(1001);

    expect(cache.lire('t')).toBeNull();
    // La lecture doit AUSSI liberer les octets, sinon le budget se remplit
    // d'entrees mortes que plus personne ne lit.
    expect(cache.etat().octets).toBe(0);
    expect(cache.etat().entrees).toBe(0);
  });
});

describe('vider', () => {
  it('remet les deux compteurs à zéro', () => {
    const cache = creerCacheTuiles({ budgetOctets: 100 * 1024, ttlMs: 60_000 });
    cache.ecrire('a', ko(10));
    cache.ecrire('b', ko(10));
    cache.vider();
    expect(cache.etat()).toEqual({ entrees: 0, octets: 0 });
    expect(cache.lire('a')).toBeNull();
  });
});
