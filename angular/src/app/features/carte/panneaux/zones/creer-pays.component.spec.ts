import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { type ZoneEcrite, ZonesApi } from '../../data/zones.api';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { MESSAGE_REPONSE_PERDUE } from '../../logique/zones/gestes-zone';
import { CreerPaysComponent } from './creer-pays.component';

/** ③ « France métropolitaine » / « France entière » (④ finitions, T6, A-3) : une zone pays prête, sans formulaire. */
async function monter(enregistrer: (corps: unknown) => unknown, org: string | null = 'org-1') {
  const appel = vi.fn(enregistrer);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ZonesApi, useValue: { enregistrer: appel } },
      { provide: CreationZoneService, useValue: { org: signal(org) } },
    ],
  });
  const f = TestBed.createComponent(CreerPaysComponent);
  const cree = vi.fn();
  f.componentInstance.cree.subscribe(cree);
  const el = f.nativeElement as HTMLElement;
  await f.whenStable();
  const bouton = (code: string) => el.querySelector<HTMLButtonElement>(`[data-creer-pays="${code}"]`)!;
  const cliquer = async (code: string) => { bouton(code).click(); await f.whenStable(); };
  const message = () => el.querySelector('[data-message-pays]')?.textContent?.trim() ?? null;
  return { f, el, appel, cree, bouton, cliquer, message };
}

const reponse = (status: number, body: ZoneEcrite) => new HttpResponse<ZoneEcrite>({ status, body });

describe('mg-creer-pays (④ finitions, T6)', () => {
  it('deux boutons « France métropolitaine » et « France entière » ; aucune requête avant un clic', async () => {
    const { el, appel } = await monter(() => of());
    expect([...el.querySelectorAll('[data-creer-pays]')].map((b) => b.textContent!.trim())).toEqual(['France métropolitaine', 'France entière']);
    expect(appel).not.toHaveBeenCalled();
  });

  it('un clic = un POST /api/zones portant la recette pays et le nom par défaut ; réussite dite, « Mes zones » relue', async () => {
    const { appel, cree, cliquer, message } = await monter(() => of(reponse(200, { zone_id: 'z-1', count_cp: 5956 })));
    await cliquer('METRO');
    expect(appel).toHaveBeenCalledWith({ nom: 'France métropolitaine', recette: { v: 1, type: 'pays', code: 'METRO' } });
    expect(message()).toBe('Zone créée : France métropolitaine. Chiffrez-la à l’étape ④.');
    expect(cree).toHaveBeenCalledTimes(1);
  });

  it('« France entière » porte le code FR', async () => {
    const { appel, cliquer } = await monter(() => of(reponse(200, { zone_id: 'z-2' })));
    await cliquer('FR');
    expect(appel).toHaveBeenCalledWith({ nom: 'France entière', recette: { v: 1, type: 'pays', code: 'FR' } });
  });

  it('un second clic en vol est ignoré : les deux boutons sont inactifs', async () => {
    const vol = new Subject<HttpResponse<ZoneEcrite>>();
    const { appel, bouton, cliquer } = await monter(() => vol);
    await cliquer('METRO');
    expect(bouton('METRO').disabled).toBe(true);
    expect(bouton('FR').disabled).toBe(true);
    await cliquer('METRO');
    await cliquer('FR');
    expect(appel).toHaveBeenCalledTimes(1);
    vol.next(reponse(200, { zone_id: 'z-1' }));
    vol.complete();
  });

  it('207 = réussite : la zone existe, son message est dit', async () => {
    const { cree, cliquer, message } = await monter(() => of(reponse(207, { zone_id: 'z-1', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' })));
    await cliquer('METRO');
    expect(message()).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
    expect(cree).toHaveBeenCalledTimes(1);
  });

  it('statut 0 : « vérifiez Mes zones », jamais de second envoi à l’aveugle ; un refus dit sa phrase', async () => {
    const perdu = await monter(() => throwError(() => new HttpErrorResponse({ status: 0 })));
    await perdu.cliquer('METRO');
    expect(perdu.message()).toBe(MESSAGE_REPONSE_PERDUE);
    expect(perdu.cree).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const refus = await monter(() => throwError(() => new HttpErrorResponse({ status: 422, error: { error: 'Zone refusée.' } })));
    await refus.cliquer('FR');
    expect(refus.message()).toBe('Zone refusée.');
    expect(refus.bouton('FR').disabled).toBe(false);
  });

  it('sans organisation : boutons inactifs', async () => {
    const { bouton } = await monter(() => of(), null);
    expect(bouton('METRO').disabled).toBe(true);
  });
});
