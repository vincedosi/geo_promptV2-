import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import type { OrganisationListe } from '../../commun/data/organisations-liste.api';
import { SourcesAdminApi, type ZoneAdmin } from '../data/sources-admin.api';
import { ZonesCustomComponent } from './zones-custom.component';

const URL_LISTE = '/api/admin/custom-geo/list';
const GLOBAL = '00000000-0000-0000-0000-000000000001';

function zone(p: Partial<ZoneAdmin> & { id: string; name: string }): ZoneAdmin {
  return {
    description: null, org_id: GLOBAL, org_name: 'GENESIS (Global)', source_type: 'composite', source_metadata: {},
    feature_count_iris: 9834, feature_count_cp: 1641, bbox: null, created_at: '2026-07-10T09:16:13.790Z', created_by: null, ...p,
  };
}

const ZONES: ZoneAdmin[] = [
  zone({ id: 'z1', name: 'Cible composite (2 zones) — juil. 2026' }),
  zone({ id: 'z2', name: 'Revenu médian ≥ 27500 € — juil. 2026', source_type: 'indicator_threshold', feature_count_iris: 7056, feature_count_cp: 1271, description: 'Seuil sur le revenu' }),
  zone({ id: 'z3', name: 'Zone orpheline', org_id: 'o2', org_name: null, source_type: 'rayon', feature_count_iris: 12, feature_count_cp: 3, created_at: '2026-04-29T14:19:08.965Z' }),
];
const ORGANISATIONS: OrganisationListe[] = [{ id: GLOBAL, name: 'GENESIS (Global)' }, { id: 'o2', name: 'Espace B' }];

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const espaces = (s: string) => s.replace(/\s/g, ' ');
/** Les nœuds texte d'un élément, joints par une espace (Angular retire les blancs ENTRE éléments). */
function mots(e: Element): string {
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const l: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent?.replace(/\s+/g, ' ').trim(); if (t) l.push(t); }
  return l.join(' ');
}
/** Date attendue, calculée comme `fmtDate` de React (fuseau de la machine de test). */
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

describe('ZonesCustomComponent — onglet Zones perso des Sources : filtres, tableau, suppression (lot 6, T20)', () => {
  let f: ComponentFixture<ZonesCustomComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    doublerDialog();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(ZonesCustomComponent);
    f.componentRef.setInput('organisations', ORGANISATIONS);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());

  const stable = () => f.whenStable();
  const lecture = (): TestRequest => http.expectOne((r) => r.url === URL_LISTE);
  const lignes = () => [...el.querySelectorAll<HTMLElement>('tbody tr[data-zone]')];
  const org = () => el.querySelector<HTMLSelectElement>('[data-filtre-org]')!;
  const type = () => el.querySelector<HTMLSelectElement>('[data-filtre-type]')!;
  const recherche = () => el.querySelector<HTMLInputElement>('[data-recherche]')!;
  const dialogue = () => el.querySelector('mg-dialogue-suppression-zone');

  async function servir(zones: ZoneAdmin[] = ZONES) {
    lecture().flush({ zones, total: zones.length });
    await stable();
  }

  it('montage : UNE lecture sans filtre, « Chargement... », puis en-tête, tableau et pied aux textes de React', async () => {
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement...');
    const r = lecture();
    expect(r.request.params.keys()).toEqual([]);
    r.flush({ zones: ZONES, total: 3 });
    await stable();
    expect(texte(el.querySelector('[data-entete]'))).toBe('Zones perso — 3 zones sur 2 workspaces');
    expect([...el.querySelectorAll('thead th')].map(texte)).toEqual(['Nom', 'Workspace', 'Type', 'IRIS', 'CP', 'Créé le', '']);
    expect(lignes().map((l) => [...l.querySelectorAll('td')].slice(0, 6).map((c) => espaces(mots(c))))).toEqual([
      ['Cible composite (2 zones) — juil. 2026', 'GENESIS (Global)', 'composite', '9 834', '1 641', date('2026-07-10T09:16:13.790Z')],
      ['Revenu médian ≥ 27500 € — juil. 2026 Seuil sur le revenu', 'GENESIS (Global)', 'indicator_threshold', '7 056', '1 271', date('2026-07-10T09:16:13.790Z')],
      ['Zone orpheline', '—', 'rayon', '12', '3', date('2026-04-29T14:19:08.965Z')],
    ]);
    expect(espaces(texte(el.querySelector('[data-pied]')))).toBe('3 zones — 16 902 IRIS — 2 915 CP résolus');
    expect(lignes()[0].querySelector('[data-supprimer]')!.getAttribute('title')).toBe('Supprimer la zone');
  });

  it('singulier : « 1 zone sur 1 workspace » ; vide sans filtre : texte de React', async () => {
    await servir([ZONES[0]]);
    expect(texte(el.querySelector('[data-entete]'))).toBe('Zones perso — 1 zone sur 1 workspace');
    expect(espaces(texte(el.querySelector('[data-pied]')))).toBe('1 zone — 9 834 IRIS — 1 641 CP résolus');
    f.destroy();
    f = TestBed.createComponent(ZonesCustomComponent);
    el = f.nativeElement as HTMLElement;
    await stable();
    await servir([]);
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune zone personnalisee dans aucun workspace pour l\'instant.');
    expect(el.querySelector('[data-pied]')).toBeNull();
    expect(texte(el.querySelector('[data-entete]'))).toBe('Zones perso — 0 zone sur 0 workspace');
  });

  it('filtres : espaces (« Tous les workspaces » + liste fournie), types DÉRIVÉS des zones lues ; chaque choix relit avec le paramètre exact', async () => {
    await servir();
    expect([...org().options].map((o) => [o.value, texte(o)])).toEqual([['', 'Tous les workspaces'], [GLOBAL, 'GENESIS (Global)'], ['o2', 'Espace B']]);
    expect([...type().options].map((o) => texte(o))).toEqual(['Tous les types', 'composite', 'indicator_threshold', 'rayon']);

    org().value = 'o2';
    org().dispatchEvent(new Event('change'));
    await stable();
    let r = lecture();
    expect(r.request.urlWithParams).toBe(`${URL_LISTE}?org_id=o2`);
    r.flush({ zones: [ZONES[2]] });
    await stable();

    type().value = 'rayon';
    type().dispatchEvent(new Event('change'));
    await stable();
    r = lecture();
    expect(r.request.urlWithParams).toBe(`${URL_LISTE}?org_id=o2&source_type=rayon`);
    r.flush({ zones: [] });
    await stable();
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune zone ne correspond a ces filtres.');

    org().value = '';
    org().dispatchEvent(new Event('change'));
    await stable();
    expect(lecture().request.urlWithParams).toBe(`${URL_LISTE}?source_type=rayon`);
  });

  it('recherche : relue 200 ms après la frappe (anti-rebond de React), une seule fois ; pied préfixé « Filtres actifs : »', async () => {
    await servir();
    recherche().value = 'cib';
    recherche().dispatchEvent(new Event('input'));
    recherche().value = 'cible';
    recherche().dispatchEvent(new Event('input'));
    await stable();
    http.expectNone((r) => r.url === URL_LISTE);
    await new Promise((fin) => setTimeout(fin, 230));
    const r = lecture();
    expect(r.request.urlWithParams).toBe(`${URL_LISTE}?q=cible`);
    r.flush({ zones: [ZONES[0]] });
    await stable();
    expect(espaces(texte(el.querySelector('[data-pied]')))).toBe('Filtres actifs : 1 zone — 9 834 IRIS — 1 641 CP résolus');
    expect(recherche().placeholder).toBe('Rechercher...');
  });

  it('lecture en échec : bandeau « Erreur : HTTP 500 » (texte de React, sans le corps), tableau vide', async () => {
    lecture().flush({ error: 'Access denied: super_admin role required' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('Erreur : HTTP 500');
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune zone personnalisee dans aucun workspace pour l\'instant.');
  });

  it('suppression : la corbeille ouvre le dialogue de LA zone ; confirmer → DELETE, ligne retirée, dialogue fermé, relecture aux mêmes filtres', async () => {
    await servir();
    expect(dialogue()).toBeNull();
    lignes()[1].querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await stable();
    expect(texte(dialogue()!.querySelector('[data-titre]'))).toBe('Supprimer "Revenu médian ≥ 27500 € — juil. 2026" ?');
    dialogue()!.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    const d = http.expectOne('/api/admin/custom-geo/z2');
    expect(d.request.method).toBe('DELETE');
    expect(texte(dialogue()!.querySelector('[data-confirmer]'))).toBe('Suppression...');
    d.flush({ deleted: true, id: 'z2' });
    await stable();
    expect(dialogue()).toBeNull();
    // React retire la ligne puis relit aussitôt : « Chargement... » pendant la relecture, comme ici.
    expect(el.querySelector('[data-chargement]')).not.toBeNull();
    const r = lecture();
    expect(r.request.params.keys()).toEqual([]);
    r.flush({ zones: [ZONES[0], ZONES[2]] });
    await stable();
    expect(lignes().map((l) => l.getAttribute('data-zone'))).toEqual(['z1', 'z3']);
  });

  it('suppression refusée : message de la route DANS le dialogue, qui reste ouvert ; « Annuler » ferme et efface le message', async () => {
    await servir();
    lignes()[0].querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await stable();
    dialogue()!.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    http.expectOne('/api/admin/custom-geo/z1').flush({ error: 'violates foreign key constraint' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(dialogue()!.querySelector('[data-erreur-suppression]'))).toBe('violates foreign key constraint');
    expect(lignes()).toHaveLength(3);
    dialogue()!.querySelector<HTMLButtonElement>('[data-annuler]')!.click();
    await stable();
    expect(dialogue()).toBeNull();
    lignes()[0].querySelector<HTMLButtonElement>('[data-supprimer]')!.click();
    await stable();
    expect(dialogue()!.querySelector('[data-erreur-suppression]')).toBeNull();
    dialogue()!.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    // React : `res.json().catch(() => ({ error: 'Erreur' }))` puis `data.error ?? 'HTTP <statut>'`.
    http.expectOne('/api/admin/custom-geo/z1').flush('<html>502</html>', { status: 502, statusText: 'Bad Gateway' });
    await stable();
    expect(texte(dialogue()!.querySelector('[data-erreur-suppression]'))).toBe('Erreur');
    dialogue()!.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    http.expectOne('/api/admin/custom-geo/z1').flush({}, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(dialogue()!.querySelector('[data-erreur-suppression]'))).toBe('HTTP 500');
    dialogue()!.querySelector<HTMLButtonElement>('[data-confirmer]')!.click();
    await stable();
    http.expectOne('/api/admin/custom-geo/z1').error(new ProgressEvent('error'));
    await stable();
    expect(texte(dialogue()!.querySelector('[data-erreur-suppression]'))).toBe('Failed to fetch');
  });
});
