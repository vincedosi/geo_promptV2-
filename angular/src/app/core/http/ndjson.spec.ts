import { HttpEventType, HttpResponse, type HttpEvent } from '@angular/common/http';
import { Subject } from 'rxjs';
import { lignesNdjson } from './ndjson';

describe('lignesNdjson', () => {
  it("rend les objets dans l'ordre : ligne coupée entre morceaux, ligne illisible ignorée, dernière ligne sans saut de ligne", () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    let fini = false;
    lignesNdjson<{ n: number }>(flux).subscribe({ next: (v) => lus.push(v), complete: () => (fini = true) });
    const progres = (partialText: string) =>
      flux.next({ type: HttpEventType.DownloadProgress, loaded: partialText.length, partialText });

    progres('{"n":1}\n{"n"');
    expect(lus).toEqual([{ n: 1 }]);
    progres('{"n":1}\n{"n":2}\npas du json\n{"n":3}');
    expect(lus).toEqual([{ n: 1 }, { n: 2 }]);
    progres('{"n":1}\n{"n":2}\npas du json\n{"n":3}\n');
    expect(lus).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    flux.next(new HttpResponse<string>({ body: '{"n":1}\n{"n":2}\npas du json\n{"n":3}\n{"n":4}' }));
    flux.complete();
    expect(lus).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    expect(fini).toBe(true);
  });

  it('une réponse sans aucun progrès est lue en entier à la fin', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    lignesNdjson(flux).subscribe((v) => lus.push(v));
    flux.next(new HttpResponse<string>({ body: '{"a":1}\n\n{"a":2}' }));
    expect(lus).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("propage l'erreur du transport", () => {
    const flux = new Subject<HttpEvent<string>>();
    let err: unknown;
    lignesNdjson(flux).subscribe({ error: (e) => (err = e) });
    flux.error(new Error('coupé'));
    expect((err as Error).message).toBe('coupé');
  });
});
