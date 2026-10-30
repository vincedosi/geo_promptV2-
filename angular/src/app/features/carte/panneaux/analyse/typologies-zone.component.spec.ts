import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { COUCHE_TYPOLOGIES, COUCHE_TYPOLOGIES_SURVOL } from '../../couches/couche-typologies';
import { CouvertureApi } from '../../data/couverture.api';
import { AnalysesPeintesService } from '../../etat/analyses-peintes';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { FOURNIR_TIROIRS_ANALYSE, TIROIRS_ANALYSE } from '../../etat/tiroirs-analyse';
import { TypologiesZoneService } from '../../etat/typologies-zone.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { MESSAGE_AUCUN_POI_TYPE, type ResultatTypologies } from '../../logique/analyses/typologies';
import { TypologiesZoneComponent } from './typologies-zone.component';

const Z1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const Z2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const RESULTAT: ResultatTypologies = {
  modeles: [
    { duree: 15, mode: 'drive', version: 3, typologies: [
      { cluster_id: 0, label: 'Urbain dense', n_poi: 2, population: 120_000, profil: null },
      { cluster_id: 1, label: null, n_poi: 1, population: 30_000, profil: null },
    ] },
    { duree: 60, mode: 'drive', version: 4, typologies: [{ cluster_id: 0, label: 'Rural', n_poi: 3, population: 400_000, profil: null }] },
  ],
  pois: [
    { poi_id: 'a', nom: 'CIRFA Rennes', lat: 48.1, lng: -1.68, categorie: 'cirfa', duree: 15, mode: 'drive', version: 3, cluster_id: 0, cluster_label: 'Urbain dense', population: 70_000 },
    { poi_id: 'b', nom: 'CIRFA Brest', lat: 48.39, lng: -4.49, categorie: 'cirfa', duree: 15, mode: 'drive', version: 3, cluster_id: 0, cluster_label: 'Urbain dense', population: 50_000 },
    { poi_id: 'c', nom: 'CIRFA Vannes', lat: 47.66, lng: -2.76, categorie: 'cirfa', duree: 15, mode: 'drive', version: 3, cluster_id: 1, cluster_label: null, population: 30_000 },
    { poi_id: 'a', nom: 'CIRFA Rennes', lat: 48.1, lng: -1.68, categorie: 'cirfa', duree: 60, mode: 'drive', version: 4, cluster_id: 0, cluster_label: 'Rural', population: 400_000 },
  ],
  tronque: false, motif: null,
};

/** Une carte minimale : sources, couches, filtres. */
function carteFactice() {
  const sources = new Map<string, { donnees: unknown; setData(d: unknown): void }>();
  const couches = new Map<string, { paint: Record<string, unknown>; filter?: unknown }>();
  return {
    sources, couches,
    isStyleLoaded: () => true, once: () => undefined, off: () => undefined,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => { sources.set(id, { donnees: s.data, setData(d: unknown) { this.donnees = d; } }); },
    getLayer: (id: string) => couches.get(id),
    addLayer: (c: { id: string; paint: Record<string, unknown>; filter?: unknown }) => { couches.set(c.id, { paint: c.paint, filter: c.filter }); },
    removeLayer: (id: string) => { couches.delete(id); },
    removeSource: (id: string) => { sources.delete(id); },
    setFilter: (id: string, f: unknown) => { couches.get(id)!.filter = f; },
    getStyle: () => ({ layers: [...couches.keys()].map((id) => ({ id })) }),
  };
}

async function monter(zone: string | null = Z1) {
  const reponses: Subject<ResultatTypologies>[] = [];
  const typologies = vi.fn((_id: string) => { const s = new Subject<ResultatTypologies>(); reponses.push(s); return s; });
  const zoneId = signal<string | null>(zone);
  const ligne = signal<{ id: string; updated_at?: string } | null>(zone ? { id: zone, updated_at: '2026-10-30T10:00:00Z' } : null);
  const carte = carteFactice();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), FOURNIR_TIROIRS_ANALYSE, TypologiesZoneService, AnalysesPeintesService,
      { provide: CouvertureApi, useValue: { typologies } },
      { provide: ZoneAnalyseeService, useValue: { zoneId, ligne, siIntrouvable: (e: unknown) => {
        const oui = e instanceof HttpErrorResponse && (e.error as { refus?: string })?.refus === 'zone_introuvable';
        if (oui) zoneId.set(null);
        return oui;
      } } },
      { provide: CouchesCarteService, useValue: { carteCourante: signal(carte), inscrireEffacement: () => undefined } },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])) } },
    ],
  });
  const f = TestBed.createComponent(TypologiesZoneComponent);
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { await new Promise((r) => setTimeout(r, 0)); await f.whenStable(); };
  await stable();
  const basculer = async () => { el.querySelector<HTMLButtonElement>('[data-entete-outil]')!.click(); await stable(); };
  const servir = async (r: ResultatTypologies = RESULTAT, i = reponses.length - 1) => { reponses[i].next(r); reponses[i].complete(); await stable(); };
  return { f, el, typologies, reponses, zoneId, ligne, carte, stable, basculer, servir, tiroirs: TestBed.inject(TIROIRS_ANALYSE) };
}

describe('mg-typologies-zone (④ finitions, T8)', () => {
  it('aucune lecture avant le premier dépli ; une seule par (zone, version) ; rouvrir ne relit rien', async () => {
    const m = await monter();
    expect(m.typologies).not.toHaveBeenCalled();
    await m.basculer();
    expect(m.typologies).toHaveBeenCalledTimes(1);
    expect(m.typologies).toHaveBeenCalledWith(Z1);
    await m.servir();
    await m.basculer();
    await m.basculer();
    expect(m.typologies).toHaveBeenCalledTimes(1);
    // Une zone recalculée (nouvelle version) est relue, une fois.
    m.ligne.set({ id: Z1, updated_at: '2026-10-30T11:00:00Z' });
    await m.stable();
    expect(m.typologies).toHaveBeenCalledTimes(2);
  });

  it('sans zone analysée : « Choisissez une zone en tête de ④. », aucune lecture', async () => {
    const m = await monter(null);
    await m.basculer();
    expect(m.el.querySelector('[data-sans-zone]')!.textContent!.trim()).toBe('Choisissez une zone en tête de ④.');
    expect(m.typologies).not.toHaveBeenCalled();
  });

  it('aucun POI typé : le texte d’A-7', async () => {
    const m = await monter();
    await m.basculer();
    await m.servir({ modeles: [], pois: [], tronque: false, motif: 'aucun_poi_type' });
    expect(m.el.querySelector('[data-aucun-poi-type]')!.textContent!.trim()).toBe(MESSAGE_AUCUN_POI_TYPE);
    expect(m.carte.couches.size).toBe(0);
  });

  it('un tableau par (durée, mode) : typologie, nombre de POI, population ; le premier modèle peint, colorés par typologie', async () => {
    const m = await monter();
    await m.basculer();
    await m.servir();
    expect([...m.el.querySelectorAll('[data-pastille]')].map((b) => b.textContent!.trim())).toEqual(['15 min · voiture', '60 min · voiture']);
    const lignes = [...m.el.querySelectorAll('[data-typologie]')]
      .map((l) => [...l.querySelectorAll('td')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()).join(' | '));
    expect(lignes).toEqual(['Urbain dense | 2 | 120 000', 'Typologie 2 | 1 | 30 000']);
    const donnees = m.carte.sources.get('couverture-typologies')!.donnees as GeoJSON.FeatureCollection;
    expect(donnees.features.map((x) => x.properties!['couleur'])).toEqual(['couleur:t1', 'couleur:t1', 'couleur:t2']);
    expect(m.carte.couches.get(COUCHE_TYPOLOGIES)!.paint['circle-stroke-color']).toBe('couleur:contour');
    // Le second modèle : ses POI seulement.
    m.el.querySelector<HTMLButtonElement>('[data-pastille="60-drive"]')!.click();
    await m.stable();
    expect((m.carte.sources.get('couverture-typologies')!.donnees as GeoJSON.FeatureCollection).features).toHaveLength(1);
  });

  it('survol d’une ligne : les POI de sa typologie en surbrillance ; sortie : plus aucun', async () => {
    const m = await monter();
    await m.basculer();
    await m.servir();
    m.el.querySelector('[data-typologie="1"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    await m.stable();
    expect(m.carte.couches.get(COUCHE_TYPOLOGIES_SURVOL)!.filter).toEqual(['==', ['get', 'cluster_id'], 1]);
    m.el.querySelector('[data-typologie="1"]')!.dispatchEvent(new MouseEvent('mouseleave'));
    await m.stable();
    expect(m.carte.couches.get(COUCHE_TYPOLOGIES_SURVOL)!.filter).toEqual(['==', ['get', 'cluster_id'], -1]);
  });

  it('P-c : la réponse d’une zone quittée est jetée ; la nouvelle zone est lue, la couche retirée entre-temps', async () => {
    const m = await monter();
    await m.basculer();
    m.zoneId.set(Z2);
    m.ligne.set({ id: Z2, updated_at: '2026-10-30T10:00:00Z' });
    await m.stable();
    expect(m.reponses[0].observed).toBe(false);
    expect(m.typologies).toHaveBeenLastCalledWith(Z2);
    await m.servir(RESULTAT, 1);
    expect(m.carte.couches.has(COUCHE_TYPOLOGIES)).toBe(true);
    m.zoneId.set(null);
    await m.stable();
    expect(m.carte.couches.has(COUCHE_TYPOLOGIES)).toBe(false);
  });

  it('un tiroir de ④ : ouvrir les typologies replie la couverture ; peintes, elles allument la pastille de ④', async () => {
    const m = await monter();
    expect(m.tiroirs.estOuvert('couverture')).toBe(true);
    await m.basculer();
    expect(m.tiroirs.estOuvert('typologies')).toBe(true);
    expect(m.tiroirs.estOuvert('couverture')).toBe(false);
    const registre = TestBed.inject(AnalysesPeintesService);
    expect(registre.une()).toBe(false);
    await m.servir();
    expect(registre.une()).toBe(true);
  });

  it('404 zone_introuvable : la zone quitte ④, le message reste', async () => {
    const m = await monter();
    await m.basculer();
    m.reponses[0].error(new HttpErrorResponse({ status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' } }));
    await m.stable();
    expect(m.zoneId()).toBeNull();
    expect(m.el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Zone introuvable dans cet espace.');
  });
});
