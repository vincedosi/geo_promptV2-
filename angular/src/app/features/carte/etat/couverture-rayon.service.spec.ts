import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { COUCHE_POI_RAYON } from '../couches/couche-couverture-rayon';
import { CouvertureApi } from '../data/couverture.api';
import type { ResultatCouvertureRayon } from '../logique/analyses/couverture-rayon';
import { CataloguePoiService } from './catalogue-poi.service';
import { CouchesCarteService } from './couches-carte.service';
import { CouvertureRayonService } from './couverture-rayon.service';
import { EtatCarteService } from './etat-carte.service';
import { ZoneAnalyseeService } from './zone-analysee.service';

const ZONE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const RESULTAT: ResultatCouvertureRayon = {
  cible: 'ind', rayon_max_m: 5000, n_poi: 2, poi: [[5.4, 43.3], [5.1, 43.5]], population_perimetre: 2_000_000,
  courbes: [{ cle: '*', total: 900_000, points: [{ r: 100, p: 1000, i: 1000 }] }],
};

/** Une carte minimale : sources et couches posées, retirées. */
function carteFactice() {
  const sources = new Map<string, { setData: (d: unknown) => void; donnees: unknown }>();
  const couches: string[] = [];
  return {
    sources, couches,
    isStyleLoaded: () => true,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => {
      const src = { donnees: s.data, setData(d: unknown) { this.donnees = d; } };
      sources.set(id, src);
    },
    getLayer: (id: string) => (couches.includes(id) ? {} : undefined),
    addLayer: (c: { id: string }) => { couches.push(c.id); },
    removeLayer: (id: string) => { couches.splice(couches.indexOf(id), 1); },
    removeSource: (id: string) => { sources.delete(id); },
    getStyle: () => ({ layers: couches.map((id) => ({ id })) }),
    once: () => undefined, off: () => undefined,
  };
}

function monter() {
  const reponses: Subject<ResultatCouvertureRayon>[] = [];
  const rayon = vi.fn((_requete: string) => {
    const r = new Subject<ResultatCouvertureRayon>();
    reponses.push(r);
    return r;
  });
  const zoneId = signal<string | null>(null);
  const filtre = signal<unknown>({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
  const carte = signal<unknown>(null);
  const effacements = new Map<string, () => void>();
  const chargerUneFois = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      CouvertureRayonService,
      { provide: CouvertureApi, useValue: { rayon } },
      { provide: EtatCarteService, useValue: { filtre } },
      { provide: ZoneAnalyseeService, useValue: { zoneId } },
      { provide: CataloguePoiService, useValue: { types: signal([{ id: 'risque_industriel', label: 'Risque industriel', origine: 'commune' }]), chargerUneFois } },
      { provide: CouchesCarteService, useValue: { carteCourante: carte, inscrireEffacement: (id: string, f: () => void) => effacements.set(id, f) } },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])) } },
    ],
  });
  const s = TestBed.inject(CouvertureRayonService);
  const stable = () => TestBed.tick();
  return { s, rayon, reponses, zoneId, filtre, carte, effacements, chargerUneFois, stable };
}

const parametres = (q: string) => [...new URLSearchParams(q).entries()];

describe('CouvertureRayonService (lot 4, T12)', () => {
  it('déplier lit le catalogue des types de POI de la page ; rien ne part avant « Calculer »', () => {
    const { s, rayon, chargerUneFois } = monter();
    s.basculerOuvert();
    expect(chargerUneFois).toHaveBeenCalledTimes(1);
    expect(rayon).not.toHaveBeenCalled();
    // Les sites ICPE ne sont pas au catalogue des POI : proposés une fois, en plus.
    expect(s.types().map((t) => t.id)).toEqual(['risque_industriel']);
  });

  it('périmètre : ① sans zone ; la zone analysée par défaut ; la bascule rend ①', () => {
    const { s, rayon, zoneId } = monter();
    s.lancer();
    expect(parametres(rayon.mock.calls[0][0])).toEqual([
      ['categorie', 'risque_industriel'], ['perimetre_type', 'departement'], ['perimetre_code', '13'], ['cible', 'ind'], ['rayon_max', '5000'],
    ]);
    zoneId.set(ZONE);
    s.lancer();
    expect(new URLSearchParams(rayon.mock.calls[1][0]).get('perimetre_type')).toBe('zone');
    expect(new URLSearchParams(rayon.mock.calls[1][0]).get('perimetre_code')).toBe(ZONE);
    s.surZone.set(false);
    s.lancer();
    expect(new URLSearchParams(rayon.mock.calls[2][0]).get('perimetre_code')).toBe('13');
  });

  it('sans périmètre : la phrase des recettes, AUCUNE requête', () => {
    const { s, rayon, filtre } = monter();
    filtre.set(null);
    s.lancer();
    expect(rayon).not.toHaveBeenCalled();
    expect(s.erreur()).toBe('Choisissez un périmètre à l’étape ① avant ce calcul.');
  });

  it('champ et profil : valeurs répétées, profil des seules lignes à anneaux, bandes lues sur le profil CALCULÉ', () => {
    const { s, rayon, reponses } = monter();
    s.champ.set('sous_categorie');
    s.lignesValeurs.set([{ valeur: 'seveso_haut', anneaux: '2000, 500, 1 000' }, { valeur: 'seveso_bas', anneaux: '500' }, { valeur: 'ied', anneaux: '' }]);
    s.lancer();
    const p = new URLSearchParams(rayon.mock.calls[0][0]);
    expect(p.getAll('valeur')).toEqual(['seveso_haut', 'seveso_bas', 'ied']);
    expect(JSON.parse(p.get('profil')!)).toEqual({ seveso_haut: [500, 1000, 2000], seveso_bas: [500] });
    reponses[0].next(RESULTAT);
    expect(s.profilCalcule()).toEqual({ seveso_haut: [500, 1000, 2000], seveso_bas: [500] });
    expect(s.rayon()).toBe(1000);
  });

  it('P-c : un réglage changé pendant le calcul l’annule ; sa réponse ne s’affiche pas', async () => {
    const { s, reponses, stable } = monter();
    s.lancer();
    expect(s.enCours()).toBe(true);
    s.rayonMax.set(2000);
    stable();
    expect(s.enCours()).toBe(false);
    expect(reponses[0].observed).toBe(false);
    reponses[0].next(RESULTAT);
    expect(s.resultat()).toBeNull();
  });

  it('un résultat posé puis un réglage changé : le résultat est retiré', () => {
    const { s, reponses, stable } = monter();
    s.lancer();
    reponses[0].next(RESULTAT);
    expect(s.resultat()).toBe(RESULTAT);
    s.cible.set('men_pauv');
    stable();
    expect(s.resultat()).toBeNull();
  });

  it('carte : POI et cercles au rayon lu, repeints quand il bouge, retirés à « Tout effacer » et à la destruction', () => {
    const { s, reponses, carte, effacements, stable } = monter();
    const c = carteFactice();
    carte.set(c as unknown as maplibregl.Map);
    s.lancer();
    reponses[0].next(RESULTAT);
    stable();
    expect(c.couches).toEqual(['couverture-rayon-fill', 'couverture-rayon-line', COUCHE_POI_RAYON]);
    const cercles = () => (c.sources.get('couverture-rayon')!.donnees as GeoJSON.FeatureCollection).features[0].geometry as GeoJSON.MultiPolygon;
    const rayonDegres = () => Math.abs(cercles().coordinates[0][0][16][1] - 43.3);
    const avant = rayonDegres();
    s.rayon.set(3000);
    stable();
    expect(rayonDegres() / avant).toBeCloseTo(3, 5);
    effacements.get('couverture-rayon')!();
    stable();
    expect(c.couches).toEqual([]);
    s.lancer();
    reponses[1].next(RESULTAT);
    stable();
    expect(c.couches).toHaveLength(3);
    TestBed.resetTestingModule();
    expect(c.couches).toEqual([]);
  });
});
