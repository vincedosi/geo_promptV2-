import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { type ZoneCustomResume } from '../../data/zones-custom.api';
import { RECETTES, ZONES, cartes, monter } from '../../testing/mes-zones-montage';

describe('MesZonesComponent — Dupliquer (③ finitions, T5)', () => {
  const bouton = (el: HTMLElement, i = 0) => cartes(el)[i].querySelector<HTMLButtonElement>('button[data-dupliquer]')!;

  it('un clic = un appel `{ nom (copie) }` ; second clic ignoré en vol ; 200 → liste relue et « Zone dupliquée : <nom> »', async () => {
    const vol = new Subject<HttpResponse<unknown>>();
    const dupliquer = vi.fn(() => vol);
    const { el, api, stable, fixture } = await monter({ dupliquer });
    await stable();
    const lectures = api.lister.mock.calls.length;
    bouton(el).click();
    await stable();
    expect(bouton(el).disabled).toBe(true);
    (fixture.componentInstance as unknown as { dupliquer: (z: ZoneCustomResume) => void }).dupliquer(ZONES[0]);
    expect(dupliquer).toHaveBeenCalledExactlyOnceWith('a', 'CIRFA BRETAGNE (copie)');
    vol.next(new HttpResponse({ status: 200, body: { zone_id: 'n1', count_cp: 4 } }));
    vol.complete();
    await stable();
    expect(el.querySelector('[data-avis]')!.textContent).toBe('Zone dupliquée : CIRFA BRETAGNE (copie)');
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
    expect(bouton(el).disabled).toBe(false);
  });

  it('207 → le message de la route (réussite, jamais renvoyée)', async () => {
    const dupliquer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'n1', warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' } })));
    const { el, stable } = await monter({ dupliquer });
    await stable();
    bouton(el).click();
    await stable();
    expect(dupliquer).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-avis]')!.textContent).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
  });

  it('réponse perdue (statut 0) → « vérifiez Mes zones », liste relue ; 404 → message de la route', async () => {
    const dupliquer = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' } })));
    const { el, api, stable } = await monter({ dupliquer });
    await stable();
    const lectures = api.lister.mock.calls.length;
    bouton(el).click();
    await stable();
    expect(el.querySelector('[data-avis]')!.textContent).toBe('La réponse n’est pas arrivée : vérifiez Mes zones avant de réessayer.');
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
    bouton(el).click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Zone introuvable dans cet espace.');
    expect(el.querySelector('[data-avis]')).toBeNull();
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
  });

  it.each([502, 504])('passerelle %i → réponse perdue : « vérifiez Mes zones », liste relue, aucune erreur (relecture 2)', async (status) => {
    const dupliquer = vi.fn(() => throwError(() => new HttpErrorResponse({ status })));
    const { el, api, stable } = await monter({ dupliquer });
    await stable();
    const lectures = api.lister.mock.calls.length;
    bouton(el).click();
    await stable();
    expect(el.querySelector('[data-avis]')!.textContent).toBe('La réponse n’est pas arrivée : vérifiez Mes zones avant de réessayer.');
    expect(el.querySelector('[data-erreur]')).toBeNull();
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
  });

  it('un recalcul refusé (409 `zone_referencee`) fait dire « Recalculer dans une nouvelle zone » à la carte', async () => {
    const recalculer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.', refus: 'zone_referencee', par: 'strategie' } })));
    const dupliquer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'n1' } })));
    const { el, stable } = monter({ zones: RECETTES, recalculer, dupliquer });
    await stable();
    expect(bouton(el).textContent!.trim()).toBe('Dupliquer');
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(bouton(el).textContent!.trim()).toBe('Recalculer dans une nouvelle zone');
    expect(bouton(el, 1).textContent!.trim()).toBe('Dupliquer');
    bouton(el).click();
    await stable();
    expect(dupliquer).toHaveBeenCalledExactlyOnceWith('z1', 'Lycées Gironde (copie)');
  });
});
