import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import type { LigneJournal } from '../../commun/journal.component';
import {
  detectCRS, detectIdColumn, parseDBF, parseSHP, reprojectCoords,
  type DbfField, type Feature, type ShapefileBundle,
} from '../../logique/shapefile';
import { ImportGeoApi, type LigneCarreau, type ReponseLot } from '../data/import-geo.api';
import { CHARGEUR_PROJ4 } from '../logique/charger-proj4';
import {
  EXCLUE, TAILLE_LOT, appelleDemiLots, colonnesRetenues, construireLot, corpsEnregistrement, tableRenommage,
  type ColumnMapping, type WizardStep,
} from '../logique/lots';

/** Lecture des fichiers en cours : le libellé de React, et le compte des enregistrements reprojetés sur le total du `.dbf`. */
export interface Lecture {
  libelle: string;
  lus: number | null;
  total: number | null;
}

/** Nombre de lignes de journal gardées, comme React (`prev.slice(-500)` puis la nouvelle). */
const LIGNES_GARDEES = 500;
/** Une cession au fil d'exécution tous les N enregistrements reprojetés (React : 100 000). */
const PAQUET_REPROJECTION = 100_000;

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown, defaut: string) => (e instanceof Error ? e.message : defaut);

/**
 * État et déroulé de l'import Shapefile — ce que `app/admin/carreaux-import/page.tsx` tient au niveau de la PAGE
 * (lot 6, T14). Fourni par `ImporterPage` (l'onglet « Importer » de Données) et NON par l'écran Shapefile
 * (vague finale, I-2 / Q-2) : passer d'un sous-onglet d'import à un autre ne détruit plus l'envoi, et revenir sur
 * « Shapefile » retrouve l'écran où on l'a laissé. Quitter « Importer » le détruit ; pendant un envoi, la route
 * demande d'abord confirmation (`quitterImporterGuard`).
 *
 * - **Lecture** (`lire`, l.90-206) dans le navigateur : `.shp` et `.dbf` obligatoires, `.prj` et `.shx`
 *   facultatifs ; cessions au fil (`setTimeout` de 50 ms entre les phases, 0 ms tous les 100 000
 *   enregistrements) ; `proj4` chargé par `import()` au premier fichier lu (C10, `CHARGEUR_PROJ4`) ; passage
 *   automatique au mapping 600 ms après la fin. Un dépôt plus récent rend le précédent muet (génération).
 * - **Envoi** (`importer`, l.236-394) : lots de 1 000, **un seul en vol** — le suivant ne part qu'après la
 *   réponse du précédent ; un refus « 413 / too large / payload » reprend le lot en deux demi-lots ; puis
 *   `register` si au moins une ligne est passée. ⚠ Les lots ÉCRIVENT dans `carreaux_filosofi` et `register`
 *   une ligne `data_sources`.
 * - **Chronomètre** (`setInterval` d'une seconde, l.67-75) : arrêté en fin d'envoi et à la destruction.
 *
 * Destruction pendant l'envoi (on a CONFIRMÉ la sortie d'« Importer ») : l'envoi est un ENCHAÎNEMENT CLIENT de
 * requêtes, pas un flux (C13 ne s'applique pas). Le lot en vol se termine côté serveur, mais aucun lot NOUVEAU ne
 * part, ni demi-lot, ni `register` : ⚠ les lots déjà envoyés restent dans `carreaux_filosofi` SANS ligne
 * `data_sources` — ce que la confirmation et l'avertissement de l'écran disent en toutes lettres. React, lui,
 * continuait d'envoyer après le démontage, sans écran pour le suivre.
 */
@Injectable()
export class ImportShapefileService {
  private readonly api = inject(ImportGeoApi);
  private readonly chargerProj4 = inject(CHARGEUR_PROJ4);

  readonly etape = signal<WizardStep>(1);

  // ── Étape 1 : fichiers
  readonly bundle = signal<ShapefileBundle | null>(null);
  readonly features = signal<Feature[]>([]);
  readonly fields = signal<DbfField[]>([]);
  readonly crs = signal('');
  readonly erreurLecture = signal('');
  readonly lectureEnCours = signal(false);
  readonly lecture = signal<Lecture | null>(null);

  // ── Étape 2 : mapping
  readonly mappings = signal<ColumnMapping[]>([]);
  readonly resolution = signal('200m');
  readonly millesime = signal('2021');
  readonly idColumn = signal('');

  // ── Étape 3 : import
  readonly journal = signal<LigneJournal[]>([]);
  readonly importEnCours = signal(false);
  /** Étape nommée de l'envoi (C5) : « Envoi » des lots, puis « Enregistrement » de la source. */
  readonly phase = signal<'Envoi' | 'Enregistrement'>('Envoi');
  readonly progression = signal<{ current: number; total: number } | null>(null);
  readonly termine = signal(false);
  readonly erreurImport = signal('');
  readonly ecoule = signal(0);
  /** Lots envoyés (réponse reçue) et lots prévus, pour la confirmation de sortie. */
  readonly lots = computed(() => {
    const p = this.progression();
    return p ? { envoyes: Math.ceil(p.current / TAILLE_LOT), total: Math.ceil(p.total / TAILLE_LOT) } : null;
  });

  private generation = 0;
  private detruit = false;
  private chrono: ReturnType<typeof setInterval> | null = null;
  private avance: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.arreterChrono();
      if (this.avance !== null) clearTimeout(this.avance);
    });
  }

  // ════ Étape 1 : lecture des fichiers ════

  async lire(liste: readonly File[]): Promise<void> {
    const generation = ++this.generation;
    const courant = () => generation === this.generation && !this.detruit;
    if (this.avance !== null) clearTimeout(this.avance);
    this.erreurLecture.set('');
    this.features.set([]);
    this.fields.set([]);
    this.crs.set('');
    this.bundle.set(null);
    this.etape.set(1);

    const parExtension: Record<string, File> = {};
    for (const f of liste) parExtension[f.name.split('.').pop()?.toLowerCase() || ''] = f;
    // Un refus arrête aussi une lecture PRÉCÉDENTE encore en vol, devenue muette : sa barre ne reste pas figée (B3).
    if (!parExtension['shp']) {
      this.arreterLecture('Fichier .shp manquant. Sélectionnez les 4 fichiers du Shapefile (.shp, .dbf, .prj, .shx).');
      return;
    }
    if (!parExtension['dbf']) {
      this.arreterLecture('Fichier .dbf manquant (attributs). Sélectionnez au minimum .shp et .dbf.');
      return;
    }

    this.lectureEnCours.set(true);
    const etat = (libelle: string, lus: number | null = null, total: number | null = null) => {
      if (courant()) this.lecture.set({ libelle, lus, total });
    };
    etat('Lecture des fichiers...');
    // Au premier fichier lu : `proj4` part en parallèle de la lecture (C10). Son échec n'est lu que s'il sert.
    const proj4 = this.chargerProj4();
    proj4.catch(() => undefined);

    try {
      const shpBuf = await parExtension['shp'].arrayBuffer();
      etat('.shp chargé');
      const dbfBuf = await parExtension['dbf'].arrayBuffer();
      etat('.dbf chargé');
      const prjText = parExtension['prj'] ? await parExtension['prj'].text() : null;
      etat('.prj chargé');
      const shxBuf = parExtension['shx'] ? await parExtension['shx'].arrayBuffer() : null;
      etat('Fichiers chargés — parsing SHP...');
      const baseName = parExtension['shp'].name.replace(/\.shp$/i, '');

      await pause(50);
      if (!courant()) return;
      const geometries = parseSHP(shpBuf);
      etat(`${formaterNombre(geometries.length)} géométries lues — parsing DBF...`);

      await pause(50);
      if (!courant()) return;
      const { fields, records } = parseDBF(dbfBuf);
      etat(`${formaterNombre(records.length)} enregistrements lus — détection CRS...`, 0, records.length);
      if (geometries.length !== records.length) {
        throw new Error(`Incohérence: ${geometries.length} géométries vs ${records.length} enregistrements DBF`);
      }

      const premier = geometries.length > 0 && geometries[0].length > 0 && geometries[0][0].length > 0 ? geometries[0][0][0] : null;
      const crs = detectCRS(prjText, premier);
      this.crs.set(crs);
      etat(`CRS détecté: ${crs} — reprojection...`, 0, records.length);
      await pause(50);
      if (!courant()) return;

      const reprojeter = crs !== 'EPSG:4326';
      const p = reprojeter ? await proj4 : null;
      if (!courant()) return;
      const feats: Feature[] = [];
      for (let i = 0; i < records.length; i++) {
        const rings = geometries[i];
        if (rings && rings.length > 0) {
          feats.push({ geometry: p ? rings.map((ring) => reprojectCoords(ring, crs, p)) : rings, properties: records[i] });
        }
        if (i > 0 && i % PAQUET_REPROJECTION === 0) {
          etat(`Reprojection: ${formaterNombre(i)}/${formaterNombre(records.length)}...`, i, records.length);
          await pause(0);
          if (!courant()) return;
        }
      }

      this.features.set(feats);
      this.fields.set(fields);
      this.bundle.set({ shp: shpBuf, dbf: dbfBuf, prj: prjText, shx: shxBuf, fileName: baseName });
      const annee = baseName.match(/(\d{4})/);
      if (annee) this.millesime.set(annee[1]);
      if (/200m/i.test(baseName)) this.resolution.set('200m');
      else if (/1km/i.test(baseName)) this.resolution.set('1km');
      const id = detectIdColumn(fields);
      if (id) this.idColumn.set(id);
      this.mappings.set(fields.map((f) => ({ source: f.name, target: '' })));
      etat(`✓ ${formaterNombre(feats.length)} features prêtes`, records.length, records.length);
      this.avance = setTimeout(() => {
        this.avance = null;
        this.etape.set(2);
      }, 600);
    } catch (e) {
      if (courant()) this.erreurLecture.set(message(e, 'Erreur parsing'));
    } finally {
      if (courant()) this.lectureEnCours.set(false);
    }
  }

  // ════ Étape 2 : mapping ════

  /** L'utilisateur choisit son étape : le passage automatique au mapping, s'il est encore attendu, est annulé (B5). */
  choisirEtape(n: WizardStep): void {
    if (this.avance !== null) clearTimeout(this.avance);
    this.avance = null;
    this.etape.set(n);
  }

  inclureTout(): void {
    this.mappings.update((ms) => ms.map((m) => ({ ...m, target: '' })));
  }

  exclureTout(): void {
    this.mappings.update((ms) => ms.map((m) => ({ ...m, target: EXCLUE })));
  }

  inclure(index: number, inclus: boolean): void {
    this.mappings.update((ms) => ms.map((m, i) => (i === index ? { ...m, target: inclus ? '' : EXCLUE } : m)));
  }

  renommer(index: number, cible: string): void {
    this.mappings.update((ms) => ms.map((m, i) => (i === index ? { ...m, target: cible } : m)));
  }

  // ════ Étape 3 : envoi par lots ════

  async importer(): Promise<void> {
    const features = this.features();
    if (features.length === 0 || this.importEnCours()) return;

    this.importEnCours.set(true);
    this.termine.set(false);
    this.erreurImport.set('');
    this.journal.set([]);
    this.phase.set('Envoi');
    const total = features.length;
    this.progression.set({ current: 0, total });
    this.demarrerChrono();

    const totalLots = Math.ceil(total / TAILLE_LOT);
    const resolution = this.resolution();
    const millesime = this.millesime();
    let inserees = 0;
    let erreurs = 0;

    this.ecrire(`Début de l'insertion : ${formaterNombre(total)} lignes détectées.`);
    this.ecrire(`Table cible : carreaux_filosofi (resolution=${resolution}, millesime=${millesime})`);
    this.ecrire(`Taille des lots : ${TAILLE_LOT} — ${totalLots} lots à envoyer.`);
    this.ecrire('');

    const retenues = colonnesRetenues(this.mappings());
    const parametres = { renommage: tableRenommage(retenues), idColumn: this.idColumn(), resolution, millesime };

    for (let n = 0; n < totalLots; n++) {
      if (this.detruit) return;
      const debut = n * TAILLE_LOT;
      const fin = Math.min(debut + TAILLE_LOT, total);
      const rows = construireLot(features, debut, fin, parametres);
      try {
        const data = await this.envoyer(rows);
        if (this.detruit) return;
        if (data.success) {
          inserees += data.inserted ?? 0;
          this.ecrire(`✓ Lot ${n + 1}/${totalLots} inséré (${formaterNombre(data.inserted)} lignes) — total: ${formaterNombre(inserees)}/${formaterNombre(total)}`);
        } else {
          erreurs++;
          this.ecrire(`✕ Erreur lot ${n + 1}/${totalLots} : ${data.error}`);
          if (appelleDemiLots(data.error)) inserees += await this.demiLots(rows);
        }
      } catch (e) {
        if (this.detruit) return;
        erreurs++;
        this.ecrire(`✕ Exception lot ${n + 1} : ${message(e, 'Erreur réseau')}`);
      }
      this.progression.set({ current: Math.min(fin, total), total });
      await pause(0);
    }
    if (this.detruit) return;

    this.ecrire('');
    this.ecrire('═══════════════════════════════════════════════');
    this.ecrire('RAPPORT FINAL');
    this.ecrire(`  Lignes insérées : ${formaterNombre(inserees)} / ${formaterNombre(total)}`);
    this.ecrire(`  Erreurs : ${erreurs}`);
    this.ecrire('  Table : carreaux_filosofi');
    this.ecrire(`  Résolution : ${resolution} — Millésime : ${millesime}`);
    this.ecrire('═══════════════════════════════════════════════');
    if (erreurs > 0) {
      this.erreurImport.set(`${erreurs} lot(s) en erreur — ${formaterNombre(inserees)}/${formaterNombre(total)} insérés`);
    }

    if (inserees > 0) await this.enregistrer(retenues, resolution, millesime, inserees);
    if (this.detruit) return;
    this.termine.set(true);
    this.importEnCours.set(false);
    this.arreterChrono();
  }

  /** Remet l'écran à zéro pour enchaîner sur un autre bundle (`resetImport`, l.396-405). */
  reinitialiser(): void {
    this.etape.set(1);
    this.features.set([]);
    this.fields.set([]);
    this.bundle.set(null);
    this.journal.set([]);
    this.progression.set(null);
    this.termine.set(false);
    this.erreurImport.set('');
  }

  private arreterLecture(erreur: string): void {
    this.erreurLecture.set(erreur);
    this.lectureEnCours.set(false);
    this.lecture.set(null);
  }

  private envoyer(rows: readonly LigneCarreau[]): Promise<ReponseLot> {
    return firstValueFrom(this.api.envoyerLot(rows));
  }

  /** Reprise d'un lot refusé en deux demi-lots, l'un après l'autre (l.314-340). Rend les lignes insérées. */
  private async demiLots(rows: readonly LigneCarreau[]): Promise<number> {
    this.ecrire('  Tentative en demi-lots...');
    const moitie = Math.ceil(rows.length / 2);
    let inserees = 0;
    for (const sousLot of [rows.slice(0, moitie), rows.slice(moitie)]) {
      if (this.detruit) return inserees;
      try {
        const d = await this.envoyer(sousLot);
        if (d.success) {
          inserees += d.inserted ?? 0;
          this.ecrire(`  ✓ Demi-lot inséré (${d.inserted} lignes)`);
        } else {
          this.ecrire(`  ✕ Demi-lot échoué : ${d.error}`);
        }
      } catch (e) {
        this.ecrire(`  ✕ Demi-lot exception : ${message(e, 'erreur')}`);
      }
    }
    return inserees;
  }

  /** Déclare l'import dans `data_sources`, pour qu'il apparaisse dans Sources (l.358-395). Non bloquant. */
  private async enregistrer(retenues: readonly ColumnMapping[], resolution: string, millesime: string, inserees: number) {
    this.phase.set('Enregistrement');
    try {
      this.ecrire('Enregistrement de la source dans le back-office...');
      const corps = corpsEnregistrement(retenues, resolution, millesime, inserees, this.bundle()?.fileName || null);
      const r = await firstValueFrom(this.api.enregistrer(corps));
      if (this.detruit) return;
      if (r.success) this.ecrire(`✓ Source enregistrée (id: ${r.source_id})`);
      else this.ecrire(`! Enregistrement source : ${r.error}`);
    } catch {
      if (!this.detruit) this.ecrire(`! Impossible d'enregistrer la source (non bloquant)`);
    }
  }

  /**
   * Une ligne de journal horodatée à l'écriture (`[HH:MM:SS]`, `toLocaleTimeString('fr-FR')`), colorée par la
   * règle de React (l.259-263 d'`ImportStep.tsx`) : ✕ / « ! » / « Exception » en rouge, ✓ en vert, « RAPPORT »
   * et « ═ » en bleu, le reste en texte secondaire.
   */
  private ecrire(texte: string): void {
    const niveau: LigneJournal['niveau'] = texte.includes('✕') || texte.includes('! ') || texte.includes('Exception')
      ? 'error'
      : texte.includes('✓') ? 'success' : texte.includes('RAPPORT') || texte.includes('═') ? 'rapport' : 'log';
    this.journal.update((j) => [...j.slice(-LIGNES_GARDEES), { message: texte, niveau, horodatage: Date.now() }]);
  }

  private demarrerChrono(): void {
    this.arreterChrono();
    this.ecoule.set(0);
    const debut = Date.now();
    this.chrono = setInterval(() => this.ecoule.set(Math.floor((Date.now() - debut) / 1000)), 1000);
  }

  private arreterChrono(): void {
    if (this.chrono !== null) clearInterval(this.chrono);
    this.chrono = null;
  }
}
