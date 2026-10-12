import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CarteApi, type CategoriePoi } from '../data/carte.api';
import { CataloguePoiService, typeDePoi } from './catalogue-poi.service';

describe('typeDePoi', () => {
  it('une chaîne brute est commune (format ancien de la route, sans origine)', () => {
    expect(typeDePoi('lycee')).toEqual({ id: 'lycee', label: 'Lycee', origine: 'commune' });
  });

  it('un objet garde son origine « espace »', () => {
    expect(typeDePoi({ id: 'bmw', label: 'BMW', origine: 'espace' })).toEqual({ id: 'bmw', label: 'BMW', origine: 'espace' });
  });

  it('un objet sans origine est commun', () => {
    expect(typeDePoi({ id: 'lycee', label: 'Lycées' }).origine).toBe('commune');
  });

  it('une origine inconnue est rangée commune (jamais affichée comme donnée de l’espace)', () => {
    expect(typeDePoi({ id: 'x', label: 'X', origine: 'autre' as never }).origine).toBe('commune');
  });
});

describe('CataloguePoiService', () => {
  it('les types lus portent tous leur origine', () => {
    const categories: CategoriePoi[] = [{ id: 'bmw', label: 'BMW', origine: 'espace' }, { id: 'lycee', label: 'Lycées', origine: 'commune' }, 'arret_transport'];
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), CataloguePoiService, { provide: CarteApi, useValue: { categories: () => of({ categories }) } }],
    });
    const service = TestBed.inject(CataloguePoiService);
    service.chargerUneFois();
    expect(service.types().map((t) => `${t.id}:${t.origine}`)).toEqual(['bmw:espace', 'lycee:commune', 'arret_transport:commune']);
  });
});
