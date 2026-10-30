import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, delay, of, throwError } from 'rxjs';
import { ZonesCustomService } from '../../couches/zones-custom.service';
import { type ZoneCustomResume } from '../../data/zones-custom.api';
import { RECETTES, cartes, monter, zone } from '../../testing/mes-zones-montage';

const SEUIL: ZoneCustomResume = {
  ...zone('z3', 'Pauvreté', 'recette_seuil_territoire'),
  recette: { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code: '33' } },
};

function monterRecettes(recalculer: unknown = vi.fn()) {
  const indicateurs = vi.fn(() => of({ indicators: [] }));
  return { ...monter(TestBed, { zones: RECETTES, recalculer, indicateurs }), indicateurs };
}

describe('MesZonesComponent (ZonesOverlay.tsx, T14)', () => {
  it('sans organisation active : « Aucun workspace actif. », aucune requête', async () => {
    const { el, api, stable } = await monter(TestBed, { organisation: null });
    await stable();
    expect(el.textContent).toContain('Aucun workspace actif.');
    expect(api.lister).not.toHaveBeenCalled();
  });

  it('liste ET chiffres lus ensemble avec l’organisation et un horodatage ; chiffres, cartes et puces rendus comme React', async () => {
    const { el, api, stable } = await monter(TestBed);
    await stable();
    expect(api.lister).toHaveBeenCalledTimes(1);
    const params = (api.lister.mock.calls[0] as unknown as [URLSearchParams])[0];
    expect([...params.keys()]).toEqual(['org_id', '_t']);
    expect(params.get('org_id')).toBe('org-1');
    expect(api.stats).toHaveBeenCalledWith('org-1', Number(params.get('_t')));
    expect([...el.querySelectorAll('[data-stats] > span')].map((s) => s.textContent!.trim())).toEqual(['7 zones', `${(1234).toLocaleString('fr-FR')} IRIS`, '56 CP']);
    const [premiere] = cartes(el);
    expect(premiere.textContent).toContain('CIRFA BRETAGNE');
    expect(premiere.querySelector('[data-comptes]')!.textContent).toBe('12 IRIS · 4 CP');
    expect(premiere.querySelector('[data-codes]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Dept: 29, 56·Région: 53');
    expect([...el.querySelectorAll('[data-puce]')].map((b) => b.textContent?.trim())).toEqual(['Tous', 'Filtre territorial', 'Composite multi-layers']);
  });

  it('une puce relit la liste avec `source_type` ; la recherche part après 200 ms, avec `q`', async () => {
    const { el, api, stable } = await monter(TestBed);
    await stable();
    el.querySelector<HTMLButtonElement>('[data-puce="admin_filter"]')!.click();
    await stable();
    expect((api.lister.mock.calls.at(-1) as unknown as [URLSearchParams])[0].get('source_type')).toBe('admin_filter');
    const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
    for (const q of ['c', 'ci', 'cir']) {
      champ.value = q;
      champ.dispatchEvent(new Event('input'));
    }
    const avant = api.lister.mock.calls.length;
    await stable();
    expect(api.lister.mock.calls.length).toBe(avant);
    await stable(80);
    expect(api.lister.mock.calls.length).toBe(avant + 1);
    expect((api.lister.mock.calls.at(-1) as unknown as [URLSearchParams])[0].get('q')).toBe('cir');
  });

  it('cocher deux zones : rangs 1 et 2 dans l’ordre de cochage, barre des opérations', async () => {
    const { el, stable } = await monter(TestBed);
    await stable();
    const [a, b] = cartes(el);
    b.querySelector<HTMLInputElement>('input[data-selection]')!.click();
    a.querySelector<HTMLInputElement>('input[data-selection]')!.click();
    await stable();
    expect(b.querySelector('[data-rang]')!.textContent).toBe('1');
    expect(a.querySelector('[data-rang]')!.textContent).toBe('2');
    expect(el.querySelector('mg-operations-zones [data-base]')!.textContent).toContain('Cible composite (2 zones)');
  });

  it('Afficher → la zone est sur la carte, sa carte passe à « Masquer » avec sa teinte ; Masquer la retire', async () => {
    const { el, stable, carte } = await monter(TestBed);
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-afficher]')!.click();
    await stable();
    expect(carte.sources.has('custom-zone-a')).toBe(true);
    const premiere = cartes(el)[0];
    expect(premiere.querySelector('button[data-masquer]')).not.toBeNull();
    expect(premiere.querySelector('[data-point]')).not.toBeNull();
    premiere.querySelector<HTMLButtonElement>('button[data-masquer]')!.click();
    await stable();
    expect(carte.sources.has('custom-zone-a')).toBe(false);
  });

  it('Supprimer : dialogue, confirmation → DELETE, zone retirée de la carte, liste relue ; un 409 reste dans le dialogue', async () => {
    let echec = true;
    // La réponse RÉELLE de `DELETE /api/custom-geo/[id]` gardé par `zone_referencee` (sql/253, lot 3) : son message
    // français est affiché, plus « HTTP 409 » (re-relecture T10).
    const MESSAGE = 'Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être supprimée.';
    const supprimer = vi.fn(() => (echec
      ? throwError(() => new HttpErrorResponse({ status: 409, error: { error: MESSAGE, refus: 'zone_referencee', par: 'combinaison' } }))
      : of({ deleted: true, id: 'a' })));
    const { el, api, stable } = await monter(TestBed, { api: { supprimer } });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-supprimer]')!.click();
    await stable();
    const dialogue = el.querySelector('mg-dialogue-suppression-zone')!;
    expect(dialogue.textContent).toContain('Supprimer CIRFA BRETAGNE ?');
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe(MESSAGE);
    echec = false;
    const lectures = api.lister.mock.calls.length;
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(supprimer).toHaveBeenLastCalledWith('a');
    expect(el.querySelector('mg-dialogue-suppression-zone')).toBeNull();
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
  });

  it('export TikTok d’une carte : export `tiktok_geo` ; un échec s’affiche (React se taisait) ; plus de script DV360', async () => {
    const { el, api, stable } = await monter(TestBed);
    await stable();
    expect(el.querySelector('[data-export="bidding_script"]')).toBeNull();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-export="tiktok_geo"]')!.click();
    await stable();
    expect(api.exporter).toHaveBeenCalledWith('a', 'tiktok_geo');
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('zone_not_found');
  });

  it('les zones à recette : ligne de recette, puces lisibles (jamais `recette_*`), « Recalculer » sur la seule recalculable', async () => {
    const { el, stable, indicateurs } = await monterRecettes();
    await stable();
    const [z1, z2] = cartes(el);
    expect(z1.querySelector('[data-recette]')!.textContent!.trim()).toBe('Rayon de 5 km autour des POI « lycee »');
    expect(z1.querySelector('button[data-recalculer]')).not.toBeNull();
    expect(z2.querySelector('[data-recette]')!.textContent!.trim()).toBe('Dessin à main levée');
    expect(z2.querySelector('button[data-recalculer]')).toBeNull();
    expect([...el.querySelectorAll('[data-puce]')].map((b) => b.textContent?.trim())).toEqual(['Tous', 'Dessin', 'Rayon autour des POI']);
    expect(el.textContent).not.toContain('recette_');
    // Aucun seuil sur territoires dans la liste : le catalogue des indicateurs n'est pas lu.
    expect(indicateurs).not.toHaveBeenCalled();
  });

  it('un seuil sur territoires listé : catalogue lu une fois, libellé et unité affichés', async () => {
    const indicateurs = vi.fn(() => of({ indicators: [{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: null, unit: '%' }] }));
    const { el, stable } = await monter(TestBed, { zones: [SEUIL], indicateurs });
    await stable();
    expect(indicateurs).toHaveBeenCalledTimes(1);
    expect(cartes(el)[0].querySelector('[data-recette]')!.textContent!.trim()).toBe('Territoires où taux de pauvreté ≥ 20 %');
  });

  it('« Recalculer » → `ZonesApi.recalculer`, puis la liste est relue une fois', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z1', count_cp: 3 } })));
    const { el, api, stable } = await monterRecettes(recalculer);
    await stable();
    const lectures = api.lister.mock.calls.length;
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(recalculer).toHaveBeenCalledExactlyOnceWith('z1');
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
    expect(el.querySelector('[data-erreur]')).toBeNull();
  });

  it('une zone AFFICHÉE recalculée est redessinée : sa géométrie est relue', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z1' } })));
    // Une lecture ASYNCHRONE, comme HTTP : un `of` synchrone laisse sa lecture inscrite comme « en vol » dans le service.
    const geometrie = vi.fn(() => of({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [1, 2]]] }, properties: { id: 'z1' } }).pipe(delay(0)));
    const { el, stable, carte } = monter(TestBed, { zones: RECETTES, recalculer, api: { geometrie } });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-afficher]')!.click();
    await stable();
    expect(geometrie).toHaveBeenCalledTimes(1);
    expect(carte.sources.has('custom-zone-z1')).toBe(true);
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(geometrie).toHaveBeenCalledTimes(2);
    expect(carte.sources.has('custom-zone-z1')).toBe(true);
  });

  it('deux clics rapides → un seul appel (bouton désactivé pendant le vol)', async () => {
    const vol = new Subject<HttpResponse<unknown>>();
    const recalculer = vi.fn(() => vol);
    const { el, stable, fixture } = await monterRecettes(recalculer);
    await stable();
    const bouton = () => cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!;
    bouton().click();
    await stable();
    expect(bouton().disabled).toBe(true);
    bouton().click();
    // La garde du composant, au-delà du bouton désactivé.
    (fixture.componentInstance as unknown as { recalculer: (id: string) => void }).recalculer('z1');
    expect(recalculer).toHaveBeenCalledTimes(1);
    vol.next(new HttpResponse({ status: 200, body: { zone_id: 'z1' } }));
    vol.complete();
    await stable();
    expect(bouton().disabled).toBe(false);
  });

  it('409 → le message de la route ; la zone reste', async () => {
    const recalculer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.', refus: 'zone_referencee', par: 'strategie' } })));
    const { el, stable } = await monterRecettes(recalculer);
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.');
    expect(cartes(el).length).toBe(2);
  });

  it('404 (zone, ou zone MEMBRE d’une combinaison, supprimée) → message dit, la zone n’est pas retirée sans relecture', async () => {
    const recalculer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' } })));
    const { el, api, stable } = await monterRecettes(recalculer);
    await stable();
    const lectures = api.lister.mock.calls.length;
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Zone introuvable dans cet espace.');
    expect(cartes(el).length).toBe(2);
    expect(api.lister.mock.calls.length).toBe(lectures);
  });

  it('207 → le message de la route (« Zone recalculée, mais … ») ; jamais renvoyée', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z1', warning: 'codes_non_resolus', message: 'Zone recalculée, mais ses codes postaux n’ont pas pu être résolus.' } })));
    const { el, stable } = await monterRecettes(recalculer);
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(recalculer).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-avis]')!.textContent!.trim()).toBe('Zone recalculée, mais ses codes postaux n’ont pas pu être résolus.');
  });

  it('207 sans message : le repli nomme la zone', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z1', warning: 'codes_non_resolus' } })));
    const { el, stable } = await monterRecettes(recalculer);
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(el.querySelector('[data-avis]')!.textContent!.trim()).toBe('Zone « Lycées Gironde » recalculée ; ses codes postaux n’ont pas pu être résolus.');
  });

  it('Supprimer : un échec sans message de la route garde le message par statut ; le réseau a le sien', async () => {
    let echec: HttpErrorResponse = new HttpErrorResponse({ status: 404, error: 'texte' });
    const supprimer = vi.fn(() => throwError(() => echec));
    const { el, stable } = await monter(TestBed, { api: { supprimer } });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-supprimer]')!.click();
    await stable();
    const dialogue = el.querySelector('mg-dialogue-suppression-zone')!;
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe('HTTP 404');
    echec = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe('Serveur injoignable : réessayez.');
  });

  it('recalcul d’une zone affichée : sa teinte et son rang ne bougent pas, nom et forme sont ceux de la liste relue', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z1' } })));
    const geometrie = vi.fn((id: string) => of({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [1, 2]]] }, properties: { id } }).pipe(delay(0)));
    const { el, api, stable, carte } = monter(TestBed, { zones: RECETTES, recalculer, api: { geometrie } });
    await stable();
    const service = TestBed.inject(ZonesCustomService);
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-afficher]')!.click();
    await stable();
    cartes(el)[1].querySelector<HTMLButtonElement>('button[data-afficher]')!.click();
    await stable();
    const couleurs = [...service.couleurs()];
    const cadrages = carte.cadrages.length;
    // La liste relue après le recalcul porte le nouveau nom de la zone.
    api.lister.mockImplementation(() => of({ zones: [{ ...RECETTES[0], name: 'Lycées Gironde (recalculée)' }, RECETTES[1]] }));
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    await stable();
    expect(geometrie).toHaveBeenCalledTimes(3);
    expect([...service.couleurs()]).toEqual(couleurs);
    expect(service.zonesAffichees()).toEqual([{ id: 'z1', name: 'Lycées Gironde (recalculée)' }, { id: 'z2', name: 'Dessin' }]);
    expect(carte.cadrages.length).toBe(cadrages);
  });

  it('Supprimer : tout message texte de la route est affiché, quel que soit `refus`', async () => {
    const supprimer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Droit insuffisant sur cette zone.' } })));
    const { el, stable } = await monter(TestBed, { api: { supprimer } });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-supprimer]')!.click();
    await stable();
    const dialogue = el.querySelector('mg-dialogue-suppression-zone')!;
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe('Droit insuffisant sur cette zone.');
  });

  it('le bandeau d’avis (207) disparaît à la suppression, à une opération et à une recherche', async () => {
    const recalculer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z1' } })));
    const { el, stable, fixture } = await monterRecettes(recalculer);
    await stable();
    const avisPuis = async (geste: () => void | Promise<void>) => {
      cartes(el)[0].querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
      await stable();
      expect(el.querySelector('[data-avis]')).not.toBeNull();
      await geste();
      await stable(250);
      expect(el.querySelector('[data-avis]')).toBeNull();
    };
    await avisPuis(() => {
      const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
      champ.value = 'x'; champ.dispatchEvent(new Event('input'));
    });
    await avisPuis(() => (fixture.componentInstance as unknown as { apresOperation: () => void }).apresOperation());
    await avisPuis(async () => {
      cartes(el)[0].querySelector<HTMLButtonElement>('button[data-supprimer]')!.click();
      await stable();
      el.querySelector<HTMLButtonElement>('mg-dialogue-suppression-zone button[data-confirmer]')!.click();
    });
  });

  it('liste en échec → « HTTP 500 » ; chiffres en échec → liste quand même', async () => {
    const { el, stable } = await monter(TestBed, { api: { stats: () => throwError(() => new HttpErrorResponse({ status: 500 })) } });
    await stable();
    expect(cartes(el).length).toBe(2);
    expect(el.querySelector('[data-stats]')).toBeNull();
    TestBed.resetTestingModule();
    const autre = await monter(TestBed, { api: { lister: () => throwError(() => new HttpErrorResponse({ status: 500 })) } });
    await autre.stable();
    expect(autre.el.querySelector('[data-erreur]')!.textContent).toBe('HTTP 500');
    expect(autre.el.textContent).toContain('Aucune zone sauvegardée.');
  });
});
