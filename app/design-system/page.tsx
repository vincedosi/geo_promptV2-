import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertCircle,
  CheckCircle2,
  Info,
  LayoutDashboard,
  Map,
  MapPin,
  Settings,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'

// ─── Colour palette data ───────────────────────────────────────────────────────

const surfaces = [
  { name: '--background', hex: '#050505', label: 'Background' },
  { name: '--card', hex: '#0a0a0a', label: 'Card' },
  { name: '--popover', hex: '#111111', label: 'Popover' },
  { name: '--secondary', hex: '#111111', label: 'Secondary' },
  { name: '--muted', hex: '#181818', label: 'Muted' },
]

const borders = [
  { name: '--border', hex: '#1a1a1a', label: 'Border' },
  { name: '--input', hex: '#262626', label: 'Input' },
  { name: '--ring', hex: '#333333', label: 'Ring' },
]

const text = [
  { name: '--foreground', hex: '#f0f0f0', label: 'Foreground' },
  { name: '--primary', hex: '#f0f0f0', label: 'Primary' },
  { name: '--secondary-fg', hex: '#a0a0a0', label: 'Secondary FG' },
  { name: '--muted-fg', hex: '#666666', label: 'Muted FG' },
]

const accents = [
  { name: '--success', hex: '#3dffa0', label: 'Success' },
  { name: '--warning', hex: '#f7b731', label: 'Warning' },
  { name: '--info', hex: '#5b9bd5', label: 'Info' },
  { name: '--destructive', hex: '#ff5757', label: 'Destructive' },
]

// ─── Mock data ─────────────────────────────────────────────────────────────────

const mockTableRows = [
  { panneau: 'P-2031-A', format: '4x3m', score: 87, audience: '12 400', statut: 'actif' },
  { panneau: 'P-1882-B', format: 'Abribus', score: 74, audience: '8 700', statut: 'actif' },
  { panneau: 'P-3310-C', format: 'DOOH', score: 91, audience: '21 000', statut: 'actif' },
  { panneau: 'P-0042-D', format: '4x3m', score: 53, audience: '5 200', statut: 'inactif' },
]

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', active: false },
  { icon: Map, label: 'Copilote', active: true },
  { icon: MapPin, label: 'Panneaux OOH', active: false },
  { icon: Users, label: 'Organisations', active: false },
  { icon: Settings, label: 'Administration', active: false },
]

// ─── Section header ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
        {children}
      </h2>
      <Separator />
    </div>
  )
}

// ─── Colour swatch ─────────────────────────────────────────────────────────────

function Swatch({ hex, label, name }: { hex: string; label: string; name: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-12 w-full rounded-md border border-border"
        style={{ background: hex }}
      />
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <p className="text-[10px] font-mono text-muted-foreground">{hex}</p>
      <p className="text-[10px] font-mono text-muted-foreground truncate">{name}</p>
    </div>
  )
}

// ─── Mock score panel ──────────────────────────────────────────────────────────

function ScorePanel() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono uppercase tracking-wider">
            Score OOH
          </CardTitle>
          <Badge variant="secondary" className="font-mono text-xs">P-3310-C</Badge>
        </div>
        <CardDescription>DOOH — Paris 8e — Bd Haussmann</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Big score */}
        <div className="flex items-end gap-3">
          <span className="text-5xl font-mono font-bold text-foreground">91</span>
          <div className="mb-1 space-y-0.5">
            <p className="text-xs text-muted-foreground">/ 100</p>
            <Badge className="text-[10px]" style={{ background: '#3dffa0', color: '#050505' }}>
              Excellent
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Stat rows */}
        {[
          { label: 'Audience / semaine', value: '21 000', icon: Users },
          { label: 'Score démographie', value: '88 / 100', icon: TrendingUp },
          { label: 'Proximité POI', value: '7 POI dans 500m', icon: MapPin },
          { label: 'Trafic estimé', value: '45 000 veh/j', icon: Zap },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon size={12} />
              {label}
            </div>
            <span className="text-xs font-mono text-foreground">{value}</span>
          </div>
        ))}
      </CardContent>

      <CardFooter className="gap-2">
        <Button size="sm" className="flex-1">Exporter</Button>
        <Button size="sm" variant="outline" className="flex-1">Comparer</Button>
      </CardFooter>
    </Card>
  )
}

// ─── Mock sidebar ──────────────────────────────────────────────────────────────

function MockSidebar() {
  return (
    <Card className="w-56 h-[420px] flex flex-col p-0 overflow-hidden">
      {/* Logo area */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-mono font-bold tracking-widest uppercase text-foreground">
          GEO<span className="text-muted-foreground">.</span>PROMPT
        </p>
        <p className="text-[9px] font-mono text-muted-foreground tracking-wider mt-0.5">
          GEOSPATIAL INTELLIGENCE
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest px-2 py-1.5">
          Navigation
        </p>
        {navItems.map(({ icon: Icon, label, active }) => (
          <div
            key={label}
            className={[
              'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors',
              active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            ].join(' ')}
          >
            <Icon size={13} />
            {label}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#3dffa0', boxShadow: '0 0 6px #3dffa0' }}
          />
          <span className="text-[10px] font-mono text-muted-foreground">
            Connecté · Pro
          </span>
        </div>
      </div>
    </Card>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-14">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Terminal size={16} className="text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              genesis / design-system
            </span>
          </div>
          <h1 className="text-2xl font-mono font-bold tracking-tight text-foreground">
            GENESIS Dark Minimal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            shadcn/ui · New York style · Dark only · Inter + JetBrains Mono
          </p>
        </div>

        {/* ── Colour palette ── */}
        <section>
          <SectionTitle>Palette de couleurs</SectionTitle>
          <Tabs defaultValue="surfaces">
            <TabsList className="mb-4">
              <TabsTrigger value="surfaces">Surfaces</TabsTrigger>
              <TabsTrigger value="borders">Borders</TabsTrigger>
              <TabsTrigger value="text">Texte</TabsTrigger>
              <TabsTrigger value="accents">Accents</TabsTrigger>
            </TabsList>

            <TabsContent value="surfaces">
              <div className="grid grid-cols-5 gap-3">
                {surfaces.map((s) => <Swatch key={s.name} {...s} />)}
              </div>
            </TabsContent>
            <TabsContent value="borders">
              <div className="grid grid-cols-5 gap-3">
                {borders.map((s) => <Swatch key={s.name} {...s} />)}
              </div>
            </TabsContent>
            <TabsContent value="text">
              <div className="grid grid-cols-5 gap-3">
                {text.map((s) => <Swatch key={s.name} {...s} />)}
              </div>
            </TabsContent>
            <TabsContent value="accents">
              <div className="grid grid-cols-4 gap-3">
                {accents.map((s) => <Swatch key={s.name} {...s} />)}
              </div>
            </TabsContent>
          </Tabs>
        </section>

        {/* ── Typography ── */}
        <section>
          <SectionTitle>Typographie</SectionTitle>
          <div className="space-y-3">
            <p className="text-3xl font-bold tracking-tight">Inter Bold — Titres</p>
            <p className="text-lg font-medium text-muted-foreground">Inter Medium — Sous-titres</p>
            <p className="text-sm text-muted-foreground">
              Inter Regular — Corps de texte. Données socio-démographiques, IRIS, carreaux Filosofi.
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              JetBrains Mono — Données numériques · Score: 91.4 · Audience: 21 000 · IRIS: 75108
            </p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Micro labels — catégorie · source · statut
            </p>
          </div>
        </section>

        {/* ── Buttons ── */}
        <section>
          <SectionTitle>Boutons</SectionTitle>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg">Large</Button>
              <Button size="default">Default</Button>
              <Button size="sm">Small</Button>
              <Button size="icon"><Zap size={14} /></Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled>Disabled</Button>
              <Button variant="outline" disabled>Outline disabled</Button>
            </div>
          </div>
        </section>

        {/* ── Badges ── */}
        <section>
          <SectionTitle>Badges</SectionTitle>
          <div className="flex flex-wrap gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge style={{ background: '#3dffa0', color: '#050505' }}>Success</Badge>
            <Badge style={{ background: 'rgba(61,255,160,0.12)', color: '#3dffa0', border: '1px solid rgba(61,255,160,0.3)' }}>
              Success dim
            </Badge>
            <Badge style={{ background: 'rgba(247,183,49,0.12)', color: '#f7b731', border: '1px solid rgba(247,183,49,0.3)' }}>
              Warning
            </Badge>
          </div>
        </section>

        {/* ── Inputs ── */}
        <section>
          <SectionTitle>Inputs</SectionTitle>
          <div className="grid grid-cols-2 gap-4 max-w-lg">
            <Input placeholder="Rechercher une zone…" />
            <Input placeholder="Rayon (km)" type="number" />
            <Input placeholder="Disabled" disabled />
            <Input placeholder="API Key" type="password" />
          </div>
        </section>

        {/* ── Alerts ── */}
        <section>
          <SectionTitle>Alertes</SectionTitle>
          <div className="space-y-3 max-w-xl">
            <Alert>
              <Info size={14} />
              <AlertTitle>Information</AlertTitle>
              <AlertDescription>
                Le budget I/O Supabase Nano est limité à 250 IOPS. Chaque requête compte.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertCircle size={14} />
              <AlertTitle>Erreur critique</AlertTitle>
              <AlertDescription>
                Disk I/O épuisé — Auth 504 — application inaccessible.
              </AlertDescription>
            </Alert>
            <Alert className="border-[#3dffa0]/30 text-[#3dffa0]">
              <CheckCircle2 size={14} />
              <AlertTitle>Import réussi</AlertTitle>
              <AlertDescription className="text-[#3dffa0]/70">
                3 421 POI importés depuis data.gouv.fr en 2.3 s.
              </AlertDescription>
            </Alert>
          </div>
        </section>

        {/* ── Skeletons ── */}
        <section>
          <SectionTitle>Skeletons</SectionTitle>
          <div className="space-y-3 max-w-sm">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-3 mt-4">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          </div>
        </section>

        {/* ── Table ── */}
        <section>
          <SectionTitle>Table — Panneaux OOH</SectionTitle>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Panneau</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Audience / sem.</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockTableRows.map((row) => (
                    <TableRow key={row.panneau}>
                      <TableCell className="font-mono text-xs">{row.panneau}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.format}</TableCell>
                      <TableCell>
                        <span className={[
                          'font-mono font-bold text-sm',
                          row.score >= 80 ? 'text-[#3dffa0]' : row.score >= 60 ? 'text-[#f7b731]' : 'text-[#ff5757]',
                        ].join(' ')}>
                          {row.score}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.audience}</TableCell>
                      <TableCell>
                        <Badge
                          variant={row.statut === 'actif' ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {row.statut}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        {/* ── Mocks ── */}
        <section>
          <SectionTitle>Mocks — Composants GENESIS</SectionTitle>
          <div className="flex gap-6 flex-wrap items-start">
            <ScorePanel />
            <MockSidebar />
          </div>
        </section>

      </div>
    </div>
  )
}
