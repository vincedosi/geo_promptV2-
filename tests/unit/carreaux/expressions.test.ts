import { describe, it, expect } from 'vitest';
import { bornesInternes, donneeExploitableExpr, COULEUR_DONNEE_ABSENTE } from '@/lib/carreaux/expressions';
import { CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';
import { palierEchelle } from '@/lib/carreaux/bornes';

describe('bornesInternes', () => {
  it('produit n-1 frontieres pour n classes', () => {
    expect(bornesInternes({ min: 0, max: 6 }, 6)).toHaveLength(5);
  });

  it('donne des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    const b = bornesInternes({ min: 0.3464, max: 3.4157 }, 6);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
  });

  it('coincide exactement avec le decoupage de la legende', () => {
    const bornes = { min: 0.3464, max: 3.4157 };
    const internes = bornesInternes(bornes, 6);
    // La frontiere k separe le palier k-1 du palier k : c'est le max de l'un
    // et le min de l'autre. C'est cette egalite qui rend la pastille honnete.
    for (let k = 1; k < 6; k++) {
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k - 1, 6).max, 10);
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k, 6).min, 10);
    }
  });
});

describe('donneeExploitableExpr', () => {
  it('exige la presence des DEUX proprietes, pas seulement de l indicateur', () => {
    const e = donneeExploitableExpr('population_totale', 'superficie_km2');
    const s = JSON.stringify(e);
    expect(s).toContain('"has","population_totale"');
    expect(s).toContain('"has","superficie_km2"');
  });

  it('traite un denominateur nul comme une absence', () => {
    // On ne peut pas plus calculer une densite sur une surface nulle que sur
    // une surface inconnue — les deux doivent dire « je ne sais pas ».
    const e = donneeExploitableExpr('population_totale', 'superficie_km2');
    expect(JSON.stringify(e)).toContain('[">",["to-number",["get","superficie_km2"],0],0]');
  });

  it('combine les conditions en ET, jamais en OU', () => {
    // Un OU laisserait passer une superficie absente des lors que l'indicateur
    // est present — precisement le cas qui multiplie la densite par 10 000.
    expect(donneeExploitableExpr('revenu_median', 'population_totale')[0]).toBe('all');
  });

  it('suit le denominateur reel de l indicateur, qui n est pas toujours la superficie', () => {
    const e = donneeExploitableExpr('revenu_median', 'population_totale');
    expect(JSON.stringify(e)).toContain('"has","population_totale"');
    expect(JSON.stringify(e)).not.toContain('superficie_km2');
  });

  it('expose une couleur d absence hors palette', () => {
    // Elle ne doit se confondre avec aucune teinte de l echelle.
    const toutesLesTeintes = CARREAUX_PALETTES.flatMap(p => p.stops.map(c => c.toLowerCase()));
    expect(toutesLesTeintes).not.toContain(COULEUR_DONNEE_ABSENTE.toLowerCase());
  });
});
