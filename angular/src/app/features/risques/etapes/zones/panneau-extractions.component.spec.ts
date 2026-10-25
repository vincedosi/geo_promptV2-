import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { type Extraction, JeuxZonesApi } from '../../data/jeux-zones.api';
import { dateHeureFr } from '../../../../core/format/date';
import { PanneauExtractionsComponent, TEXTES_EXTRACTIONS } from './panneau-extractions.component';

interface Appel { nom: string; args: unknown[]; rep: Subject<unknown> }

const V1: Extraction = {
  id: 'e1', version: 1, origine: 'initiale', commentaire: '', seuil_couverture_cp: 20, mode_plan: 'pondere',
  n_cp: 1942, n_retenus: 1112, taux_utile: 72.34, part_plan_en_zone: 80, created_at: '2026-09-23T14:05:00Z',
};
const V2: Extraction = {
  ...V1, id: 'e2', version: 2, origine: 'recalage', commentaire: 'Après la première semaine',
  seuil_couverture_cp: 35, n_retenus: 0, taux_utile: null, created_at: '2026-09-24T08:30:00Z',
};

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function monter(jeuId: string | null = 'jeu-1', cle = 'a') {
  const appels: Appel[] = [];
  const espion = (nom: string) => (...args: unknown[]) => {
    const rep = new Subject<unknown>();
    appels.push({ nom, args, rep });
    return new Observable((o) => rep.subscribe(o));
  };
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: JeuxZonesApi, useValue: {
        extractions: espion('extractions'), extraire: espion('extraire'), exportExtraction: espion('export'),
      } },
      { provide: ENREGISTRER_FICHIER, useValue: enregistrer },
    ],
  });
  const f = TestBed.createComponent(PanneauExtractionsComponent);
  f.componentRef.setInput('jeuId', jeuId);
  f.componentRef.setInput('cleFraicheur', cle);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const rendu = async () => { await attendre(); TestBed.tick(); await f.whenStable(); };
  const dernier = (nom: string) => appels.filter((a) => a.nom === nom).at(-1)!;
  const repondre = async (nom: string, valeur: unknown) => {
    const a = dernier(nom);
    a.rep.next(valeur);
    a.rep.complete();
    await rendu();
  };
  return { f, el, appels, dernier, repondre, rendu, enregistrer };
}

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

describe('mg-panneau-extractions', () => {
  it('brouillon (`jeuId` null) : le message de React, et AUCUN appel', async () => {
    const { el, appels } = await monter(null);
    expect(texte(el.querySelector('[data-role="brouillon"]'))).toBe(TEXTES_EXTRACTIONS.brouillon);
    expect(el.querySelector('[data-role="extraire"]')).toBeNull();
    expect(appels).toHaveLength(0);
  });

  it('deux versions listées : date fr-FR, seuil, CP retenus / touchés, taux « — » sans ratio, étiquette recalage', async () => {
    const { el, appels, repondre } = await monter();
    expect(appels.map((a) => [a.nom, a.args])).toEqual([['extractions', ['jeu-1']]]);
    expect(texte(el.querySelector('[data-role="lecture"]'))).toBe(TEXTES_EXTRACTIONS.lecture);
    await repondre('extractions', { extractions: [V2, V1] });
    const lignes = [...el.querySelectorAll('tr[data-role="extraction"]')];
    expect(lignes).toHaveLength(2);
    const cellules = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => texte(td));
    expect(cellules(lignes[1])).toEqual(['v1', dateHeureFr(V1.created_at), '20 %', '1 112 / 1 942', '72,3 %', 'Excel']);
    expect(cellules(lignes[0])[0]).toBe('v2recalage Après la première semaine');
    expect(cellules(lignes[0])[4]).toBe('—');
    expect(lignes[0].querySelector('[data-role="commentaire"]')?.getAttribute('title')).toBe('Après la première semaine');
    expect(el.querySelector('[data-role="recalage"]')).not.toBeNull();
  });

  it('aucune extraction : le message de React, sans case de recalage', async () => {
    const { el, repondre } = await monter();
    await repondre('extractions', { extractions: [] });
    expect(texte(el.querySelector('[data-role="aucune"]'))).toBe(TEXTES_EXTRACTIONS.aucune);
    expect(el.querySelector('[data-role="recalage"]')).toBeNull();
  });

  it('extraire : POST (commentaire nettoyé), puis RELECTURE de la liste ; message, champ et case remis à zéro', async () => {
    const { el, appels, repondre, rendu } = await monter();
    await repondre('extractions', { extractions: [V1] });
    const champ = el.querySelector<HTMLInputElement>('input[aria-label="Commentaire de l’extraction"]')!;
    champ.value = '  Pour le DSP  ';
    champ.dispatchEvent(new Event('input'));
    const caseRecalage = el.querySelector<HTMLInputElement>('[data-role="recalage"] input')!;
    caseRecalage.checked = true;
    caseRecalage.dispatchEvent(new Event('change'));
    await rendu();
    el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.click();
    await rendu();
    expect(appels.at(-1)).toMatchObject({ nom: 'extraire', args: ['jeu-1', { origine: 'recalage', commentaire: 'Pour le DSP' }] });
    expect(el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.disabled).toBe(true);
    await repondre('extraire', { ok: true, version: 2, deja_extraite: false });
    expect(appels.map((a) => a.nom)).toEqual(['extractions', 'extraire', 'extractions']);
    await repondre('extractions', { extractions: [V2, V1] });
    expect(texte(el.querySelector('[data-role="message"]'))).toBe('Extraction v2 enregistrée — elle ne bougera plus.');
    expect(el.querySelectorAll('tr[data-role="extraction"]')).toHaveLength(2);
    expect(champ.value).toBe('');
    expect(el.querySelector<HTMLInputElement>('[data-role="recalage"] input')!.checked).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.disabled).toBe(false);
  });

  it('`deja_extraite` : ni erreur ni création — la version en vigueur est nommée, aucun doublon', async () => {
    const { el, repondre, rendu } = await monter();
    await repondre('extractions', { extractions: [V1] });
    el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.click();
    await rendu();
    await repondre('extraire', { ok: true, version: 1, deja_extraite: true });
    await repondre('extractions', { extractions: [V1] });
    expect(texte(el.querySelector('[data-role="message"]'))).toBe('Rien n’a changé depuis la v1 : c’est elle qui reste en vigueur.');
    expect(el.querySelector('[data-role="erreur"]')).toBeNull();
    expect(el.querySelectorAll('tr[data-role="extraction"]')).toHaveLength(1);
  });

  it('extraction refusée : le message de la route (409 d’un brouillon), sinon « n’a pas répondu » sur une coupure', async () => {
    const { el, dernier, rendu, repondre } = await monter();
    await repondre('extractions', { extractions: [] });
    el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.click();
    await rendu();
    dernier('extraire').rep.error(new HttpErrorResponse({ status: 409, error: { error: 'Enregistrez d’abord ce jeu.' } }));
    await rendu();
    expect(texte(el.querySelector('[data-role="erreur"]'))).toBe('Enregistrez d’abord ce jeu.');
    el.querySelector<HTMLButtonElement>('[data-role="extraire"]')!.click();
    await rendu();
    dernier('extraire').rep.error(new HttpErrorResponse({ status: 0 }));
    await rendu();
    expect(texte(el.querySelector('[data-role="erreur"]'))).toBe(TEXTES_EXTRACTIONS.impossibleSansReponse);
  });

  it('liste illisible : le message de la route, ou le message par défaut', async () => {
    const { el, dernier, rendu } = await monter();
    dernier('extractions').rep.error(new HttpErrorResponse({ status: 500, error: '<html>' }));
    await rendu();
    expect(texte(el.querySelector('[data-role="erreur"]'))).toBe(TEXTES_EXTRACTIONS.illisibles);
    expect(el.querySelector('table')).toBeNull();
  });

  it('`cleFraicheur` qui change (jeu reconstruit) : la liste se RELIT ; une réponse dépassée est jetée', async () => {
    const { f, el, appels, rendu } = await monter();
    const premiere = appels[0];
    f.componentRef.setInput('cleFraicheur', 'b');
    await rendu();
    expect(appels.filter((a) => a.nom === 'extractions')).toHaveLength(2);
    appels[1].rep.next({ extractions: [V1] });
    await rendu();
    premiere.rep.next({ extractions: [V2, V1] });
    await rendu();
    expect(el.querySelectorAll('tr[data-role="extraction"]')).toHaveLength(1);
  });

  it('le classeur d’une version passe par `exportExtraction` (blob, A8) puis `enregistrerFichier`', async () => {
    const { el, appels, repondre, rendu, enregistrer } = await monter();
    await repondre('extractions', { extractions: [V2, V1] });
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('mg-bouton-export button')];
    boutons[1].click();
    await rendu();
    expect(appels.at(-1)).toMatchObject({ nom: 'export', args: ['jeu-1', 1] });
    const blob = new HttpResponse({
      body: new Blob(['x']), headers: new HttpHeaders({ 'content-disposition': 'attachment; filename="x.xlsx"' }),
    });
    await repondre('export', blob);
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(enregistrer.mock.calls[0][2]).toBe('extraction-v1.xlsx');
  });

  it('aucun appel ne part à l’ouverture sans jeu, puis un seul quand le jeu est enregistré', async () => {
    const { f, appels, rendu } = await monter(null);
    f.componentRef.setInput('jeuId', 'jeu-2');
    await rendu();
    expect(appels.map((a) => [a.nom, a.args])).toEqual([['extractions', ['jeu-2']]]);
  });
});
