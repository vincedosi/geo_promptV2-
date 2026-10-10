import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeteoService } from '../../couches/meteo.service';
import { SectionMeteoComponent } from './section-meteo.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const appels: string[] = [];
  const meteo = {
    visible: signal(false),
    libelle: signal<string | null>(null),
    ouvrirDialogue: () => appels.push('ouvrir'),
    masquer: () => appels.push('masquer'),
  };
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), SelectionsCalquesService, { provide: MeteoService, useValue: meteo }],
  });
  const fixture = TestBed.createComponent(SectionMeteoComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, meteo, appels, selections: TestBed.inject(SelectionsCalquesService) };
}

describe('SectionMeteoComponent', () => {
  it('repliée par défaut ; ouverte : le texte de React et « Configurer la météo », sans « Masquer »', async () => {
    const { el, rendre, selections } = monter();
    await rendre();
    expect(el.textContent).toContain('Météo');
    expect(el.querySelector('[data-contenu-meteo]')).toBeNull();
    selections.basculerSection('meteo');
    await rendre();
    expect(el.textContent).toContain(
      'Données Open-Meteo agrégées par zone au choix — code postal, département ou région (précipitations, température, vent, ensoleillement). Historique 90 jours · prévisions 16 jours.',
    );
    expect(el.querySelector('[data-ouvrir-meteo]')!.textContent!.trim()).toBe('Configurer la météo');
    expect(el.querySelector('[data-masquer-meteo]')).toBeNull();
    expect(el.querySelector('[data-badge-meteo]')).toBeNull();
  });

  it('le bouton ouvre le dialogue', async () => {
    const { el, rendre, selections, appels } = monter();
    selections.basculerSection('meteo');
    await rendre();
    (el.querySelector('[data-ouvrir-meteo]') as HTMLButtonElement).click();
    expect(appels).toEqual(['ouvrir']);
  });

  it('couche active : compte 1, badge « Température actif », « Modifier la météo », « Masquer » qui masque', async () => {
    const { el, rendre, selections, meteo, appels } = monter();
    selections.basculerSection('meteo');
    meteo.visible.set(true);
    meteo.libelle.set('Température');
    await rendre();
    expect(el.querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('[data-badge-meteo]')!.textContent!.trim()).toBe('Température actif');
    expect(el.querySelector('[data-ouvrir-meteo]')!.textContent!.trim()).toBe('Modifier la météo');
    const masquer = el.querySelector('[data-masquer-meteo]') as HTMLButtonElement;
    expect(masquer.title).toBe('Masquer la couche météo');
    masquer.click();
    expect(appels).toEqual(['masquer']);
  });
});
