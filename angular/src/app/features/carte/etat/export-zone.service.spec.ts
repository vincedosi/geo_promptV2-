import { DOCUMENT } from '@angular/core';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { ExportZoneService } from './export-zone.service';

function monter(exporter: () => unknown) {
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({
    providers: [ExportZoneService, { provide: ZonesCustomApi, useValue: { exporter: vi.fn(exporter) } }, { provide: ENREGISTRER_FICHIER, useValue: enregistrer }],
  });
  return { service: TestBed.inject(ExportZoneService), enregistrer, api: TestBed.inject(ZonesCustomApi) as unknown as { exporter: ReturnType<typeof vi.fn> } };
}

describe('ExportZoneService (downloadZoneExport, T14)', () => {
  it('réussite : le fichier est enregistré par `enregistrerFichier`, repli `zone_<id>_<format>`, rend null', async () => {
    const reponse = new HttpResponse({ body: new Blob(['x']) });
    const { service, enregistrer, api } = monter(() => of(reponse));
    await expect(service.exporter('z1', 'bidding_script')).resolves.toBeNull();
    expect(api.exporter).toHaveBeenCalledWith('z1', 'bidding_script');
    expect(enregistrer).toHaveBeenCalledWith(TestBed.inject(DOCUMENT), reponse, 'zone_z1_bidding_script');
  });

  it('refus : le message `error` du corps (blob JSON) est rendu, rien n’est enregistré', async () => {
    const corps = new Blob([JSON.stringify({ error: 'zone_not_found' })], { type: 'application/json' });
    const { service, enregistrer } = monter(() => throwError(() => new HttpErrorResponse({ status: 404, error: corps })));
    await expect(service.exporter('z1', 'tiktok_geo')).resolves.toBe('zone_not_found');
    expect(enregistrer).not.toHaveBeenCalled();
  });
});
