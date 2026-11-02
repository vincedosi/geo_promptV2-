import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import type { ZoneCustomResume } from '../../data/zones-custom.api';
import { cartes, monter, zone } from '../../testing/mes-zones-montage';

/**
 * « Mes zones » — B8, décision du 02/11 et tour 3 (N-1, N-2) : une zone de rayon trop fin, ou une combinaison qui en
 * contient une, est dite estimative sur sa carte ; son export TikTok (un fichier DSP) est refusé par la route, et le
 * refus s'affiche tel quel.
 */
const PER = { type: 'departement', code: '35' } as const;
const FINE: ZoneCustomResume = {
  ...zone('f', 'Lycées 100 m', 'recette_rayon_poi'), recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: PER },
};
const COMBI: ZoneCustomResume = {
  ...zone('c', 'Lycées ∩ Dessin', 'recette_combinaison'), recette: { v: 1, type: 'combinaison', operation: 'intersection', zones: ['d', 'f'] },
};
const DESSIN: ZoneCustomResume = { ...zone('d', 'Dessin', 'recette_dessin'), recette: { v: 1, type: 'dessin' } };
const REFUS = 'Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.';

describe('Mes zones — rayon trop fin pour être activé', () => {
  it('l’export TikTok d’une zone de 100 m : la route refuse (422), son message s’affiche', async () => {
    const corps = new Blob([JSON.stringify({ error: REFUS, refus: 'rayon_non_activable' })], { type: 'application/json' });
    const { el, stable } = await monter(TestBed, {
      zones: [FINE], api: { exporter: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 422, error: corps }))) },
    });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-export="tiktok_geo"]')!.click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe(REFUS);
  });

  it('une combinaison qui contient la zone de 100 m : sa carte est dite estimative, la zone source nommée', async () => {
    const { el, stable } = await monter(TestBed, { zones: [COMBI, DESSIN, FINE] });
    await stable();
    const carte = (nom: string) => cartes(el).find((c) => c.textContent?.includes(nom))!;
    const combi = carte('Lycées ∩ Dessin');
    const dessin = carte('Dessin à main levée');
    expect(combi.querySelector('[data-estimatif]')?.textContent?.trim()).toBe(
      'Chiffres estimatifs : cette combinaison contient la zone « Lycées 100 m », de rayon 100 m, plus fin que les carreaux '
      + 'INSEE de 200 m. Zone gardée pour l’analyse, jamais activée (minimum 250 m).');
    expect(dessin.querySelector('[data-estimatif]')).toBeNull();
  });
});
