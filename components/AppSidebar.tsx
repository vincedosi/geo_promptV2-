'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Activity,
  Database,
  FileUp,
  Layers,
  LayoutGrid,
  Lock,
  MapPin,
  Monitor,
  PlusCircle,
  Share2,
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
    section: 'App',
    items: [
      { href: '/map', label: 'geo.prompt', icon: MapPin },
      { href: '/clusters', label: 'Clustering', icon: Share2 },
    ],
  },
  {
    section: 'Admin',
    items: [
      { href: '/integration-panneaux', label: 'Intégration', icon: LayoutGrid, badge: 'CSV' },
      { href: '/admin/carreaux-import', label: 'Import Shapefile', icon: Upload, badge: 'Admin' },
      { href: '/admin/filosofi-import', label: 'Filosofi Import', icon: PlusCircle, badge: 'Admin' },
      { href: '/admin/import', label: 'Import POI', icon: FileUp, badge: 'Admin' },
      { href: '/admin/ooh-import', label: 'Import OOH', icon: Monitor, badge: 'Admin' },
      { href: '/dashboard/iris-crawler', label: 'IRIS Crawler', icon: Layers, badge: 'Admin' },
    ],
  },
  {
    section: 'Système',
    items: [
      { href: '/admin/sources', label: 'Sources', icon: Database },
      { href: '/admin/organizations', label: 'Organisations', icon: Users },
      { href: '/login', label: 'Connexion', icon: Lock },
      { href: '/admin/imports', label: 'Imports', icon: Upload },
      { href: '/admin/health', label: 'Health Check', icon: Activity, badge: 'Sys' },
    ],
  },
]

// ─── Single nav item ────────────────────────────────────────────────────────────

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    pathname === item.href ||
    (item.href !== '/' && pathname.startsWith(item.href))

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors',
        isActive
          ? 'bg-[#151515] text-[#f0f0f0] border-l-2 border-[#f0f0f0] pl-[10px]'
          : 'text-[#a0a0a0] hover:bg-[#111111] hover:text-[#f0f0f0] border-l-2 border-transparent pl-[10px]'
      )}
    >
      <item.icon
        size={16}
        className={cn(
          'shrink-0 transition-colors',
          isActive ? 'text-[#f0f0f0]' : 'text-[#a0a0a0] group-hover:text-[#f0f0f0]'
        )}
      />
      <span className="flex-1 leading-none">{item.label}</span>
      {item.badge && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            background: '#181818',
            border: '0.5px solid #262626',
            color: '#666666',
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
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex h-full flex-col" style={{ background: '#0a0a0a' }}>

      {/* Header */}
      <div className="px-4 py-4">
        <p
          className="text-[15px] leading-tight"
          style={{ color: '#f0f0f0', fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif' }}
        >
          GENESIS
        </p>
        <p
          className="mt-0.5 text-[11px]"
          style={{ color: '#666666', fontWeight: 400 }}
        >
          Geospatial intelligence
        </p>
      </div>

      <Separator style={{ background: '#1a1a1a', height: '0.5px' }} />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0">
        {navItems.map((section, si) => (
          <div key={section.section} className={si > 0 ? 'mt-5' : ''}>
            <p
              className="mb-1.5 px-3 text-[11px]"
              style={{ color: '#666666', fontWeight: 400 }}
            >
              {section.section}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Separator style={{ background: '#1a1a1a', height: '0.5px' }} />

      {/* Footer */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="relative flex h-1.5 w-1.5 shrink-0"
            aria-hidden
          >
            <span
              className="absolute inset-0 rounded-full animate-ping opacity-60"
              style={{ background: '#3dffa0' }}
            />
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ background: '#3dffa0', boxShadow: '0 0 6px #3dffa0' }}
            />
          </span>
          <span className="text-[11px]" style={{ color: '#666666' }}>
            Online
          </span>
          {time && (
            <span
              className="ml-auto text-[10px] font-mono"
              style={{ color: '#444444' }}
            >
              {time}
            </span>
          )}
        </div>
      </div>

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
          style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a' }}
        >
          <Menu size={16} style={{ color: '#a0a0a0' }} />
          <span className="sr-only">Ouvrir la navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="p-0 border-r-0"
        style={{
          width: 240,
          background: '#0a0a0a',
          borderRight: '0.5px solid #1a1a1a',
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

  return (
    <>
      {/* Fixed sidebar — desktop */}
      <aside
        className="hidden md:flex md:flex-col fixed inset-y-0 left-0 z-40"
        style={{
          width: 240,
          borderRight: '0.5px solid #1a1a1a',
        }}
      >
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Sheet sidebar — mobile */}
      <MobileSidebarTrigger pathname={pathname} />
    </>
  )
}
