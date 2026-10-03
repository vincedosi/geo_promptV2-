import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { versEtat } from '../../core/etat/vers-etat';
import { DISPONIBLE_PROCHAINEMENT } from '../../layout/navigation';
import { EnteteSectionComponent } from '../../ui/entete-section/entete-section.component';
import { EntetePageComponent } from '../../ui/entete-page/entete-page.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import type { NomIcone } from '../../ui/icone/icones';
import { TuileChiffreComponent } from '../../ui/tuile-chiffre/tuile-chiffre.component';
import { SitesRisqueApi, type CompteSites } from '../risques/data/sites-risque.api';

/**
 * Cartes de navigation rapide de `app/dashboard/page.tsx:91-98`. Aucun de ces
 * écrans n'est encore porté : elles se rendent à l'identique, mais INERTES
 * (même règle que la barre latérale).
 */
const CARTES_NAVIGATION: readonly { icone: NomIcone; libelle: string; sous: string }[] = [
  { icone: 'epingle-carte', libelle: 'geo.prompt', sous: 'Carte + IA' },
  { icone: 'ecran', libelle: 'Import OOH', sous: 'Panneaux ArcGIS' },
  { icone: 'fichier-haut', libelle: 'Import POI', sous: 'CSV / XLSX' },
  { icone: 'base-de-donnees', libelle: 'Sources', sous: 'Data lake' },
  { icone: 'utilisateurs', libelle: 'Organisations', sous: 'Multi-tenant' },
  { icone: 'calques', libelle: 'IRIS Crawler', sous: 'Données INSEE' },
];

/**
 * Tableau de bord (`app/dashboard/page.tsx`) : en-tête, rangée de quatre cartes
 * de session, « Navigation rapide ». S'y ajoute, propre à Angular, le compte des
 * sites à risque — la chaîne entière (session, proxy, Bearer, route Next.js,
 * base locale) y est éprouvée.
 */
@Component({
  selector: 'mg-accueil',
  imports: [EntetePageComponent, EnteteSectionComponent, TuileChiffreComponent, IconeComponent],
  templateUrl: './accueil.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccueilPage {
  private readonly api = inject(SitesRisqueApi);
  private readonly auth = inject(AuthService);
  private readonly nombre = new Intl.NumberFormat('fr-FR');

  protected readonly etat = versEtat<CompteSites>(this.api.compter());
  protected readonly prochainement = DISPONIBLE_PROCHAINEMENT;
  protected readonly cartesNavigation = CARTES_NAVIGATION;
  private readonly profil = signal<{ role: string | null; nom: string | null } | null>(null);

  constructor() {
    void this.auth.lireProfil().then((p) => this.profil.set(p));
  }

  protected readonly nomAffiche = computed(() => {
    const u = this.auth.session()?.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const nomMeta = (meta['full_name'] as string | undefined) ?? (meta['name'] as string | undefined) ?? null;
    return this.profil()?.nom || nomMeta || u?.email?.split('@')[0] || '—';
  });

  /** Les quatre cartes de `stats` (`page.tsx:61-88`) ; seule la première est un lien. */
  protected readonly cartesSession = computed(() => {
    const s = this.auth.session();
    const u = s?.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const role = this.profil()?.role ?? (meta['role'] as string | undefined) ?? 'user';
    const expiration = s?.expires_at
      ? new Date(s.expires_at * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      : new Date(Date.now() + 3_600_000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return [
      { icone: 'epingle-carte', valeur: 'geo.prompt', libelle: 'Copilote IA', lien: true },
      { icone: 'courrier', valeur: this.nomAffiche(), libelle: u?.email ?? '', lien: false },
      { icone: 'bouclier', valeur: role, libelle: u?.email_confirmed_at ? 'Compte vérifié' : 'Non vérifié', lien: false },
      { icone: 'horloge', valeur: expiration, libelle: 'Expiration session', lien: false },
    ] satisfies { icone: NomIcone; valeur: string; libelle: string; lien: boolean }[];
  });

  protected readonly valeurSites = computed(() => {
    const e = this.etat();
    if (e.statut === 'pret') return this.nombre.format(e.valeur.retenus);
    return e.statut === 'echec' ? '—' : '…';
  });

  protected readonly messageEchec = computed(() => {
    const e = this.etat();
    return e.statut === 'echec' ? e.message : '';
  });
}
