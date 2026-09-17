import { describe, it, expect } from 'vitest';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';

/**
 * Le registre des familles de rubriques ICPE est la seule chose qui traduit un
 * numéro de rubrique en nature de risque lisible. S'il perd une famille, les
 * sites concernés basculent en « Nature non précisée » — sans erreur, sans
 * alerte, et le filtre carte devient muet sur eux. D'où ces trois verrous.
 */
describe('registre des familles de rubriques ICPE', () => {
  it('couvre les familles réellement mesurées sur la source le 2026-09-17', () => {
    // Relevé par appels réels sur 400 sites du département 13 : ces préfixes
    // existent dans la donnée, le registre doit donc les nommer.
    const mesurees = ['41', '43', '45', '47', '14', '15', '27', '34', '35', '29', '25', '26', '22', '11'];
    const connus = new Set(FAMILLES_ICPE_SEED.map((f) => f.prefixe));
    expect(mesurees.filter((p) => !connus.has(p))).toEqual([]);
  });

  it('classe le toxique et l inflammable au-dessus des matériaux', () => {
    const rang = (p: string) => FAMILLES_ICPE_SEED.find((f) => f.prefixe === p)!.rang_gravite;
    // C'est ce rang qui départage la nature dominante d'un site qui porte les
    // deux : un dépôt pétrolier qui concasse aussi de la pierre doit ressortir
    // comme pétrolier, pas comme carrière.
    expect(rang('41')).toBeGreaterThan(rang('25'));
    expect(rang('47')).toBeGreaterThan(rang('29'));
    expect(rang('43')).toBeGreaterThan(rang('26'));
  });

  it('ne déclare aucun rang en double — sinon la dominante ne serait pas déterministe', () => {
    const rangs = FAMILLES_ICPE_SEED.map((f) => f.rang_gravite);
    expect(new Set(rangs).size).toBe(rangs.length);
  });

  it('ne déclare aucun préfixe en double, et tous sur deux caractères', () => {
    const prefixes = FAMILLES_ICPE_SEED.map((f) => f.prefixe);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.filter((p) => !/^\d{2}$/.test(p))).toEqual([]);
  });

  it('expose un libellé de repli non vide', () => {
    // Il part dans `metadata.libelle_nature`, que le filtre carte interroge par
    // `.in()` : une chaîne vide y rendrait les sites sans rubrique inatteignables.
    expect(NATURE_NON_PRECISEE.trim().length).toBeGreaterThan(0);
    expect(FAMILLES_ICPE_SEED.map((f) => f.libelle)).not.toContain(NATURE_NON_PRECISEE);
  });
});
