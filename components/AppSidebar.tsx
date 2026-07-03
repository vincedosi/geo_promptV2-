'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  Database,
  FileUp,
  Layers,
  Lock,
  MapPin,
  Monitor,
  Plug,
  Radio,
  Share2,
  Target,
  Upload,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'

// ─── Nav data ──────────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  badge?: string
}

type NavSection = {
  section: string
  items: NavItem[]
}

const navItems: NavSection[] = [
  {
    section: 'Analyse',
    items: [
      { href: '/map', label: 'geo.prompt', icon: MapPin },
      { href: '/clusters', label: 'Clustering', icon: Share2 },
      { href: '/map?layer=digital', label: 'Digital', icon: BarChart3 },
      { href: '/map/custom-geo', label: 'Zones custom', icon: Layers },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/admin/carreaux-import', label: 'Import Shapefile', icon: Upload, badge: 'Admin' },
      { href: '/admin/import', label: 'Import POI', icon: FileUp, badge: 'Admin' },
      { href: '/admin/ooh-import', label: 'Import OOH', icon: Monitor, badge: 'Admin' },
      { href: '/dashboard/iris-crawler', label: 'IRIS Crawler', icon: Layers, badge: 'Admin' },
      { href: '/admin/radio', label: 'Radio FM/DAB+', icon: Radio, badge: 'Admin' },
      { href: '/admin/campaigns', label: 'Campagnes DSP', icon: Target, badge: 'Admin' },
    ],
  },
  {
    section: 'API',
    items: [
      { href: '/admin/api', label: 'Connexions API', icon: Plug },
    ],
  },
  {
    section: 'Systeme',
    items: [
      { href: '/admin/sources', label: 'Sources', icon: Database },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/organizations', label: 'Organisations', icon: Users },
      { href: '/login', label: 'Connexion', icon: Lock },
      { href: '/admin/imports', label: 'Imports', icon: Upload },
      { href: '/admin/health', label: 'Health check', icon: Activity, badge: 'Sys' },
    ],
  },
]

// ─── Single nav item ────────────────────────────────────────────────────────────

function NavLink({
  item,
  pathname,
  index,
}: {
  item: NavItem
  pathname: string
  index: number
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== '/' && pathname.startsWith(item.href))

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-3 py-[9px] text-[13px] font-normal',
        'border-l-2 pl-[10px]',
        'transition-all duration-150 ease-out',
        isActive
          ? 'bg-bg-level-3 text-text-primary border-text-primary'
          : 'text-text-secondary border-transparent hover:bg-bg-level-2 hover:text-text-primary hover:translate-x-[2px]'
      )}
      style={{
        animationDelay: `${index * 40}ms`,
      }}
    >
      <item.icon
        size={16}
        strokeWidth={1.5}
        className={cn(
          'shrink-0 transition-colors duration-150',
          isActive ? 'text-text-primary' : 'text-text-tertiary group-hover:text-text-secondary'
        )}
      />
      <span className="flex-1 leading-none">{item.label}</span>
      {item.badge && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-bg-level-3 border border-border-default text-text-tertiary"
          style={{
            lineHeight: 1.4,
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  )
}

// ─── Sidebar content (shared between fixed + sheet) ───────────────────────────

function SidebarContent({ pathname }: { pathname: string }) {
  const [time, setTime] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const tick = () => {
      setTime(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    // Trigger staggered mount animation
    requestAnimationFrame(() => setMounted(true))
    return () => clearInterval(id)
  }, [])

  let globalIndex = 0

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-surface)' }}>

      {/* ── Header / Logo ──────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2">
          {/* Hexagon icon */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            className="shrink-0"
          >
            <path
              d="M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z"
              stroke="#4ecdc4"
              strokeWidth="1"
              fill="none"
            />
            <path
              d="M14 7L20.5 10.5V17.5L14 21L7.5 17.5V10.5L14 7Z"
              stroke="#4ecdc4"
              strokeWidth="0.5"
              fill="rgba(78,205,196,0.06)"
            />
            <circle cx="14" cy="14" r="2" fill="#4ecdc4" opacity="0.5" />
          </svg>
          <img
            src="/magelian-icon.svg"
            alt="MAGELIAN"
            style={{ height: 18, width: 'auto', display: 'block' }}
          />
        </div>
        <p
          className="mt-1.5 text-[11px]"
          style={{ color: 'var(--text-tertiary)', fontWeight: 400, paddingLeft: 36 }}
        >
          Geospatial intelligence
        </p>
      </div>

      <Separator style={{ background: 'var(--border-subtle)', height: '0.5px' }} />

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0">
        {navItems.map((section, si) => (
          <div key={section.section} className={si > 0 ? 'mt-5' : ''}>
            <p
              className="mb-2 px-3 text-[11px]"
              style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}
            >
              {section.section}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const idx = globalIndex++
                return (
                  <div
                    key={item.href}
                    className="transition-all duration-300"
                    style={{
                      opacity: mounted ? 1 : 0,
                      transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
                      transitionDelay: `${idx * 40}ms`,
                    }}
                  >
                    <NavLink item={item} pathname={pathname} index={idx} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {process.env.NODE_ENV === 'development' && (
        <>
          <Separator style={{ background: 'var(--border-subtle)', height: '0.5px' }} />

          {/* ── Footer ─────────────────────────────────────────────────────────── */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              {/* Green status dot */}
              <span className="relative flex shrink-0" style={{ width: 6, height: 6 }}>
                <span
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: 'var(--success)', opacity: 0.4, animationDuration: '2s' }}
                />
                <span
                  className="relative inline-flex rounded-full"
                  style={{ width: 6, height: 6, background: 'var(--success)' }}
                />
              </span>
              <span
                className="text-[11px]"
                style={{ color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace" }}
              >
                Online
              </span>
              {time && (
                <span
                  className="ml-auto text-[10px]"
                  style={{
                    color: 'var(--border-hover)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {time}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Mobile trigger (Sheet) ────────────────────────────────────────────────────

function MobileSidebarTrigger({ pathname }: { pathname: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-3 left-3 z-50 md:hidden"
          style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)' }}
        >
          <Menu size={16} style={{ color: 'var(--text-secondary)' }} />
          <span className="sr-only">Ouvrir la navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="p-0 border-r-0"
        style={{
          width: 240,
          background: 'var(--bg-surface)',
          borderRight: '0.5px solid var(--border-subtle)',
        }}
      >
        <SidebarContent pathname={pathname} />
      </SheetContent>
    </Sheet>
  )
}

// ─── Default export ────────────────────────────────────────────────────────────

export default function AppSidebar() {
  const pathname = usePathname()
  if (pathname?.startsWith('/map')) {
    return null
  }

  return (
    <>
      {/* Fixed sidebar — desktop */}
      <aside
        className="hidden md:flex md:flex-col fixed inset-y-0 left-0 z-40"
        style={{
          width: 240,
          borderRight: '0.5px solid var(--border-subtle)',
        }}
      >
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Sheet sidebar — mobile */}
      <MobileSidebarTrigger pathname={pathname} />
    </>
  )
}
