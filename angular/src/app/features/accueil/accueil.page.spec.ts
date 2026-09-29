import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SitesRisqueApi } from '../risques/data/sites-risque.api';
import { AccueilPage } from './accueil.page';

async function rendre(api: Partial<SitesRisqueApi>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [AccueilPage],
    providers: [{ provide: SitesRisqueApi, useValue: api }],
  });
  const f = TestBed.createComponent(AccueilPage);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('AccueilPage', () => {
  it('affiche le nombre de sites, formaté en français', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1259, total: 99152, par_nature: {} }) });
    expect(el.textContent?.replace(/\s/g, ' ')).toContain('1 259');
  });

  it('affiche le message de l\'erreur, jamais un chargement sans fin', async () => {
    const el = await rendre({
      compter: () => throwError(() => new HttpErrorResponse({ status: 504 })),
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/API ne répond pas/);
  });
});
