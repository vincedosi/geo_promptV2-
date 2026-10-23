import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { formaterNombre } from '../../../../core/format/nombre';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import type { ResultatCroisements } from '../../logique/analyses/couverture';
import { CroisementsZoneComponent } from './croisements-zone.component';

const RESULTAT: ResultatCroisements = {
  radio: {
    n_emetteurs: 39, n_sans_rayon: 2, tronque: true,
    emetteurs: [
      { site: '0130600060', lieu: 'Pylône TDF', stations: ['France Inter', 'RTL'] },
      { site: '0130600061', lieu: null, stations: [] },
    ],
  },
  trafic: {
    n_comptages: 2, tmja_max: 97670, tmja_median: 51646, tronque: false,
    comptages: [
      { route: 'A0007', tmja: 97670, annee_mesure: 2024 },
      { route: 'A0055', tmja: 5622, annee_mesure: 2022 },
    ],
  },
};

/** La lecture et son état vivent dans `ZoneAnalyseeService` (ronde 1, P-e) : prouvés par sa spec ; ici, le gabarit. */
async function monter() {
  const z = {
    croisements: { resultat: signal<ResultatCroisements | null>(null), enCours: signal(false), erreur: signal<string | null>(null) },
    lireCroisements: vi.fn(),
  };
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: ZoneAnalyseeService, useValue: z }] });
  const f = TestBed.createComponent(CroisementsZoneComponent);
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  await stable();
  return { el, z, stable };
}

describe('mg-croisements-zone (lot 4, T13)', () => {
  it('aucune lecture au montage ; le bouton demande la lecture au service', async () => {
    const { el, z, stable } = await monter();
    expect(z.lireCroisements).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('[data-lire-croisements]')!.click();
    await stable();
    expect(z.lireCroisements).toHaveBeenCalledTimes(1);
  });

  it('deux listes repliables, nombres en Mono, « … et 37 autres » quand la liste est tronquée', async () => {
    const { el, z, stable } = await monter();
    z.croisements.resultat.set(RESULTAT);
    await stable();
    const radio = el.querySelector('details[data-radio]')!;
    const trafic = el.querySelector('details[data-trafic]')!;
    expect(radio.querySelector('summary .font-mono')!.textContent).toBe('39');
    expect(radio.querySelectorAll('[data-emetteur]')).toHaveLength(2);
    expect(radio.querySelector('[data-autres]')!.textContent).toContain('… et 37 autres');
    expect(radio.textContent).toContain('France Inter, RTL');
    expect(radio.textContent).toContain('Pylône TDF');
    expect(radio.textContent).not.toContain('MHz');
    expect(radio.textContent).toContain('2 émetteurs sans rayon de couverture');
    expect(trafic.querySelector('summary')!.textContent).toContain(formaterNombre(97670));
    expect(trafic.querySelectorAll('[data-comptage]')).toHaveLength(2);
    expect(trafic.querySelector('[data-autres]')).toBeNull();
  });

  it('un refus s’affiche en message, au-dessus du bouton', async () => {
    const { el, z, stable } = await monter();
    z.croisements.erreur.set('Cette zone n’existe pas dans cet espace.');
    await stable();
    const erreur = el.querySelector('[data-erreur]')!;
    expect(erreur.textContent).toContain('n’existe pas dans cet espace');
    expect(erreur.compareDocumentPosition(el.querySelector('[data-lire-croisements]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
