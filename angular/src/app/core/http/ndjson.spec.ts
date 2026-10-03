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

  it("se désabonner annule : la source n'est plus observée et plus rien n'est émis", () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    const abonnement = lignesNdjson(flux).subscribe((v) => lus.push(v));
    expect(flux.observed).toBe(true);
    flux.next({ type: HttpEventType.DownloadProgress, loaded: 8, partialText: '{"n":1}\n' });
    abonnement.unsubscribe();
    // C'est ce désabonnement qui annule la requête HTTP sous-jacente (HttpClient l'interrompt).
    expect(flux.observed).toBe(false);
    flux.next({ type: HttpEventType.DownloadProgress, loaded: 16, partialText: '{"n":1}\n{"n":2}\n' });
    expect(lus).toEqual([{ n: 1 }]);
  });

  it("une erreur après des lignes partielles : les lignes déjà lues restent émises, l'erreur suit", () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    let err: unknown;
    lignesNdjson(flux).subscribe({ next: (v) => lus.push(v), error: (e) => (err = e) });
    flux.next({ type: HttpEventType.DownloadProgress, loaded: 20, partialText: '{"n":1}\n{"n":2}\n{"n"' });
    flux.error(new Error('coupé en route'));
    expect(lus).toEqual([{ n: 1 }, { n: 2 }]);
    expect((err as Error).message).toBe('coupé en route');
  });
});
