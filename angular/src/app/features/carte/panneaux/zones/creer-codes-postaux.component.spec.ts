import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';

const GEOMETRIE = { type: 'MultiPolygon', coordinates: [] };
const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function monter(api: Partial<Record<keyof ZonesCustomApi, unknown>> = {}) {
  const base = {
    depuisCodesPostaux: vi.fn(() => of({ geometry: GEOMETRIE, n_codes: 2, n_inconnus: 1, n_rejetes: 1, codes_inconnus: ['99999'], rejetes: ['abc'] })),
    enregistrer: vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z', count_cp: 2 } }))),
    ...api,
  };
  TestBed.configureTestingModule({
    providers: [
      CreationZoneService,
      { provide: ZonesCustomApi, useValue: base },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
    ],
  });
  const fixture = TestBed.createComponent(CreerCodesPostauxComponent);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { for (let i = 0; i < 3; i++) { await attendre(); await fixture.whenStable(); } };
  const cree = vi.fn();
  fixture.componentInstance.cree.subscribe(cree);
  return { fixture, el, api: base, stable, cree };
}

async function ouvrir(el: HTMLElement, stable: () => Promise<void>) {
  await stable();
  el.querySelector<HTMLButtonElement>('[data-repli]')!.click();
  await stable();
}

function saisir(el: HTMLElement, texte: string) {
  const zone = el.querySelector<HTMLTextAreaElement>('textarea')!;
  zone.value = texte;
  zone.dispatchEvent(new Event('input'));
}

describe('CreerCodesPostauxComponent (CreerZoneCodesPostaux.tsx)', () => {
  it('replié au départ : « Importer une liste de codes postaux ▼ »', async () => {
    const { el, stable } = monter();
    await stable();
    expect(el.querySelector('[data-repli]')!.textContent!.trim()).toBe('Importer une liste de codes postaux ▼');
    expect(el.querySelector('textarea')).toBeNull();
  });

  it('aperçu à la frappe, sans requête : « 3 codes reconnus · 1 rejeté » puis le jeton rejeté', async () => {
    const { el, api, stable } = monter();
    await ouvrir(el, stable);
    saisir(el, '13001, 13002, 99999, abc');
    await stable();
    const texte = (s: string) => el.querySelector(`[data-apercu] ${s}`)!.textContent!.trim();
    expect([texte('[data-reconnus]'), texte('[data-rejetes]'), texte('[data-liste-rejetes]')]).toEqual(['3 codes reconnus', '· 1 rejeté', 'abc']);
    expect(api.depuisCodesPostaux).not.toHaveBeenCalled();
  });

  it('CP collés → requête JSON de la saisie ; « 2 codes postaux · 1 inconnu du référentiel, 1 rejeté » ; zone ÉCRITE et liste relue', async () => {
    const { el, api, stable, cree } = monter();
    await ouvrir(el, stable);
    saisir(el, '13001, 13002, 99999, abc');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-creer]')!.click();
    await stable();
    expect(api.depuisCodesPostaux).toHaveBeenCalledWith('13001, 13002, 99999, abc');
    expect(api.enregistrer).toHaveBeenCalledWith({
      name: 'Liste de 2 codes postaux', source_type: 'codes_postaux',
      source_metadata: { n_codes_postaux: 2, n_inconnus: 1, n_rejetes: 1 }, geometry: GEOMETRIE, org_id: 'org-1',
    });
    expect(el.querySelector('[data-message]')!.textContent!.trim()).toBe('Zone créée : 2 codes postaux · 1 inconnu du référentiel, 1 rejeté');
    expect(el.querySelector('textarea')!.value).toBe('');
    expect(cree).toHaveBeenCalledTimes(1);
  });

  it('fichier déposé → le FICHIER part (multipart), le nom est proposé d’après lui', async () => {
    const { el, api, stable } = monter();
    await ouvrir(el, stable);
    const fichier = new File(['13001;13002'], 'clients.csv', { type: 'text/csv' });
    const entree = el.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(entree, 'files', { value: [fichier] });
    entree.dispatchEvent(new Event('change'));
    await stable();
    expect(el.querySelector('textarea')!.value).toBe('13001;13002');
    expect(el.querySelector<HTMLInputElement>('[data-nom]')!.value).toBe('Codes postaux — clients');
    el.querySelector<HTMLButtonElement>('[data-creer]')!.click();
    await stable();
    expect(api.depuisCodesPostaux).toHaveBeenCalledWith(fichier);
  });

  it('la saisie retouchée après le dépôt : c’est le TEXTE qui part, pas le fichier d’origine', async () => {
    const { el, api, stable } = monter();
    await ouvrir(el, stable);
    const entree = el.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(entree, 'files', { value: [new File(['13001'], 'a.txt')] });
    entree.dispatchEvent(new Event('change'));
    await stable();
    saisir(el, '13001 13005');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-creer]')!.click();
    await stable();
    expect(api.depuisCodesPostaux).toHaveBeenCalledWith('13001 13005');
  });

  it('plus de 2 000 codes : « Maximum 2 000 par import. » et bouton inactif', async () => {
    const { el, stable } = monter();
    await ouvrir(el, stable);
    saisir(el, Array.from({ length: 2001 }, (_, i) => String(10000 + i)).join(' '));
    await stable();
    expect(el.textContent).toContain(`Maximum ${(2000).toLocaleString('fr-FR')} par import.`);
    expect(el.querySelector<HTMLButtonElement>('[data-creer]')!.disabled).toBe(true);
  });

  it('refus de la route : son message, rien d’enregistré', async () => {
    const { el, api, stable } = monter({
      depuisCodesPostaux: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Aucun de ces codes postaux n’existe au référentiel.' } }))),
    });
    await ouvrir(el, stable);
    saisir(el, '99999');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-creer]')!.click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Aucun de ces codes postaux n’existe au référentiel.');
    expect(api.enregistrer).not.toHaveBeenCalled();
  });
});
