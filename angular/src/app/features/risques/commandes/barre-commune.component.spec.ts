import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { ProfilRisqueApi } from '../data/profil-risque.api';
import { ReferentielApi } from '../data/referentiel.api';
import { SitesRisqueApi } from '../data/sites-risque.api';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { DonneesRisqueService } from '../etat/donnees-risque.service';
import { EtatRisqueService } from '../etat/etat-risque.service';
import { BarreCommuneComponent } from './barre-commune.component';

async function rendre() {
  TestBed.configureTestingModule({
    providers: [
      ChargementService, EtatRisqueService, DonneesRisqueService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
      { provide: ProfilRisqueApi, useValue: {
        bandes: () => NEVER,
        cibles: () => of({ cibles: [
          { code: 'ind', libelle: 'Population totale', famille: 'Population' },
          { code: 'pop_65_plus', libelle: '65 ans et plus', famille: 'Âge' },
        ] }),
      } },
      { provide: ZonesRisqueApi, useValue: { courbe: () => NEVER } },
      { provide: SitesRisqueApi, useValue: { compter: () => NEVER } },
      { provide: ReferentielApi, useValue: {
        geo: () => of({ regions: [{ code_region: '93', nom_region: 'Provence-Alpes-Côte d’Azur', depts: [{ code_dept: '13', nom_dept: 'Bouches-du-Rhône' }] }] }),
        contours: () => NEVER,
      } },
    ],
  });
  const f = TestBed.createComponent(BarreCommuneComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const bouton = (libelle: string) => {
    const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === libelle);
    if (!b) throw new Error(`bouton introuvable : ${libelle}`);
    return b;
  };
  return {
    f, el, bouton,
    etat: TestBed.inject(EtatRisqueService),
    donnees: TestBed.inject(DonneesRisqueService),
    cliquer: async (libelle: string) => { bouton(libelle).click(); await f.whenStable(); },
  };
}

describe('BarreCommuneComponent', () => {
  it('décocher le DERNIER niveau réglementaire est refusé : il reste coché', async () => {
    const r = await rendre();
    expect(r.etat.etat().gravites).toEqual(['seveso_haut', 'seveso_bas']);
    await r.cliquer('Seveso seuil bas');
    expect(r.etat.etat().gravites).toEqual(['seveso_haut']);
    await r.cliquer('Seveso seuil haut');
    expect(r.etat.etat().gravites).toEqual(['seveso_haut']);
    expect(r.bouton('Seveso seuil haut').getAttribute('aria-pressed')).toBe('true');
  });

  it('la dernière nature de zone est gardée de même', async () => {
    const r = await rendre();
    await r.cliquer('Périmètre PPRT');
    await r.cliquer('Rayon calculé');
    expect(r.etat.etat().modes).toEqual(['buffer']);
  });

  it('« Lister par » Commune, puis Région (la maille naturelle) → `mailleChoisie` revient à null', async () => {
    const r = await rendre();
    await r.cliquer('Commune');
    expect(r.donnees.mailleChoisie()).toBe('commune');
    expect(r.bouton('Commune').getAttribute('aria-pressed')).toBe('true');
    await r.cliquer('Région');
    expect(r.donnees.mailleChoisie()).toBeNull();
    expect(r.donnees.dimension()).toBe('region');
  });

  it('« Lister par » oublie le survol et la sélection de ③ : la région 93 n’est pas la Seine-Saint-Denis', async () => {
    const r = await rendre();
    r.donnees.survoler('93');
    r.donnees.selectionner('93');
    await r.cliquer('Département');
    expect(r.donnees.dimension()).toBe('departement');
    expect(r.donnees.actif()).toBeNull();
    expect(r.donnees.selectionCarte()).toBeNull();
  });

  it('les infobulles de « Lister par » sont celles de React, mot pour mot', async () => {
    const r = await rendre();
    expect(r.bouton('Commune').title).toBe('Le carroyage INSEE porte le code commune tel qu’il l’écrit : Paris, Lyon et Marseille y sont par arrondissement.');
    expect(r.bouton('Code postal').title).toBe('Ni part ni densité à cette maille : le seul référentiel de population par code postal surcompte de 10,5 %.');
    expect(r.bouton('Région').hasAttribute('title')).toBe(false);
  });

  it('les menus : cibles groupées par famille, territoire « code — nom » qui écrit `etat.chemin`', async () => {
    const r = await rendre();
    const [cible, territoire] = [...r.el.querySelectorAll('select')];
    expect([...cible.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Population', 'Âge']);
    expect(cible.value).toBe('ind');
    expect([...territoire.querySelectorAll('option')].map((o) => o.textContent?.trim())).toEqual([
      'France entière', 'Provence-Alpes-Côte d’Azur', '13 — Bouches-du-Rhône',
    ]);
    territoire.value = 'departement:13';
    territoire.dispatchEvent(new Event('change'));
    await r.f.whenStable();
    expect(r.etat.etat().chemin).toEqual(['departement:13']);
    expect(territoire.value).toBe('departement:13');
  });

  it('« Lecture des zones » bascule `fusionner`', async () => {
    const r = await rendre();
    await r.cliquer('Site par site');
    expect(r.etat.etat().fusionner).toBe(false);
    await r.cliquer('Fusionnées');
    expect(r.etat.etat().fusionner).toBe(true);
  });
});
