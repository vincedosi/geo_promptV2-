import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CiviqueApi, type ReponseSanteCommune, type SanteCommune } from '../../data/civique.api';
import { FicheSanteComponent } from './fiche-sante.component';

const DONNEE: SanteCommune = {
  code_insee: '13055', commune: 'Marseille', fetchedAt: '2026-10-10T08:00:00Z', source: 'Atmo France et AASQA', stale: true,
  air: {
    date: '2026-10-10', indice: 3, qualificatif: 'dégradé',
    sous_indices: { no2: 2, o3: 3, pm10: 1, pm25: null, so2: 1 },
    previsionJ1: { indice: 2, qualificatif: 'moyen' },
  },
  pollen: {
    date: '2026-10-10', indice_global: 4,
    especes: { ambroisie: 4, armoise: 0, aulne: 1, bouleau: 0, graminees: 2, olivier: 0 },
    previsionJ1: { indice: 3 }, previsionJ2: { indice: 5 },
  },
};

function monter() {
  const appels: string[] = [];
  const reponses: Subject<ReponseSanteCommune>[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CiviqueApi, useValue: { santeCommune: (c: string) => { appels.push(c); const s = new Subject<ReponseSanteCommune>(); reponses.push(s); return s; } } },
    ],
  });
  const fixture = TestBed.createComponent(FicheSanteComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  const poser = async (code: string | null, nom: string | null = null) => {
    fixture.componentRef.setInput('codeCommune', code);
    fixture.componentRef.setInput('nomCommune', nom);
    await rendre();
  };
  return { el, rendre, poser, appels, reponses };
}

const texte = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('FicheSanteComponent (HealthIndicatorCard)', () => {
  it('sans IRIS : l’invite de React, aucune requête', async () => {
    const { el, poser, appels } = monter();
    await poser(null);
    expect(texte(el.querySelector('[data-fiche-vide]'))).toBe('Cliquez sur un IRIS pour voir l\'air et les pollens du jour.');
    expect(appels).toEqual([]);
  });

  it('chargement : le squelette à deux colonnes ; puis la fiche — commune, badge cache, air, pollen, source', async () => {
    const { el, poser, rendre, appels, reponses } = monter();
    await poser('13055', 'Marseille');
    expect(appels).toEqual(['13055']);
    expect(el.querySelector('[data-fiche-squelette]')).not.toBeNull();
    reponses[0].next({ data: DONNEE });
    await rendre();
    const fiche = el.querySelector('[data-fiche-sante]')!;
    expect(texte(fiche.querySelector('[data-commune]'))).toBe('Marseille');
    expect(texte(fiche.querySelector('[data-cache]'))).toBe('cache');
    const air = fiche.querySelector('[data-bloc-air]')!;
    expect(texte(air)).toContain('dégradé');
    expect(texte(air)).toContain('3 / 6');
    const polluants = [...air.querySelectorAll('[data-polluant]')];
    expect(polluants.map((p) => p.getAttribute('title'))).toEqual([
      'NO₂ : niveau 2/6', 'O₃ : niveau 3/6', 'PM10 : niveau 1/6', 'PM2,5 : indisponible', 'SO₂ : niveau 1/6',
    ]);
    expect([...polluants[3].children].map((c) => texte(c))).toEqual(['PM2,5', '', '—']);
    expect(air.querySelector('[data-pastille]')!.getAttribute('style')).toContain('var(--atmo-level-3)');
    const pollen = fiche.querySelector('[data-bloc-pollen]')!;
    expect(texte(pollen)).toContain('élevé');
    expect(texte(pollen)).toContain('4 / 6');
    const especes = [...pollen.querySelectorAll<HTMLElement>('[data-espece]')];
    expect(especes.map((e) => e.getAttribute('title'))).toEqual([
      'Ambroisie : élevé', 'Armoise : indisponible', 'Aulne : très faible', 'Bouleau : indisponible', 'Graminées : faible', 'Olivier : indisponible',
    ]);
    expect(especes[1].style.opacity).toBe('0.45');
    expect(texte(fiche.querySelector('[data-source]'))).toBe(
      `Source : Atmo France et AASQA — Mis à jour le ${new Date('2026-10-10').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    );
    expect(fiche.querySelector('a')!.getAttribute('href')).toBe('https://map.atmo-france.org/?commune=13055');
  });

  it('prévisions : repliées, « ▸ Voir prévisions » les déplie (J+1 air et pollen, J+2 pollen)', async () => {
    const { el, poser, rendre, reponses } = monter();
    await poser('13055', 'Marseille');
    reponses[0].next({ data: DONNEE });
    await rendre();
    const bouton = el.querySelector<HTMLButtonElement>('[data-previsions]')!;
    expect(texte(bouton)).toBe('▸ Voir prévisions');
    expect(el.querySelector('[data-j1]')).toBeNull();
    bouton.click();
    await rendre();
    expect(texte(bouton)).toBe('▾ Masquer prévisions');
    expect(texte(el.querySelector('[data-j1]')).replace(/\s/g, '')).toBe('J+1Airmoyen·Pollenmodéré');
    expect(texte(el.querySelector('[data-j2]')).replace(/\s/g, '')).toBe('J+2Pollentrèsélevé');
  });

  it('commune déjà lue : servie du cache, sans requête', async () => {
    const { poser, rendre, appels, reponses } = monter();
    await poser('13055', 'Marseille');
    reponses[0].next({ data: DONNEE });
    await rendre();
    await poser('75056', 'Paris');
    await poser('13055', 'Marseille');
    expect(appels).toEqual(['13055', '75056']);
  });

  it('pas de donnée : le message de la route ; échec réseau : « Réessayer » relit', async () => {
    const { el, poser, rendre, appels, reponses } = monter();
    await poser('13055');
    reponses[0].next({ data: null, error: 'unavailable', message: 'Données ATMO + pollen indisponibles pour la commune 13055.' });
    await rendre();
    expect(texte(el.querySelector('[data-fiche-indisponible]'))).toBe('Données ATMO + pollen indisponibles pour la commune 13055.');
    await poser('75056');
    reponses[1].error(new HttpErrorResponse({ status: 0 }));
    await rendre();
    const erreur = el.querySelector('[data-fiche-erreur]')!;
    expect(texte(erreur.querySelector('span'))).toBe('Échec de chargement. Réessayer ?');
    expect(texte(erreur.querySelector('button'))).toBe('Réessayer');
    erreur.querySelector('button')!.click();
    await rendre();
    expect(appels).toEqual(['13055', '75056', '75056']);
    expect(el.querySelector('[data-fiche-squelette]')).not.toBeNull();
  });

  it('erreur HTTP AVEC corps JSON (400 code invalide) : son message, comme React', async () => {
    const { el, poser, rendre, reponses } = monter();
    await poser('XX');
    reponses[0].error(new HttpErrorResponse({ status: 400, error: { data: null, error: 'invalid_code', message: 'Code INSEE invalide.' } }));
    await rendre();
    expect(texte(el.querySelector('[data-fiche-indisponible]'))).toBe('Code INSEE invalide.');
  });
});
