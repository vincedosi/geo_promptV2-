import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportGeoApi } from '../data/import-geo.api';
import { ImportShapefileService } from '../etat/import-shapefile.service';
import { fichiersEssai } from '../testing/shapefile.fixture';
import { deposer, texte } from '../testing/aides';
import { FichiersComponent } from './fichiers.component';

describe('FichiersComponent — étape 1 (`FilesStep.tsx`, lot 6, T14)', { timeout: 20_000 }, () => {
  async function monter() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, ImportShapefileService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const f = TestBed.createComponent(FichiersComponent);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement, etat: TestBed.inject(ImportShapefileService), http: TestBed.inject(HttpTestingController) };
  }

  it('au repos : zone de dépôt multiple (.shp, .dbf, .prj, .shx), textes de React, marge 48px 24px, aucune requête', async () => {
    const { el, http } = await monter();
    const zone = el.querySelector<HTMLElement>('[data-zone]')!;
    const champ = zone.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(champ.accept).toBe('.shp,.dbf,.prj,.shx');
    expect(champ.multiple).toBe(true);
    expect(zone.style.padding).toBe('48px 24px');
    expect(zone.classList).toContain('fond-surface');
    expect([...zone.querySelectorAll('p')].map((p) => texte(p))).toEqual([
      'Glissez vos fichiers Shapefile ici', '.shp + .dbf + .prj + .shx — sélection multiple obligatoire',
    ]);
    expect(el.querySelector('[data-resume]')).toBeNull();
    expect(el.querySelector('mg-progression-import')).toBeNull();
    http.verify();
  });

  it('dépôt du bundle jetable : progression « Lecture des fichiers » pendant la lecture, puis le résumé de React', async () => {
    const { f, el, etat } = await monter();
    deposer(el, fichiersEssai(50));
    await f.whenStable();
    // Avant le .dbf, aucun total : barre indéterminée, étape nommée.
    const prog = el.querySelector('mg-progression-import[data-lecture]');
    expect(prog).not.toBeNull();
    expect(texte(prog!.querySelector('.font-mono'))).toBe('Lecture des fichiers…');
    expect(prog!.querySelector('[data-indeterminee]')).not.toBeNull();
    while (etat.lectureEnCours()) await new Promise((r) => setTimeout(r, 10));
    await f.whenStable();
    expect(el.querySelector('mg-progression-import')).toBeNull();
    const resume = el.querySelector('[data-resume]')!;
    expect(texte(resume.querySelector('[data-nom]'))).toBe('carreaux-essai');
    expect(texte(resume.querySelector('[data-detail]'))).toBe('50 features · 4 colonnes · CRS: EPSG:2154');
    expect([...resume.querySelectorAll('.puces:not(.serrees) .puce')].map((p) => texte(p))).toEqual([
      '.shp 7 KB', '.dbf 3 KB', '.prj 449 B', '.shx 500 B',
    ]);
    expect([...resume.querySelectorAll('.colonne')].map((p) => texte(p))).toEqual([
      'idcar_200mabc', 'ind123', 'men123', 'lcog_geoabc',
    ]);
    const continuer = resume.querySelector<HTMLButtonElement>('button.principal')!;
    expect(texte(continuer)).toBe('Continuer — Mapping des colonnes');
    continuer.click();
    expect(etat.etape()).toBe(2);
  });

  it('fichier manquant : « ! Fichier .shp manquant… » en alerte', async () => {
    const { f, el } = await monter();
    deposer(el, [fichiersEssai(3)[2]]);
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    await f.whenStable();
    expect(texte(el.querySelector('[role="alert"]'))).toBe(
      '! Fichier .shp manquant. Sélectionnez les 4 fichiers du Shapefile (.shp, .dbf, .prj, .shx).');
  });
});
