import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { STRATEGIE_SANS_SESSION } from '../core/auth/strategie-sans-session';
import { messageErreurApi } from '../core/http/erreurs';
import { OrganisationsApi, type Organisation } from '../features/session/data/organisations.api';
import { ecouterFermeture } from './fermeture';

type Menu = 'org' | 'utilisateur';

/**
 * `components/SessionBadge.tsx` porté : sélecteur d'organisation, filet, badge
 * utilisateur et leurs deux menus. Styles recopiés un à un (les `style={{…}}`
 * de React deviennent des classes Tailwind sur les jetons).
 *
 * Écarts VOULUS, tous tenus par la règle « défaut objectif de React » ou par
 * l'isolation dans le shell AIDA :
 * - menus rendus DANS l'arbre (`absolute`, jamais un portail) ;
 * - pas d'ombre portée (`boxShadow` de React) : « flat total » (DESIGN_SYSTEM § 2) ;
 * - Échap ferme un menu et rend le focus au déclencheur, qui porte
 *   `aria-expanded` ; l'ouverture met le focus sur la première option ;
 * - après un changement d'organisation, React fait `window.location.reload()` :
 *   dans un hôte, cela rechargerait le SHELL. On relit la liste et on émet
 *   `orgChangee` ; la coquille recrée alors la page courante, sans quitter la
 *   remote ni écrire l'URL ;
 * - un échec du changement s'affiche en français dans la liste (React se taisait) ;
 * - pas de vide avant la session : dans la coquille, la session est déjà là
 *   (l'`authGuard` l'a exigée), le « … » de chargement de React n'a pas lieu d'être.
 */
@Component({
  selector: 'mg-badge-session',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex shrink-0 items-center gap-1.5' },
  styles: `
    @keyframes apparition {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .apparait { animation: apparition 0.15s ease; }
  `,
  template: `
    <!-- ── Sélecteur d'organisation ── -->
    <div #zoneOrg class="relative">
      <button
        #declencheurOrg
        type="button"
        data-declencheur="org"
        [attr.aria-expanded]="listeDisponible() ? ouvert() === 'org' : null"
        [attr.aria-controls]="listeDisponible() ? 'mg-menu-org' : null"
        (click)="basculer('org')"
        class="flex items-center gap-1.5 rounded-[6px] border-fin px-[10px] py-[5px] transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)]"
        [class]="etatDeclencheurOrg()"
      >
        <span
          class="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] border border-[color-mix(in_srgb,var(--brand-teal)_20%,transparent)] bg-teal-10 font-sans text-[10px] font-bold text-teal"
        >{{ initiale() }}</span>
        <span class="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[12px] font-medium text-primary">{{ nomOrg() || 'Organisation' }}</span>
        @if (listeDisponible()) {
          <span class="text-[8px] text-tertiary transition-transform duration-200" [class.rotate-180]="ouvert() === 'org'">▼</span>
        }
      </button>

      @if (ouvert() === 'org') {
        <div
          id="mg-menu-org"
          data-menu="org"
          class="apparait absolute left-0 top-[calc(100%+4px)] z-[20000] min-w-[200px] rounded-[8px] border-fin border-default bg-surface p-1"
        >
          @if (superAdmin()) {
            <button
              type="button"
              [disabled]="changement()"
              [attr.aria-current]="orgActive() === null ? 'true' : null"
              (click)="changer(null)"
              [class]="classeOption(orgActive() === null, 'text-tertiary')"
            >
              @if (orgActive() === null) {
                <span class="size-[5px] rounded-full bg-teal"></span>
              }
              Toutes les organisations
            </button>
          }
          @for (org of orgs(); track org.id) {
            <button
              type="button"
              [disabled]="changement()"
              [attr.aria-current]="orgActive() === org.id ? 'true' : null"
              (click)="changer(org.id)"
              [class]="classeOption(orgActive() === org.id, 'text-secondary')"
            >
              @if (orgActive() === org.id) {
                <span class="size-[5px] rounded-full bg-teal"></span>
              }
              {{ org.name }}
            </button>
          }
          @if (erreur(); as message) {
            <p role="alert" class="px-[10px] py-[7px] font-sans text-[11px] text-danger">{{ message }}</p>
          }
        </div>
      }
    </div>

    <!-- ── Filet ── -->
    <div class="h-[18px] w-[0.5px] shrink-0 bg-default"></div>

    <!-- ── Badge utilisateur ── -->
    <div #zoneUtilisateur class="relative">
      <button
        #declencheurUtilisateur
        type="button"
        data-declencheur="utilisateur"
        [attr.aria-expanded]="ouvert() === 'utilisateur'"
        aria-controls="mg-menu-utilisateur"
        (click)="basculer('utilisateur')"
        class="flex cursor-pointer items-center gap-1.5 rounded-[6px] border-fin px-[10px] py-[5px] transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)] hover:bg-elevated"
        [class]="ouvert() === 'utilisateur' ? 'bg-elevated border-default' : 'bg-transparent border-transparent'"
      >
        <span class="size-[6px] shrink-0 rounded-full bg-success"></span>
        <span class="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[11px] text-secondary">{{ emailAffiche() }}</span>
        <span class="text-[8px] text-tertiary transition-transform duration-200" [class.rotate-180]="ouvert() === 'utilisateur'">▼</span>
      </button>

      @if (ouvert() === 'utilisateur') {
        <div
          id="mg-menu-utilisateur"
          data-menu="utilisateur"
          class="apparait absolute right-0 top-[calc(100%+4px)] z-[20000] w-[220px] rounded-[8px] border-fin border-default bg-surface p-[10px]"
        >
          <!-- 16 px : la taille HÉRITÉE du body React ; elle fixe la hauteur de ligne autour de la pastille du rôle. -->
          <div class="mb-1.5 px-2 py-1 text-[16px]">
            <div class="break-all font-sans text-[12px] text-primary">{{ email() }}</div>
            <span data-role class="mt-1 inline-block rounded-[3px] bg-elevated px-[5px] py-px font-mono text-[9px] text-tertiary">{{ role() }}</span>
          </div>
          <div class="my-1 h-[0.5px] bg-subtle"></div>
          <button
            type="button"
            (click)="deconnecter()"
            class="w-full cursor-pointer rounded-md border-0 bg-transparent px-2 py-1.5 text-left font-sans text-[11px] text-tertiary transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] hover:text-danger"
          >Deconnexion</button>
        </div>
      }
    </div>
  `,
})
export class BadgeSessionComponent {
  private readonly auth = inject(AuthService);
  private readonly api = inject(OrganisationsApi);
  private readonly router = inject(Router);
  private readonly strategie = inject(STRATEGIE_SANS_SESSION);
  private readonly doc = inject(DOCUMENT);
  private readonly detruit = inject(DestroyRef);
  private readonly injecteur = inject(Injector);

  /** Émis après un changement d'organisation réussi : la coquille recrée la page courante. */
  readonly orgChangee = output<string | null>();

  private readonly zoneOrg = viewChild.required<ElementRef<HTMLElement>>('zoneOrg');
  private readonly zoneUtilisateur = viewChild.required<ElementRef<HTMLElement>>('zoneUtilisateur');
  private readonly declencheurOrg = viewChild.required<ElementRef<HTMLButtonElement>>('declencheurOrg');
  private readonly declencheurUtilisateur = viewChild.required<ElementRef<HTMLButtonElement>>('declencheurUtilisateur');

  protected readonly ouvert = signal<Menu | null>(null);
  protected readonly orgs = signal<Organisation[]>([]);
  protected readonly orgActive = signal<string | null>(null);
  protected readonly superAdmin = signal(false);
  /** Nom affiché : celui de l'organisation active, « ... » si elle est inconnue, « Toutes » sans organisation. Vide avant la réponse. */
  protected readonly nomOrg = signal('');
  protected readonly changement = signal(false);
  protected readonly erreur = signal<string | null>(null);
  private readonly roleProfil = signal<string | null>(null);

  protected readonly listeDisponible = computed(() => this.orgs().length > 1 || this.superAdmin());
  /** Ouvert : fond level-2 et bord ; au repos : transparent ; survol level-2 seulement s'il y a une liste (`SessionBadge.tsx:103-111`). */
  protected readonly etatDeclencheurOrg = computed(() => {
    const ouvert = this.ouvert() === 'org' ? 'bg-elevated border-default' : 'bg-transparent border-transparent';
    return this.listeDisponible() ? `${ouvert} cursor-pointer hover:bg-elevated` : `${ouvert} cursor-default`;
  });
  protected readonly initiale = computed(() => (this.nomOrg() ? this.nomOrg().charAt(0).toUpperCase() : '●'));
  protected readonly email = computed(() => this.auth.email() ?? '');
  protected readonly emailAffiche = computed(() => {
    const e = this.email();
    return e.length > 25 ? e.slice(0, 22) + '…' : e;
  });
  /** Comme `useSession` : le rôle du profil, sinon celui des métadonnées du jeton, sinon « user ». */
  protected readonly role = computed(() => {
    const meta = (this.auth.session()?.user?.user_metadata as { role?: unknown } | undefined)?.role;
    return this.roleProfil() ?? (typeof meta === 'string' ? meta : null) ?? 'user';
  });

  private retirerEcoute: (() => void) | null = null;

  constructor() {
    this.charger();
    void this.auth.lireRole().then((r) => this.roleProfil.set(r));

    // Écoute de fermeture posée tant qu'un menu est ouvert, retirée ensuite.
    effect(() => {
      const menu = this.ouvert();
      untracked(() => {
        this.retirerEcoute?.();
        this.retirerEcoute = null;
        if (!menu) return;
        const zone = menu === 'org' ? this.zoneOrg() : this.zoneUtilisateur();
        this.retirerEcoute = ecouterFermeture(this.doc, () => [zone.nativeElement], (raison) => this.fermer(raison === 'echap'));
      });
    });
    this.detruit.onDestroy(() => this.retirerEcoute?.());
  }

  /** Classes d'une option de la liste d'organisations (`SessionBadge.tsx:140-167`). */
  protected classeOption(active: boolean, couleurInactive: string): string {
    const base = 'flex w-full items-center gap-1.5 rounded-[5px] border-0 px-[10px] py-[7px] text-left font-sans text-[11px] transition-[background] duration-100';
    const curseur = this.changement() ? 'cursor-wait' : 'cursor-pointer';
    return active
      ? `${base} ${curseur} bg-[color-mix(in_srgb,var(--brand-teal)_8%,transparent)] text-teal`
      : `${base} ${curseur} bg-transparent hover:bg-overlay ${couleurInactive}`;
  }

  protected basculer(menu: Menu): void {
    if (menu === 'org' && !this.listeDisponible()) return;
    if (this.ouvert() === menu) {
      this.ouvert.set(null);
      return;
    }
    this.erreur.set(null);
    this.ouvert.set(menu);
    // Le focus entre dans le menu, sur sa première option, une fois celui-ci rendu.
    afterNextRender(
      () => {
        const zone = menu === 'org' ? this.zoneOrg() : this.zoneUtilisateur();
        zone.nativeElement.querySelector<HTMLButtonElement>('[data-menu] button')?.focus();
      },
      { injector: this.injecteur },
    );
  }

  private fermer(rendreFocus: boolean): void {
    const menu = this.ouvert();
    this.ouvert.set(null);
    if (!rendreFocus || !menu) return;
    (menu === 'org' ? this.declencheurOrg() : this.declencheurUtilisateur()).nativeElement.focus();
  }

  private charger(): void {
    this.api.lister().subscribe({
      next: (r) => {
        this.orgs.set(r.organizations ?? []);
        this.orgActive.set(r.active_org_id ?? null);
        this.superAdmin.set(r.is_super_admin ?? false);
        const nom = (r.organizations ?? []).find((o) => o.id === r.active_org_id)?.name;
        this.nomOrg.set(nom ?? (r.active_org_id ? '...' : 'Toutes'));
      },
      // Comme React (`.catch(() => {})`) : le sélecteur reste sur « Organisation », sans liste.
      error: () => undefined,
    });
  }

  protected changer(organisationId: string | null): void {
    this.changement.set(true);
    this.erreur.set(null);
    this.api.changer(organisationId).subscribe({
      next: () => {
        this.changement.set(false);
        this.orgActive.set(organisationId);
        this.ouvert.set(null);
        this.charger();
        this.orgChangee.emit(organisationId);
      },
      error: (e: unknown) => {
        this.changement.set(false);
        this.erreur.set(messageErreurApi(e));
      },
    });
  }

  /**
   * Autonome : vers la page de connexion, SANS page à reprendre — l'utilisateur
   * a choisi de partir. Cette navigation démarre avant que l'effet de
   * `RacineDistanteComponent` ne voie la session à null : il la trouve en
   * cours et s'abstient, sans quoi il ajouterait `?redirection=…`.
   * ⚠ HYPOTHÈSE nommée : cet ordre tient au planificateur ZONELESS. La mise à
   * null de la session ne fait que PROGRAMMER une détection de changement
   * (tâche macro), alors que `navigateByUrl` part dans la micro-tâche qui suit
   * l'`await` — donc avant que l'effet ne s'exécute. Sous zone.js, ou si un
   * appel synchrone à `ApplicationRef.tick()` s'intercalait, l'effet pourrait
   * passer le premier et rediriger AVEC `?redirection=…` — la navigation de la
   * coquille, lancée après, annulerait sans doute la sienne, mais ce cas n'est
   * ni testé ni mesuré. Verrouillé dans le mode actuel par `app.config.spec.ts`
   * (« Deconnexion » mène à /connexion, sans paramètre de reprise).
   * Dans un hôte : pas de navigation, la racine affiche « Session requise… ».
   * (React : `signOut()` puis `window.location.href = "/login"` — une URL de
   * page, interdite dans une remote.)
   */
  protected async deconnecter(): Promise<void> {
    this.ouvert.set(null);
    await this.auth.deconnecter();
    if (this.strategie.mode === 'rediriger') await this.router.navigateByUrl(this.strategie.chemin);
  }
}
