import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { BoutonExportComponent, MESSAGE_EXPORT_IMPOSSIBLE, MESSAGE_EXPORT_SANS_REPONSE, messageExport } from './bouton-export.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function reponse(nom = 'rayon.xlsx'): HttpResponse<Blob> {
  return new HttpResponse({
    body: new Blob(['x']),
    headers: new HttpHeaders({ 'content-disposition': `attachment; filename="${nom}"` }),
  });
}

const enregistrer = vi.fn();

async function rendre(charger: () => unknown, entrees: Record<string, unknown> = {}) {
  enregistrer.mockReset();
  TestBed.configureTestingModule({ providers: [{ provide: ENREGISTRER_FICHIER, useValue: enregistrer }] });
  const f = TestBed.createComponent(BoutonExportComponent);
  f.componentRef.setInput('libelle', 'Export Excel');
  f.componentRef.setInput('libelleEnCours', 'Préparation…');
  f.componentRef.setInput('nomRepli', 'rayon-influence-seveso.xlsx');
  f.componentRef.setInput('charger', charger);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, el, bouton: () => el.querySelector('button')! };
}

describe('BoutonExportComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clic → `charger` appelé UNE fois, la réponse part à `enregistrerFichier`, le bouton est désactivé pendant', async () => {
    const flux = new Subject<HttpResponse<Blob>>();
    const charger = vi.fn(() => flux);
    const { f, bouton } = await rendre(charger);
    expect(bouton().textContent?.trim()).toBe('Export Excel');

    bouton().click();
    await f.whenStable();
    expect(charger).toHaveBeenCalledTimes(1);
    expect(bouton().disabled).toBe(true);
    expect(bouton().getAttribute('aria-busy')).toBe('true');
    expect(bouton().textContent?.trim()).toBe('Préparation…');
    // Un second clic pendant l'export ne relance rien (le bouton est désactivé, et la méthode le vérifie aussi).
    bouton().click();
    expect(charger).toHaveBeenCalledTimes(1);

    const r = reponse();
    flux.next(r);
    flux.complete();
    await f.whenStable();
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(enregistrer.mock.calls[0][1]).toBe(r);
    expect(enregistrer.mock.calls[0][2]).toBe('rayon-influence-seveso.xlsx');
    expect(bouton().disabled).toBe(false);
    expect(bouton().textContent?.trim()).toBe('Export Excel');
  });

  it("un refus de la route affiche SON message (corps JSON lu dans le Blob d'erreur), jamais un téléchargement", async () => {
    const erreur = new HttpErrorResponse({
      status: 409, error: new Blob([JSON.stringify({ error: 'La couverture n’est pas construite.' })], { type: 'application/json' }),
    });
    const charger = vi.fn(() => new Subject<HttpResponse<Blob>>());
    const { f, el, bouton } = await rendre(() => { const s = charger(); queueMicrotask(() => s.error(erreur)); return s; });
    bouton().click();
    for (let i = 0; i < 3; i++) { await attendre(); await f.whenStable(); }
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('La couverture n’est pas construite.');
    expect(enregistrer).not.toHaveBeenCalled();
    expect(bouton().disabled).toBe(false);
  });

  it('`desactive` : bouton inerte, aucun appel', async () => {
    const charger = vi.fn(() => of(reponse()));
    const { bouton } = await rendre(charger, { desactive: true, variante: 'neutre', libelleEnCours: undefined });
    expect(bouton().disabled).toBe(true);
    bouton().click();
    expect(charger).not.toHaveBeenCalled();
  });

  it('messageExport : corps illisible → message générique ; erreur réseau → « n’a pas répondu »', async () => {
    expect(await messageExport(new HttpErrorResponse({ status: 500, error: new Blob(['<html>']) }))).toBe(MESSAGE_EXPORT_IMPOSSIBLE);
    expect(await messageExport(new HttpErrorResponse({ status: 400, error: { error: 'Paramètres invalides.' } }))).toBe('Paramètres invalides.');
    expect(await messageExport(new HttpErrorResponse({ status: 0 }))).toBe(MESSAGE_EXPORT_SANS_REPONSE);
    expect(await messageExport(new Error('x'))).toBe(MESSAGE_EXPORT_SANS_REPONSE);
  });
});
