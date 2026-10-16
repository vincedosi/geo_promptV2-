import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import type { EmplacementOoh } from '../logique/campagnes-ooh';
import { DETAIL_ESSAI } from '../testing/campagnes-ooh.fixture';
import { CampagneOohService } from './campagne-ooh.service';
import { FicheEmplacementOohComponent } from './fiche-emplacement-ooh.component';

function monter(cle: string) {
  const emplacementSelectionne = signal<EmplacementOoh | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CampagneOohService, useValue: { emplacementSelectionne, detail: signal(DETAIL_ESSAI) } },
      { provide: ConfigService, useValue: { valeur: { googleMapsKey: cle } } },
    ],
  });
  const fixture = TestBed.createComponent(FicheEmplacementOohComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, emplacementSelectionne };
}

/**
 * Les paires « libellé valeur » de la liste `[data-infos]`. Le compilateur Angular retire le blanc entre `</dt>` et
 * `<dd>` (pas de `preserveWhitespaces`) : `textContent` colle les deux (« Adresse1 Rue Essai »), d'où la reconstruction
 * (pré-vol P2).
 */
function paires(fiche: Element): string[] {
  return [...fiche.querySelectorAll('[data-infos] dt')].map((dt) => `${dt.textContent!.trim()} ${dt.nextElementSibling!.textContent!.trim()}`);
}

describe('FicheEmplacementOohComponent', () => {
  it('rien sans emplacement choisi', async () => {
    const { el, rendre } = monter('');
    await rendre();
    expect(el.querySelector('[data-fiche-emplacement-ooh]')).toBeNull();
  });

  it('tout ce que l on sait de l emplacement, sa géolocalisation, sa campagne et sa ligne', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await rendre();
    const fiche = el.querySelector('[data-fiche-emplacement-ooh]')!;
    expect(fiche.querySelector('[data-titre]')!.textContent!.trim()).toBe('Lieu p2');
    const infos = paires(fiche);
    for (const attendu of [
      'Adresse 1 Rue Essai', 'Ville 45000 Villetest', 'Réseau DOOH essai', 'Régie REGIE', 'Type de lieu campus', 'Écrans 2', 'Formats 10"',
      `Contacts / semaine ${formaterNombre(6000)}`, `Contacts 18-25 / semaine ${formaterNombre(5700)}`,
      'Géolocalisation À vérifier · Adresse (BAN)', 'Reconnu 1 Rue Essai 45000 Villetest',
      'Score 0,45', 'Campagne Campagne essai', 'Ligne REGIE · DOOH essai',
    ]) expect(infos, attendu).toContain(attendu);
  });

  it('« Données de la régie » : la ligne d origine en entier, repliée', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[0]);
    await rendre();
    const bloc = el.querySelector<HTMLDetailsElement>('[data-donnees-regie]')!;
    expect(bloc.open).toBe(false);
    expect(bloc.querySelector('summary')!.textContent!.trim()).toBe('Données de la régie');
    expect(bloc.textContent).toContain('LISTING CAMPUS, ligne 3');
    expect(bloc.textContent).toContain('Etablissement');
  });

  it('Street View : la vue au point, ou le bandeau qui nomme la variable manquante', async () => {
    const sans = monter('');
    sans.emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await sans.rendre();
    expect(sans.el.querySelector('[data-cle-manquante]')!.textContent!.trim()).toBe('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquante.');
    TestBed.resetTestingModule();
    const avec = monter('cle-essai');
    avec.emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await avec.rendre();
    expect(avec.el.querySelector('iframe[data-street-view]')!.getAttribute('src')).toContain('location=48.3,2.3');
  });

  it('« ✕ » ferme la fiche', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[0]);
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    expect(emplacementSelectionne()).toBeNull();
  });
});
