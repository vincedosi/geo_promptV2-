import { HttpEventType, HttpResponse, type HttpEvent } from '@angular/common/http';
import { Subject } from 'rxjs';
import { lignesSse } from './sse';

const progres = (flux: Subject<HttpEvent<string>>, partialText: string) =>
  flux.next({ type: HttpEventType.DownloadProgress, loaded: partialText.length, partialText });

describe('lignesSse', () => {
  it('une ligne `data:` coupée entre deux morceaux donne UN objet, émis au second morceau', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    lignesSse(flux).subscribe((v) => lus.push(v));
    progres(flux, 'data: {"type":"progress","proc');
    expect(lus).toEqual([]);
    progres(flux, 'data: {"type":"progress","processed":3}\n\n');
    expect(lus).toEqual([{ type: 'progress', processed: 3 }]);
  });

  it('accepte \\r\\n comme séparateur (norme SSE)', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    lignesSse(flux).subscribe((v) => lus.push(v));
    progres(flux, 'data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\n');
    expect(lus).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('accepte \\r SEUL comme séparateur (norme SSE, vague finale H4)', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    lignesSse(flux).subscribe((v) => lus.push(v));
    progres(flux, 'data: {"n":1}\r\rdata: {"n":2}\r\r');
    expect(lus).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('ignore `event:`, `id:`, les commentaires `:` et une ligne `data:` illisible, sans couper le flux', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    let erreur: unknown = null;
    lignesSse(flux).subscribe({ next: (v) => lus.push(v), error: (e) => (erreur = e) });
    progres(flux, 'event: x\n: commentaire\nid: 1\ndata: {cassé\n\ndata: {"n":2}\n\n');
    expect(lus).toEqual([{ n: 2 }]);
    expect(erreur).toBeNull();
  });

  it('accepte `data:` sans espace, et lit la dernière ligne sans saut de ligne à la Response finale', () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    let fini = false;
    lignesSse(flux).subscribe({ next: (v) => lus.push(v), complete: () => (fini = true) });
    progres(flux, 'data:{"n":1}\n\ndata: {"n":2}');
    expect(lus).toEqual([{ n: 1 }]);
    flux.next(new HttpResponse<string>({ body: 'data:{"n":1}\n\ndata: {"n":2}' }));
    flux.complete();
    expect(lus).toEqual([{ n: 1 }, { n: 2 }]);
    expect(fini).toBe(true);
  });

  it("propage l'erreur HTTP, après les objets déjà lus", () => {
    const flux = new Subject<HttpEvent<string>>();
    const lus: unknown[] = [];
    let err: unknown;
    lignesSse(flux).subscribe({ next: (v) => lus.push(v), error: (e) => (err = e) });
    progres(flux, 'data: {"n":1}\n\n');
    flux.error(new Error('coupé'));
    expect(lus).toEqual([{ n: 1 }]);
    expect((err as Error).message).toBe('coupé');
  });

  it('se désabonner libère la source', () => {
    const flux = new Subject<HttpEvent<string>>();
    const abonnement = lignesSse(flux).subscribe();
    expect(flux.observed).toBe(true);
    abonnement.unsubscribe();
    expect(flux.observed).toBe(false);
  });
});
