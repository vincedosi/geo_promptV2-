import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PileEchapService } from '../etat/pile-echap.service';
import { PanneauComponent } from './panneau.component';

@Component({
  imports: [PanneauComponent],
  template: `<mg-panneau-carte categorie="calques" titre="Calques" pastille="var(--brand-teal)">corps</mg-panneau-carte>`,
})
class HoteEssai {}

describe('Cadre des panneaux gauches (OverlayPanel.tsx)', () => {
  // Parcours T21 : React pose `backdrop-filter: blur(4px)` sur le fond translucide `--card-overlay`, ce qui
  // rend illisible ce qui passe dessous. Sans le flou (« flat total »), la légende de la carte, qui
  // s'ouvre SOUS le panneau, se lisait au travers du corps du panneau, texte sur texte. Le fond est donc
  // OPAQUE (`--surface`, teinte voisine de `--card-overlay` : la même en sombre, #0a0a0a contre
  // rgba(10,10,10,0.92) ; en clair #f5f5f5 contre rgba(248,248,248,0.90)).
  it('fond opaque `--surface`, jamais le `--card-overlay` translucide ni un flou', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), PileEchapService] });
    const fixture = TestBed.createComponent(HoteEssai);
    await fixture.whenStable();
    const hote = (fixture.nativeElement as HTMLElement).querySelector('mg-panneau-carte')!;
    expect(hote.classList.contains('bg-surface')).toBe(true);
    expect(hote.classList.contains('bg-card-overlay')).toBe(false);
    expect(hote.className).not.toMatch(/backdrop-blur/);
  });
});
