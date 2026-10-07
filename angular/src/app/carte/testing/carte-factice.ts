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
  readonly sources = new Map<string, { spec: unknown; donnees: unknown[]; tuiles: unknown[] }>();
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
  /** `off('click', couche, rappel)` comme MapLibre : retire l'écoute rangée sous `evt:couche`. */
  off(evt: string, rappel: Rappel): this;
  off(evt: string, couche: string, rappel: Rappel): this;
  off(evt: string, a: string | Rappel, b?: Rappel): this {
    if (typeof a === 'string') {
      this.rappels.get(`${evt}:${a}`)?.delete(b as Rappel);
      return this;
    }
    const rappel = a;
    this.rappels.get(evt)?.delete(rappel);
    const enveloppe = this.uniques.get(rappel);
    if (enveloppe) { this.rappels.get(evt)?.delete(enveloppe); this.uniques.delete(rappel); }
    return this;
  }
  /** Comme MapLibre : une écoute appelée une seule fois, que `off(evt, rappel)` retire aussi. */
  once(evt: string, rappel: Rappel): this {
    const enveloppe: Rappel = (...args) => { this.off(evt, rappel); rappel(...args); };
    this.uniques.set(rappel, enveloppe);
    return this.on(evt, enveloppe);
  }
  private readonly uniques = new Map<Rappel, Rappel>();
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
    this.sources.set(id, { spec, donnees: [], tuiles: [] });
    return this;
  }
  getSource(id: string) {
    const s = this.sources.get(id);
    return s
      ? { setData: (d: unknown) => { s.donnees.push(d); }, setTiles: (t: unknown) => { s.tuiles.push(t); } }
      : undefined;
  }
  addLayer(couche: Record<string, unknown>, avant?: string): this {
    this.couches.push({ couche, avant });
    return this;
  }
  /** Ce qui a été retiré, dans l'ordre : `couche:<id>` ou `source:<id>`. */
  readonly retraits: string[] = [];
  /** Les `setLayoutProperty`, dans l'ordre. */
  readonly dispositions: { couche: string; propriete: string; valeur: unknown }[] = [];
  getLayer(id: string): Record<string, unknown> | undefined {
    return this.couches.find((c) => c.couche['id'] === id)?.couche;
  }
  /** Comme MapLibre : retirer une source qu'une couche utilise encore LÈVE. */
  removeLayer(id: string): this {
    const i = this.couches.findIndex((c) => c.couche['id'] === id);
    if (i >= 0) this.couches.splice(i, 1);
    this.retraits.push(`couche:${id}`);
    return this;
  }
  removeSource(id: string): this {
    if (this.couches.some((c) => c.couche['source'] === id)) {
      throw new Error(`Source "${id}" cannot be removed while layer is using it.`);
    }
    this.sources.delete(id);
    this.retraits.push(`source:${id}`);
    return this;
  }
  setLayoutProperty(couche: string, propriete: string, valeur: unknown): this {
    this.dispositions.push({ couche, propriete, valeur });
    const c = this.getLayer(couche);
    if (c) c['layout'] = { ...(c['layout'] as object | undefined), [propriete]: valeur };
    return this;
  }
  isStyleLoaded(): boolean { return this.styleCharge; }
  /** Les `setFilter`, dans l'ordre. */
  readonly filtres: { couche: string; filtre: unknown }[] = [];
  setFilter(couche: string, filtre: unknown): this {
    this.filtres.push({ couche, filtre });
    const c = this.getLayer(couche);
    if (c) c['filter'] = filtre;
    return this;
  }
  /** Ce que `queryRenderedFeatures` rend : posé par le test. */
  entitesRendues: unknown[] = [];
  queryRenderedFeatures(): unknown[] { return this.entitesRendues; }
  /** Le canevas, pour le curseur posé au survol d'une couche. */
  private readonly canevas = { style: { cursor: '' } };
  getCanvas() { return this.canevas; }
  setPaintProperty(couche: string, propriete: string, valeur: unknown): this {
    this.peintures.push({ couche, propriete, valeur });
    return this;
  }
  addControl(controle: unknown, position?: string): this { this.controles.push({ controle, position }); return this; }
  /** Les couches du STYLE de fond (Positron, Liberty…), que `getStyle().layers` rend une fois le style chargé. */
  styleCouches: { id: string; type: string; layout?: Record<string, unknown> }[] = [];
  getStyle() { return this.styleCharge ? { layers: this.styleCouches } : undefined; }
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
  /** Les `easeTo`, dans l'ordre ; l'inclinaison demandée est appliquée tout de suite (pas d'animation ici). */
  readonly animations: { pitch?: number; zoom?: number; duration?: number }[] = [];
  easeTo(o: { pitch?: number; zoom?: number; duration?: number }): this {
    this.animations.push(o);
    if (o.pitch !== undefined) this.pitch = o.pitch;
    if (o.zoom !== undefined) this.zoom = o.zoom;
    return this;
  }
  /** Comme MapLibre : un saut émet `move` de façon synchrone. */
  jumpTo(o: { center?: { lng: number; lat: number } | [number, number]; zoom?: number }): this {
    this.sauts.push(o);
    if (o.zoom !== undefined) this.zoom = o.zoom;
    this.emettre('move');
    return this;
  }
}
