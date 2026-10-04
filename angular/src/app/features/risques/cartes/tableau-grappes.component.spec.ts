import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import type { Bbox } from '../../../carte/bbox';
import { type Grappe, JeuxZonesApi } from '../data/jeux-zones.api';
import { TableauGrappesComponent } from './tableau-grappes.component';

const GRAPPES: Grappe[] = [
  { id: 'g1', rang: 1, nom: 'Fos-sur-Mer', niveau_dominant: 'haut', n_sites: 53, pop_exposee: 412345, n_cp: 12, n_cp_retenus: 9, codes_postaux: ['13270', '13500'], bbox: [4.8, 43.3, 5.1, 43.5] },
  { id: 'g2', rang: 2, nom: 'Sans enveloppe', niveau_dominant: 'bas', n_sites: 1, pop_exposee: null, n_cp: 0, n_cp_retenus: 0, codes_postaux: [], bbox: null },
];

async function rendre(actif = true) {
  const demandes: { jeu: string; rep: Subject<{ grappes: Grappe[] }> }[] = [];
  TestBed.configureTestingModule({
    providers: [{
      provide: JeuxZonesApi,
      useValue: {
        grappes: (jeu: string) => {
          const d = { jeu, rep: new Subject<{ grappes: Grappe[] }>() };
          demandes.push(d);
          return new Observable<{ grappes: Grappe[] }>((o) => d.rep.subscribe(o));
        },
      },
    }],
  });
  const fixture = TestBed.createComponent(TableauGrappesComponent);
  const survols: (string[] | null)[] = [];
  const recadrages: Bbox[] = [];
  fixture.componentInstance.survol.subscribe((s) => survols.push(s));
  fixture.componentInstance.recadrer.subscribe((b) => recadrages.push(b));
  fixture.componentRef.setInput('jeuId', 'jeu-a');
  fixture.componentRef.setInput('actif', actif);
  await fixture.whenStable();
  return { fixture, demandes, survols, recadrages, el: fixture.nativeElement as HTMLElement };
}

describe('TableauGrappesComponent (T15)', () => {
  it('lit les bassins UNE fois par jeu, et seulement une fois visible', async () => {
    const { fixture, demandes, el } = await rendre(false);
    expect(demandes).toHaveLength(0);
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(el.textContent).toContain('Chargement des bassins…');
    demandes[0].rep.next({ grappes: GRAPPES });
    await fixture.whenStable();
    // Masqué puis revenu (aller-retour d'étapes) : aucune nouvelle lecture.
    fixture.componentRef.setInput('actif', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(demandes.map((d) => d.jeu)).toEqual(['jeu-a']);
    fixture.componentRef.setInput('jeuId', 'jeu-b');
    await fixture.whenStable();
    expect(demandes.map((d) => d.jeu)).toEqual(['jeu-a', 'jeu-b']);
  });

  it('relecture T15 : un créneau de 190 px FIXE dès le chargement (aucun saut de hauteur sous les cartes), aucun masqué', async () => {
    const { fixture, demandes, el } = await rendre();
    const hote = el as HTMLElement;
    expect(hote.style.height).toBe('190px');
    demandes[0].rep.next({ grappes: GRAPPES });
    await fixture.whenStable();
    expect(hote.style.height).toBe('190px');
    fixture.componentRef.setInput('actif', false);
    await fixture.whenStable();
    expect(hote.style.height).toBe('');
  });

  it('rend les colonnes de React, « — » pour un bassin sans code postal, `fr-FR`', async () => {
    const { fixture, demandes, el } = await rendre();
    demandes[0].rep.next({ grappes: GRAPPES });
    await fixture.whenStable();
    expect([...el.querySelectorAll('th')].map((t) => t.textContent?.trim())).toEqual([
      'Bassin', 'Sites', 'Exposés', 'Codes postaux', 'Achetés', 'Part achetée',
    ]);
    const cellules = [...el.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim().replace(/ | /g, ' ')));
    expect(cellules).toEqual([
      ['Fos-sur-Mer', '53', '412 345', '12', '9', '75 %'],
      ['Sans enveloppe', '1', '0', '0', '0', '—'],
    ]);
    expect((el.querySelector('tbody tr td span') as HTMLElement).style.background).toBe('var(--niveau-haut)');
  });

  it('survol → codes postaux du bassin (sans requête), sortie → null ; clic → recadrage, sauf sans enveloppe', async () => {
    const { fixture, demandes, el, survols, recadrages } = await rendre();
    demandes[0].rep.next({ grappes: GRAPPES });
    await fixture.whenStable();
    const [l1, l2] = [...el.querySelectorAll<HTMLElement>('tbody tr')];
    l1.dispatchEvent(new MouseEvent('mouseenter'));
    el.querySelector('tbody')!.dispatchEvent(new MouseEvent('mouseleave'));
    l1.click();
    l2.click();
    expect(survols).toEqual([['13270', '13500'], null]);
    expect(recadrages).toEqual([[4.8, 43.3, 5.1, 43.5]]);
    expect(l2.getAttribute('title')).toBe('Ce bassin n’a pas d’enveloppe : rien à recadrer');
    expect(demandes).toHaveLength(1);
  });

  it('un échec est affiché ; aucun bassin → la phrase de React', async () => {
    const a = await rendre();
    a.demandes[0].rep.error(new HttpErrorResponse({ status: 500, error: { error: 'Bassins illisibles.' } }));
    await a.fixture.whenStable();
    expect(a.el.textContent).toContain('Bassins illisibles.');
    TestBed.resetTestingModule();
    const b = await rendre();
    b.demandes[0].rep.next({ grappes: [] });
    await b.fixture.whenStable();
    expect(b.el.textContent).toContain('Aucun bassin — le profil ne retient aucun site.');
  });
});
