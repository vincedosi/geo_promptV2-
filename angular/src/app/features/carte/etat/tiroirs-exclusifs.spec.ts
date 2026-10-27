import { computed } from '@angular/core';
import { TiroirsExclusifs } from './tiroirs-exclusifs';

describe('TiroirsExclusifs (retours du 26/10, T7)', () => {
  it('initial : le tiroir donné est ouvert, et déjà vu ; `null` : tout est fermé', () => {
    const t = new TiroirsExclusifs<'a' | 'b'>('a');
    expect(t.ouvert()).toBe('a');
    expect(t.estOuvert('a')).toBe(true);
    expect(t.dejaOuvert('a')).toBe(true);
    expect(t.dejaOuvert('b')).toBe(false);
    expect(new TiroirsExclusifs<'a'>(null).ouvert()).toBeNull();
  });

  it('basculer : ouvre, puis referme le même', () => {
    const t = new TiroirsExclusifs<'a' | 'b'>(null);
    t.basculer('a');
    expect(t.ouvert()).toBe('a');
    t.basculer('a');
    expect(t.ouvert()).toBeNull();
  });

  it('ouvrir B referme A', () => {
    const t = new TiroirsExclusifs<'a' | 'b'>('a');
    t.basculer('b');
    expect(t.estOuvert('a')).toBe(false);
    expect(t.estOuvert('b')).toBe(true);
    t.ouvrir('a');
    expect(t.ouvert()).toBe('a');
  });

  it('dejaOuvert reste vrai après la fermeture (patron « monté puis caché »)', () => {
    const t = new TiroirsExclusifs<'a' | 'b'>(null);
    t.ouvrir('b');
    t.fermer();
    expect(t.ouvert()).toBeNull();
    expect(t.dejaOuvert('b')).toBe(true);
    expect(t.dejaOuvert('a')).toBe(false);
  });

  it('réactif : un computed qui lit estOuvert / dejaOuvert suit les changements', () => {
    const t = new TiroirsExclusifs<'a' | 'b'>(null);
    const vue = computed(() => `${t.estOuvert('a')}-${t.dejaOuvert('b')}`);
    expect(vue()).toBe('false-false');
    t.ouvrir('a');
    expect(vue()).toBe('true-false');
    t.ouvrir('b');
    expect(vue()).toBe('false-true');
  });
});
