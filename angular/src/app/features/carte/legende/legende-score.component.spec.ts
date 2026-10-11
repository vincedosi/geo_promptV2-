import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScoreService } from '../couches/score.service';
import type { ScoreAffiche } from '../couches/couche-score';
import { LegendeScoreComponent } from './legende-score.component';

function monter() {
  const affiche = signal<ScoreAffiche | null>(null);
  const chargement = signal(false);
  const echec = signal(false);
  const partiels = signal(0);
  const eteindre = vi.fn();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: ScoreService, useValue: { affiche, chargement, echec, partiels, eteindre } }],
  });
  const fixture = TestBed.createComponent(LegendeScoreComponent);
  const el = fixture.nativeElement as HTMLElement;
  return { el, affiche, chargement, echec, partiels, eteindre, rendre: () => fixture.whenStable() };
}

describe('Carte flottante du score composite (ScoreMapLayer.tsx:237-303)', () => {
  it('rien d’affiché : aucune carte', async () => {
    const m = monter();
    await m.rendre();
    expect(m.el.querySelector('[data-legende-score]')).toBeNull();
  });

  it('chargement puis échec des contours : les deux textes de React', async () => {
    const m = monter();
    m.chargement.set(true);
    await m.rendre();
    expect(m.el.querySelector('[data-legende-score]')!.textContent!.trim()).toBe('Chargement des contours…');
    m.chargement.set(false);
    m.echec.set(true);
    await m.rendre();
    expect(m.el.querySelector('[data-legende-score]')!.textContent!.trim())
      .toBe('Contours des codes postaux indisponibles — le score est calculé, mais ne peut pas être affiché.');
  });

  it('affiché : titre, libellé, cinq paliers `--seq-*`, 0 / 100, compte et partiels ; la croix éteint', async () => {
    const m = monter();
    m.affiche.set({
      scores: Array.from({ length: 127 }, (_, i) => ({ code: String(13000 + i), score: i, n_indicateurs: 2 })),
      libelle: 'Revenu médian × Part des 15-29 ans', nIndicateurs: 2,
    });
    m.partiels.set(7);
    await m.rendre();
    const carte = m.el.querySelector('[data-legende-score]')!;
    // Les blocs de la carte, dans l'ordre de React.
    expect([...carte.querySelectorAll(':scope > div')].map((d) => d.textContent!.replace(/[ \n\t]+/g, ' ').trim())).toEqual([
      'Score composite×', 'Revenu médian × Part des 15-29 ans', '', '0100', '127 codes postaux', '7 partiels, peints en transparence',
    ]);
    expect([...carte.querySelectorAll<HTMLElement>('[data-palier]')].map((p) => p.style.background))
      .toEqual(['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']);
    carte.querySelector<HTMLButtonElement>('[aria-label="Masquer le score composite"]')!.click();
    expect(m.eteindre).toHaveBeenCalled();
  });

  it('un seul code postal, un seul partiel : au singulier', async () => {
    const m = monter();
    m.affiche.set({ scores: [{ code: '13001', score: 1, n_indicateurs: 1 }], libelle: 'x', nIndicateurs: 2 });
    m.partiels.set(1);
    await m.rendre();
    const texte = m.el.textContent!.replace(/\s+/g, ' ');
    expect(texte).toContain('1 code postal');
    expect(texte).toContain('1 partiel, peint en transparence');
  });
});
