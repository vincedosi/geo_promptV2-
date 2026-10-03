import { TestBed } from '@angular/core/testing';
import type { CompteSites } from '../../data/sites-risque.api';
import { MESSAGE_AUCUN_SITE, PanneauSitesComponent } from './panneau-sites.component';

/** La réponse MESURÉE de `/api/risques/sites/compter` sur la base locale, état par défaut (2026-10-04). */
const PAR_NATURE_MESURE: Record<string, number> = {
  'Déchets': 45, 'Explosibles': 79, 'Chimie (IED)': 4, 'Déchets (IED)': 3, 'Toxicité aiguë': 502,
  'Fluides frigorigènes': 1, 'Nature non précisée': 12, 'Entrepôts et stockages': 2,
  'Agroalimentaire et divers': 1, 'GPL et produits pétroliers': 485, 'Gaz et liquides inflammables': 50,
  'Combustion et refroidissement': 4, 'Dangereux pour le milieu aquatique': 25,
  'Inflammables (ancienne nomenclature)': 46,
};
const MESURE: CompteSites = { retenus: 1259, total: 1259, par_nature: PAR_NATURE_MESURE };

/** Séparateur de milliers fr-FR : espace insécable étroite, comme React. */
const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').trim();

async function rendre(compte: CompteSites | null, chargement = false, libelleTerritoire = 'la France entière') {
  const f = TestBed.createComponent(PanneauSitesComponent);
  f.componentRef.setInput('compte', compte);
  f.componentRef.setInput('chargement', chargement);
  f.componentRef.setInput('libelleTerritoire', libelleTerritoire);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('PanneauSitesComponent', () => {
  it('la réponse mesurée : KPI 1 259 / 1 259 en accent, et sa note sur le même territoire', async () => {
    const el = await rendre(MESURE);
    const kpi = el.querySelector('mg-kpi')!;
    expect(n(kpi.querySelector('[data-role="valeur"]')?.textContent)).toBe('1 259 / 1 259');
    expect(kpi.querySelector('[data-role="valeur"]')!.classList).toContain('text-teal');
    expect(kpi.querySelector('[data-role="valeur"]')!.classList).toContain('text-[22px]');
    expect(kpi.querySelector('[data-role="libelle"]')?.textContent?.trim()).toBe('sites retenus');
    expect(kpi.textContent).toContain('sur la France entière — le total porte le même territoire');
  });

  it('14 natures mesurées → 7 segments + « Autres natures », largeurs sur les EFFECTIFS, somme = 100 %', async () => {
    const el = await rendre(MESURE);
    const barre = el.querySelector('[role="img"]')!;
    expect(n(barre.getAttribute('aria-label'))).toBe('Répartition des 1 259 sites par nature de risque');
    const segments = [...barre.querySelectorAll<HTMLElement>('span')];
    expect(segments).toHaveLength(8);
    const largeurs = segments.map((s) => parseFloat(s.style.width));
    expect(largeurs.reduce((t, l) => t + l, 0)).toBeCloseTo(100, 9);
    // Toxicité aiguë : 502 / 1 259, jamais la part arrondie 39,9 %.
    expect(largeurs[0]).toBeCloseTo((502 / 1259) * 100, 9);
    // Teintes en jetons dans le DOM, la dernière réservée au regroupement.
    expect(segments[0].style.background).toBe('var(--nature-1)');
    expect(segments[7].style.background).toBe('var(--nature-8)');
    expect(n(segments[0].getAttribute('title'))).toBe('Toxicité aiguë — 502 sites (39,9 %)');

    const lignes = [...el.querySelectorAll('[data-role="nature"]')].map((l) => ({
      libelle: l.querySelector('[data-role="libelle-nature"]')?.textContent?.trim(),
      pct: n(l.querySelector('[data-role="pct"]')?.textContent),
      n: n(l.querySelector('[data-role="n"]')?.textContent),
    }));
    expect(lignes).toEqual([
      { libelle: 'Toxicité aiguë', pct: '39,9 %', n: '502' },
      { libelle: 'GPL et produits pétroliers', pct: '38,5 %', n: '485' },
      { libelle: 'Explosibles', pct: '6,3 %', n: '79' },
      { libelle: 'Gaz et liquides inflammables', pct: '4,0 %', n: '50' },
      { libelle: 'Inflammables (ancienne nomenclature)', pct: '3,7 %', n: '46' },
      { libelle: 'Déchets', pct: '3,6 %', n: '45' },
      { libelle: 'Dangereux pour le milieu aquatique', pct: '2,0 %', n: '25' },
      { libelle: 'Autres natures', pct: '2,1 %', n: '27' },
    ]);
    // Aucun écart entre la somme des natures et les sites retenus : pas d'avertissement.
    expect(el.textContent).not.toContain('la barre ne couvre pas exactement');
    // Le regroupement est expliqué.
    expect(el.textContent).toContain('au-delà de huit teintes, deux natures se ressembleraient');
  });

  it('aucun site retenu : l’avertissement MOT POUR MOT, et aucune barre', async () => {
    const el = await rendre({ retenus: 0, total: 1259, par_nature: {} });
    const p = [...el.querySelectorAll('p')].find((x) => x.textContent?.includes('Aucun site'));
    expect(p?.textContent?.replace(/\s+/g, ' ').trim()).toBe(MESSAGE_AUCUN_SITE);
    expect(MESSAGE_AUCUN_SITE).toBe('Aucun site ne passe les filtres. Tout l’écran sera vide — ce n’est pas une absence de population exposée, c’est une absence de site à exposer.');
    expect(p!.classList).toContain('text-warning');
    expect(n(el.querySelector('[data-role="valeur"]')?.textContent)).toBe('0 / 1 259');
    expect(el.querySelector('[role="img"]')).toBeNull();
  });

  it('pendant le comptage : un message, jamais un zéro', async () => {
    const el = await rendre(MESURE, true);
    expect(el.textContent?.trim()).toBe('Comptage des sites…');
    expect(el.querySelector('mg-kpi')).toBeNull();
  });

  it('comptage en échec : il le dit, sans chiffre', async () => {
    const el = await rendre(null);
    expect(el.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Le comptage des sites n’a pas abouti. Les autres étapes restent utilisables : ce panneau ne conditionne aucun calcul.',
    );
    expect(el.querySelector('mg-kpi')).toBeNull();
  });

  it('un écart entre natures et sites retenus est signalé', async () => {
    const el = await rendre({ retenus: 10, total: 10, par_nature: { A: 7, B: 1 } });
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('⚠ 2 sites ne sont rattachés à aucune nature : la barre ne couvre pas exactement le total retenu.');
    expect(el.textContent).not.toContain('au-delà de huit teintes');
  });

  it('le territoire du fil d’Ariane passe dans la note', async () => {
    const el = await rendre({ retenus: 66, total: 66, par_nature: { A: 66 } }, false, 'Bouches-du-Rhône');
    expect(el.textContent).toContain('sur Bouches-du-Rhône — le total porte le même territoire');
  });
});
