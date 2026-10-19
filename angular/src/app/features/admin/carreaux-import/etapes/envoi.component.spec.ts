import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportGeoApi } from '../data/import-geo.api';
import { ImportShapefileService } from '../etat/import-shapefile.service';
import { fichiersEssai } from '../testing/shapefile.fixture';
import { texte } from '../testing/aides';
import { EnvoiComponent } from './envoi.component';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('EnvoiComponent — étape 3 (`ImportStep.tsx`, lot 6, T14)', { timeout: 20_000 }, () => {
  async function monter(n = 5) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, ImportShapefileService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const etat = TestBed.inject(ImportShapefileService);
    await etat.lire(fichiersEssai(n));
    etat.choisirEtape(3);
    const f = TestBed.createComponent(EnvoiComponent);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement, etat, http: TestBed.inject(HttpTestingController) };
  }

  async function requete(http: HttpTestingController, url: string): Promise<TestRequest> {
    for (let i = 0; i < 50; i++) {
      const r = http.match(url);
      if (r.length) return r[0];
      await tick();
    }
    throw new Error(`aucune requête ${url}`);
  }

  it('avant le lancement : récapitulatif, bouton « Lancer l’insertion (N features) », terminal en attente, aucune requête', async () => {
    const { el, http } = await monter(1200);
    expect([...el.querySelectorAll('[data-recap]')].map((p) => [p.getAttribute('data-recap'), texte(p)])).toEqual([
      ['Features', '1 200'], ['Colonnes', '4'], ['Résolution', '200m'], ['Millésime', '2021'],
    ]);
    expect(texte(el.querySelector('button.lancer'))).toBe('Lancer l\'insertion (1 200 features)');
    expect(el.querySelector('mg-progression-import')).toBeNull();
    expect(texte(el.querySelector('.titre-terminal'))).toBe('Import logs');
    expect(texte(el.querySelector('[data-nb-lignes]'))).toBe('0 lignes');
    expect(texte(el.querySelector('.attente'))).toBe('En attente du lancement…');
    expect(el.querySelector('mg-journal')).toBeNull();
    expect(texte(el.querySelector('.boutons'))).toBe('Retour au mapping');
    http.verify();
  });

  it('lancement : progression « Envoi » déterminée dès le départ, « Retour au mapping » désactivé, journal ; puis « Enregistrement » et « ✓ Import terminé »', async () => {
    const { f, el, http } = await monter(5);
    el.querySelector<HTMLButtonElement>('button.lancer')!.click();
    await f.whenStable();
    expect(el.querySelector('button.lancer')).toBeNull();
    const prog = () => el.querySelector('mg-progression-import[data-envoi]')!;
    expect(texte(prog().querySelector('.font-mono'))).toBe('Envoi — 0 / 5');
    expect(prog().querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    expect(texte(prog().querySelector('[data-duree]'))).toBe('0s');
    expect(el.querySelector<HTMLButtonElement>('.boutons .secondaire')!.disabled).toBe(true);
    expect(texte(el.querySelector('[data-nb-lignes]'))).toBe('4 lignes');
    // I-2 : pendant l'envoi, l'écran dit ce que coûte un départ.
    expect(el.querySelector('[data-avertissement-envoi]')?.getAttribute('role')).toBe('note');
    expect(texte(el.querySelector('[data-avertissement-envoi]'))).toBe(
      'Restez dans « Importer » jusqu’à la fin : si l’envoi s’arrête, les lots déjà envoyés resteront en base sans source enregistrée.',
    );

    (await requete(http, '/api/admin/import-geo')).flush({ success: true, inserted: 5 });
    const reg = await requete(http, '/api/admin/import-geo/register');
    await f.whenStable();
    expect(texte(prog().querySelector('.font-mono'))).toBe('Enregistrement…');
    expect(prog().querySelector('[data-indeterminee]')).not.toBeNull();
    reg.flush({ success: true, source_id: 'src-1' });
    for (let i = 0; i < 5; i++) await tick();
    await f.whenStable();
    expect(texte(prog().querySelector('.font-mono'))).toBe('✓ Import terminé');
    expect(el.querySelector('[data-avertissement-envoi]')).toBeNull();
    expect(prog().querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    const lignes = [...el.querySelectorAll('[data-terminal] > div')].map((d) => texte(d));
    expect(lignes.at(-1)).toMatch(/^\[\d{2}:\d{2}:\d{2}\] ✓ Source enregistrée \(id: src-1\)$/);
    expect(lignes).toContainEqual(expect.stringMatching(/\] RAPPORT FINAL$/));
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('.boutons button')];
    expect(boutons.map((b) => [texte(b), b.disabled])).toEqual([['Retour au mapping', false], ['Nouvel import', false]]);
    expect(el.querySelector('button.lancer')).toBeNull();
  });

  it('lot en erreur : la barre finit en échec, au texte de React (« ! 1 lot(s) en erreur — 0/5 insérés »)', async () => {
    const { f, el, http } = await monter(5);
    el.querySelector<HTMLButtonElement>('button.lancer')!.click();
    (await requete(http, '/api/admin/import-geo')).flush({ success: false, error: 'boom' }, { status: 500, statusText: 'Erreur' });
    for (let i = 0; i < 5; i++) await tick();
    await f.whenStable();
    const prog = el.querySelector('mg-progression-import[data-envoi]')!;
    expect(texte(prog.querySelector('.font-mono'))).toBe('! 1 lot(s) en erreur — 0/5 insérés');
    expect(prog.querySelector('.remplissage.echec')).not.toBeNull();
  });
});
