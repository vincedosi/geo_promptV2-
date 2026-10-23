import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { CouvertureApi } from '../../data/couverture.api';
import type { ResultatCroisements } from '../../logique/analyses/couverture';
import { CroisementsZoneComponent } from './croisements-zone.component';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '1f8fad5b-d9cb-469f-a165-70867728950e';
const RESULTAT: ResultatCroisements = {
  radio: {
    n_emetteurs: 39, n_sans_rayon: 2, tronque: true,
    emetteurs: [
      { site: '0130600060', commune: 'Marseille', frequence_mhz: 87.5, puissance_w: null, stations: ['France Inter', 'RTL'] },
      { site: '0130600061', commune: null, frequence_mhz: null, puissance_w: 2000, stations: [] },
    ],
  },
  trafic: {
    n_comptages: 2, tmja_max: 97670, tmja_median: 51646, tronque: false,
    comptages: [
      { route: 'A0007', tmja: 97670, annee_mesure: 2024, type_comptage: 'Permanent horaire' },
      { route: 'A0055', tmja: 5622, annee_mesure: 2022, type_comptage: 'Permanent horaire' },
    ],
  },
};

async function monter() {
  const reponses: Subject<ResultatCroisements>[] = [];
  const croisements = vi.fn(() => { const s = new Subject<ResultatCroisements>(); reponses.push(s); return s; });
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: CouvertureApi, useValue: { croisements } }],
  });
  const f = TestBed.createComponent(CroisementsZoneComponent);
  f.componentRef.setInput('zoneId', A);
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  await stable();
  const lire = async () => { el.querySelector<HTMLButtonElement>('[data-lire-croisements]')!.click(); await stable(); };
  return { f, el, croisements, reponses, stable, lire };
}

describe('mg-croisements-zone (lot 4, T13)', () => {
  it('aucune lecture au montage ; le bouton lit la zone une fois', async () => {
    const { croisements, lire } = await monter();
    expect(croisements).not.toHaveBeenCalled();
    await lire();
    expect(croisements).toHaveBeenCalledExactlyOnceWith(A);
  });

  it('deux listes repliables, nombres en Mono, « … et 37 autres » quand la liste est tronquée', async () => {
    const { el, reponses, stable, lire } = await monter();
    await lire();
    reponses[0].next(RESULTAT);
    await stable();
    const radio = el.querySelector('details[data-radio]')!;
    const trafic = el.querySelector('details[data-trafic]')!;
    expect(radio.querySelector('summary .font-mono')!.textContent).toBe('39');
    expect(radio.querySelectorAll('[data-emetteur]')).toHaveLength(2);
    expect(radio.querySelector('[data-autres]')!.textContent).toContain('… et 37 autres');
    expect(radio.textContent).toContain('France Inter, RTL');
    expect(radio.textContent).toContain('2 émetteurs sans rayon de couverture');
    expect(trafic.querySelector('summary')!.textContent).toContain(formaterNombre(97670));
    expect(trafic.querySelectorAll('[data-comptage]')).toHaveLength(2);
    expect(trafic.querySelector('[data-autres]')).toBeNull();
  });

  it('P-c : changer de zone efface le résultat et JETTE la réponse en vol', async () => {
    const { f, el, reponses, stable, lire } = await monter();
    await lire();
    reponses[0].next(RESULTAT);
    await stable();
    await lire();
    f.componentRef.setInput('zoneId', B);
    await stable();
    expect(el.querySelector('[data-radio]')).toBeNull();
    reponses[1].next(RESULTAT);
    await stable();
    expect(el.querySelector('[data-radio]')).toBeNull();
  });

  it('un refus s’affiche en message, au-dessus du bouton', async () => {
    const { el, reponses, stable, lire } = await monter();
    await lire();
    reponses[0].error(new HttpErrorResponse({ status: 404, error: { error: 'Cette zone n’existe pas dans cet espace.', refus: 'zone_introuvable' } }));
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toContain('n’existe pas dans cet espace');
  });
});
