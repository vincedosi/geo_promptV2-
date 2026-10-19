import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { DepotComponent } from './depot.component';
import { texte } from '../../testing/dom';
import { fournisseursImportPoi } from '../testing/fournisseurs';

const URL_PARSE = '/api/admin/import-poi/parse';
/** Angular retire les blancs ENTRE éléments : on compare les textes des enfants un à un. */
const enfants = (e: Element | null | undefined, sel: string) => [...(e?.querySelectorAll(sel) ?? [])].map((x) => texte(x));

/** jsdom n'a ni DragEvent ni DataTransfer : un événement portant `dataTransfer.files`. */
function deposer(el: HTMLElement, fichiers: File[]): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: fichiers, dropEffect: 'none' } });
  el.querySelector('[data-zone]')!.dispatchEvent(e);
}

async function monter() {
  TestBed.configureTestingModule({ providers: fournisseursImportPoi() });
  const f = TestBed.createComponent(DepotComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
}

describe('mg-import-depot — étape 01 « Upload fichier » (`UploadStep.tsx`, lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('au repos : titre, consigne et formats de React, encart « Formats supportes », champ multiple aux extensions de React, aucune requête', async () => {
    const { el } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('01');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Upload fichier');
    expect(enfants(el.querySelector('[data-zone]'), '.consigne, .formats')).toEqual([
      'Glissez un ou plusieurs fichiers ici ou cliquez pour selectionner', '// formats: .csv .xlsx .geojson | Shapefile (.shp+.dbf+.prj+.shx)',
    ]);
    const champ = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(champ.multiple).toBe(true);
    expect(champ.getAttribute('accept')).toBe('.csv,.xlsx,.geojson,.json,.txt,.tsv,.shp,.dbf,.prj,.shx');
    expect(enfants(el.querySelector('[data-formats]'), '.titre-formats, li')).toEqual([
      'Formats supportes',
      'Fichier unique : CSV, XLSX, TSV, GeoJSON',
      'Shapefile : Selectionnez les fichiers .shp, .dbf, .prj, .shx ensemble (meme nom de base).',
      'Carreaux INSEE : Le systeme detecte automatiquement les colonnes.',
    ]);
    expect(el.querySelector('[data-lignes]')).toBeNull();
  });

  it('dépôt de 3 fichiers : UN envoi aux 3 fichiers, « Analyse du fichier... » pendant l’analyse', async () => {
    const { f, el, http } = await monter();
    deposer(el, ['z.shp', 'z.dbf', 'z.prj'].map((n) => new File(['x'], n)));
    await f.whenStable();
    expect(texte(el.querySelector('[data-zone]'))).toBe('Analyse du fichier...');
    const corps = http.expectOne(URL_PARSE).request.body as FormData;
    expect((corps.getAll('files') as File[]).map((x) => x.name)).toEqual(['z.shp', 'z.dbf', 'z.prj']);
  });

  it('analyse réussie : nom et « 0.00 MB — Cliquez pour changer », badge « 10 lignes », ligne d’information, aperçu replié (8 colonnes au plus), plus d’encart', async () => {
    const { f, el, http } = await monter();
    deposer(el, [new File(['x'.repeat(856)], 'poi-essai.csv')]);
    http.expectOne(URL_PARSE).flush(ANALYSE_POI_ESSAI);
    await f.whenStable();
    expect(enfants(el.querySelector('[data-zone]'), '.nom-fichier, .taille')).toEqual(['poi-essai.csv', '0.00 MB — Cliquez pour changer']);
    expect(texte(el.querySelector('[data-lignes]'))).toBe('10 lignes');
    expect(enfants(el.querySelector('[data-infos]'), ':scope > span')).toEqual(
      ['format: csv', 'encoding: utf-8', 'separator: ";"', 'colonnes: 8', 'lignes: 10'],
    );
    const apercu = el.querySelector<HTMLDetailsElement>('details[data-apercu]')!;
    expect(apercu.open).toBe(false);
    expect(texte(apercu.querySelector('summary'))).toBe('Apercu — 5 premieres lignes');
    expect([...apercu.querySelectorAll('th')].map((t) => texte(t))).toEqual(
      ['nom', 'adresse', 'code_postal', 'ville', 'latitude', 'longitude', 'capacite', 'statut'],
    );
    expect(apercu.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(texte(apercu.querySelector('tbody td'))).toBe('[ESSAI lot 6] POI 01');
    expect(el.querySelector('[data-formats]')).toBeNull();
    expect(el.querySelector('[data-shapefile]')).toBeNull();
  });

  it('séparateur tabulation → `TAB` ; au-delà de 8 colonnes, une colonne « ... » ; valeur nulle → « null »', async () => {
    const { f, el, http } = await monter();
    deposer(el, [new File(['x'], 'large.tsv')]);
    const colonnes = Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, sampleValues: [], nullCount: 0 }));
    http.expectOne(URL_PARSE).flush({
      ...ANALYSE_POI_ESSAI, separator: '\t', columns: colonnes, preview: [{ c0: null }], suggestedMapping: {},
    });
    await f.whenStable();
    expect(texte(el.querySelector('[data-infos]'))).toContain('separator: TAB');
    const ths = [...el.querySelectorAll('details[data-apercu] th')].map((t) => texte(t));
    expect(ths).toHaveLength(9);
    expect(ths[8]).toBe('...');
    expect(texte(el.querySelector('details[data-apercu] tbody td'))).toBe('null');
  });

  it('Shapefile : « Shapefile bundle — N enregistrements », encart [OK], pas de séparateur', async () => {
    const { f, el, http } = await monter();
    deposer(el, ['z.shp', 'z.dbf'].map((n) => new File(['x'], n)));
    http.expectOne(URL_PARSE).flush({ ...ANALYSE_POI_ESSAI, format: 'shapefile', totalRows: 1234 });
    await f.whenStable();
    expect(enfants(el.querySelector('[data-zone]'), '.nom-fichier, .taille')).toEqual(['z.shp', 'Shapefile bundle — 1 234 enregistrements']);
    expect(texte(el.querySelector('[data-infos]'))).not.toContain('separator');
    expect(texte(el.querySelector('[data-shapefile]'))).toBe(
      '[OK] Shapefile detecte et parse avec succes. Les attributs du fichier .dbf sont maintenant disponibles.',
    );
  });

  it('refus de la route : « ! <erreur> », ni badge ni information', async () => {
    const { f, el, http } = await monter();
    deposer(el, [new File(['x'], 'a.pdf')]);
    http.expectOne(URL_PARSE).flush({ success: false, error: 'Format non supporté: .pdf' }, { status: 400, statusText: 'Bad Request' });
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Format non supporté: .pdf');
    expect(el.querySelector('[data-lignes]')).toBeNull();
    expect(el.querySelector('[data-infos]')).toBeNull();
  });
});
