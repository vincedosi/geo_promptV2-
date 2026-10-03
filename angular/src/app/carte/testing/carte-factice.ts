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
  readonly controles: { controle: unknown; position?: string }[] = [];
  readonly cadrages: { cadre: unknown; options: unknown }[] = [];
  /** Faux tant que le style n'est pas chargé : `getStyle()` rend alors `undefined`, comme MapLibre. */
  styleCharge = false;
  private readonly rappels = new Map<string, Set<Rappel>>();

  constructor(options: maplibregl.MapOptions | null = null) {
    this.options = options;
  }

  /** Ce qu'on a posé sur la carte, dans l'ordre — pour que les tests le relisent. */
  readonly sources = new Map<string, { spec: unknown; donnees: unknown[] }>();
  readonly couches: { couche: Record<string, unknown>; avant?: string }[] = [];
  readonly peintures: { couche: string; propriete: string; valeur: unknown }[] = [];

  /** `on('click', couche, rappel)` comme MapLibre : l'écoute est rangée sous `evt:couche`. */
  on(evt: string, rappel: Rappel): this;
  on(evt: string, couche: string, rappel: Rappel): this;
  on(evt: string, a: string | Rappel, b?: Rappel): this {
    const cle = typeof a === 'string' ? `${evt}:${a}` : evt;
    const rappel = (typeof a === 'string' ? b : a) as Rappel;
    if (!this.rappels.has(cle)) this.rappels.set(cle, new Set());
    this.rappels.get(cle)!.add(rappel);
    return this;
  }
  off(evt: string, rappel: Rappel): this {
    this.rappels.get(evt)?.delete(rappel);
    return this;
  }
  emettre(evt: string, charge?: unknown): void {
    if (evt === 'load') this.styleCharge = true;
    for (const r of [...(this.rappels.get(evt) ?? [])]) r(charge);
  }
  /** Déclenche une écoute de couche (`click` sur un site), avec l'événement fourni. */
  emettreSurCouche(evt: string, couche: string, evenement: unknown): void {
    for (const r of [...(this.rappels.get(`${evt}:${couche}`) ?? [])]) r(evenement);
  }
  nombreEcouteurs(evt: string): number {
    return this.rappels.get(evt)?.size ?? 0;
  }
  addSource(id: string, spec: unknown): this {
    this.sources.set(id, { spec, donnees: [] });
    return this;
  }
  getSource(id: string) {
    const s = this.sources.get(id);
    return s ? { setData: (d: unknown) => { s.donnees.push(d); } } : undefined;
  }
  addLayer(couche: Record<string, unknown>, avant?: string): this {
    this.couches.push({ couche, avant });
    return this;
  }
  setPaintProperty(couche: string, propriete: string, valeur: unknown): this {
    this.peintures.push({ couche, propriete, valeur });
    return this;
  }
  addControl(controle: unknown, position?: string): this { this.controles.push({ controle, position }); return this; }
  getStyle(): object | undefined { return this.styleCharge ? {} : undefined; }
  fitBounds(cadre: unknown, options?: unknown): this { this.cadrages.push({ cadre, options }); return this; }
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
