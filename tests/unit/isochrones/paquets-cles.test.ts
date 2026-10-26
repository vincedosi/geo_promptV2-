import { describe, it, expect } from 'vitest';
import { paquetsDeCles } from '@/lib/isochrones/paquets-cles';

const cle = (i: number) => `battle__risque_industriel__3f2504e0_4f89_11d3_9a0c_0305e82c${String(i).padStart(4, '0')}__60min__drive`;

describe('paquetsDeCles', () => {
  it('toutes les clés, dans l ordre, une seule fois', () => {
    const cles = Array.from({ length: 3500 }, (_, i) => cle(i));
    const paquets = paquetsDeCles(cles);
    expect(paquets.flat()).toEqual(cles);
  });

  it('chaque paquet reste sous les 100 clés de 97 caractères mesurées acceptées par Kong', () => {
    const paquets = paquetsDeCles(Array.from({ length: 3500 }, (_, i) => cle(i)));
    expect(Math.max(...paquets.map((p) => p.length))).toBeLessThanOrEqual(100);
    expect(Math.max(...paquets.map((p) => p.join(',').length))).toBeLessThan(9_700);
  });

  it('liste vide : aucun paquet ; une clé plus longue que le budget forme son propre paquet', () => {
    expect(paquetsDeCles([])).toEqual([]);
    expect(paquetsDeCles(['a'.repeat(50), 'b'], 10)).toEqual([['a'.repeat(50)], ['b']]);
  });
});
