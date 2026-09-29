import type maplibregl from 'maplibre-gl';

type Rappel = (...args: unknown[]) => void;

/** Une carte sans WebGL, pour les tests : elle enregistre ce qu'on lui fait. */
export class CarteFactice {
  readonly options: maplibregl.MapOptions | null;
  retiree = false;
  appelsResize = 0;
  centre: [number, number] = [5, 43.5];
  zoom = 9;
  bearing = 0;
  pitch = 0;
  cadre: [number, number, number, number] = [4.75, 43.35, 5.3, 43.6];
  readonly sauts: unknown[] = [];
  private readonly rappels = new Map<string, Set<Rappel>>();

  constructor(options: maplibregl.MapOptions | null = null) {
    this.options = options;
  }

  on(evt: string, rappel: Rappel): this {
    if (!this.rappels.has(evt)) this.rappels.set(evt, new Set());
    this.rappels.get(evt)!.add(rappel);
    return this;
  }
  off(evt: string, rappel: Rappel): this {
    this.rappels.get(evt)?.delete(rappel);
    return this;
  }
  emettre(evt: string): void {
    for (const r of [...(this.rappels.get(evt) ?? [])]) r();
  }
  nombreEcouteurs(evt: string): number {
    return this.rappels.get(evt)?.size ?? 0;
  }
  remove(): void { this.retiree = true; }
  resize(): this { this.appelsResize++; return this; }
  getBounds() {
    const [o, s, e, n] = this.cadre;
    return { getWest: () => o, getSouth: () => s, getEast: () => e, getNorth: () => n };
  }
  getCenter() { return { lng: this.centre[0], lat: this.centre[1] }; }
  getZoom() { return this.zoom; }
  getBearing() { return this.bearing; }
  getPitch() { return this.pitch; }
  /** Comme MapLibre : un saut émet `move` de façon synchrone. */
  jumpTo(o: { center?: { lng: number; lat: number } | [number, number]; zoom?: number }): this {
    this.sauts.push(o);
    if (o.zoom !== undefined) this.zoom = o.zoom;
    this.emettre('move');
    return this;
  }
}
