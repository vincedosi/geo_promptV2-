/**
 * Les deux rapports du bandeau KPI.
 *
 * Écrits après avoir vu l'écran réel afficher **32,4 %** dans les deux cases,
 * sous « part du territoire étudié » et « taux d'utile » — le chiffre que le
 * brief désigne comme le plus important de l'écran, et qui ne disait alors
 * rien de plus que celui d'à côté.
 *
 * Les valeurs des tests sont MESURÉES (2026-09-21, base locale, profil
 * `h1000.2000.7000_b500.1000`), jamais inventées : 20 674 572 exposés,
 * 63 783 569 de référence, 30 853 690 dans les communes touchées.
 */
import { describe, it, expect } from 'vitest';
import { partExposee, tauxUtile } from '@/lib/risques/kpi';

const TOTAL = 20_674_572;
const REFERENCE = 63_783_569;
const TOUCHEES_COMMUNE = 30_853_690;

describe('partExposee', () => {
  it('rend la part mesuree, a une decimale', () => {
    expect(partExposee(TOTAL, REFERENCE)).toBe(32.4);
  });

  it('rend null sans denominateur, jamais zero', () => {
    // Zéro se lirait « personne n'est exposé ». Le tiret se lit « on ne sait
    // pas rapporter » — ce qui est le cas à la maille code postal, dont le
    // seul référentiel surcompte de 10,5 %.
    expect(partExposee(TOTAL, null)).toBeNull();
    expect(partExposee(TOTAL, 0)).toBeNull();
  });
});

describe('tauxUtile', () => {
  it('rend la dilution mesuree a la maille commune', () => {
    expect(tauxUtile(TOTAL, TOUCHEES_COMMUNE, REFERENCE)).toBe(67);
  });

  it('rend null quand TOUTES les unites sont touchees', () => {
    // Maille région, France entière : les 18 régions sont touchées, donc la
    // population des unités touchées EST la référence. Le rapport vaudrait
    // 32,4 %, exactement la part affichée juste à côté.
    expect(tauxUtile(TOTAL, REFERENCE, REFERENCE)).toBeNull();
  });

  it('rend null si les unites touchees DEPASSENT la reference', () => {
    // Deux agrégats arrondis séparément peuvent se croiser d'une unité. Le
    // dépassement ne veut rien dire de plus que l'égalité : aucune unité n'est
    // laissée de côté, donc il n'y a pas de dilution à montrer.
    expect(tauxUtile(TOTAL, REFERENCE + 1, REFERENCE)).toBeNull();
  });

  it('rend null quand les deux se confondent A L AFFICHAGE', () => {
    /*
     * Mesuré le 2026-09-21 à la maille département : 22,1 % et 22,1 % côte à
     * côte sous deux libellés différents. Presque toutes les unités sont
     * touchées, donc le dénominateur ne diffère que de quelques dizaines de
     * milliers d'habitants sur 63,8 millions — l'égalité exacte ne voyait
     * rien. La comparaison se fait à la précision AFFICHÉE, une décimale : si
     * l'écran ne sait pas les distinguer, le second n'apprend rien.
     */
    const presqueTout = Math.round(REFERENCE * 0.999);
    expect(tauxUtile(TOTAL, presqueTout, REFERENCE)).toBeNull();
  });

  it('calcule des que l ecart est visible a une decimale', () => {
    // La contrepartie : on ne masque QUE ce qui est indistinguable. Un écart
    // d'un dixième de point reste un écart, et il s'affiche.
    const ecarte = Math.round(REFERENCE * 0.99);
    const taux = tauxUtile(TOTAL, ecarte, REFERENCE);
    expect(taux).not.toBeNull();
    expect(taux).not.toBe(partExposee(TOTAL, REFERENCE));
  });

  it('calcule quand meme si la reference est inconnue', () => {
    // La dégénérescence ne se constate QUE par comparaison. Sans référence, on
    // rend le rapport plutôt qu'un tiret : il reste juste, il est seulement
    // impossible de dire s'il apprend quelque chose.
    expect(tauxUtile(TOTAL, TOUCHEES_COMMUNE, null)).toBe(67);
  });

  it('rend null sans denominateur — maille code postal', () => {
    expect(tauxUtile(TOTAL, null, REFERENCE)).toBeNull();
    expect(tauxUtile(TOTAL, 0, REFERENCE)).toBeNull();
  });

  it('ne confond jamais les deux rapports sur un cas mesure', () => {
    // Le garde-fou du défaut lui-même : sur la maille commune, les deux
    // nombres DOIVENT différer.
    expect(tauxUtile(TOTAL, TOUCHEES_COMMUNE, REFERENCE))
      .not.toBe(partExposee(TOTAL, REFERENCE));
  });
});
