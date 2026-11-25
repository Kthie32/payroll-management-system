'use client';

import {
  BarChart3,
  HandCoins,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { NavIcon, NavItem } from './nav-items';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  employees: Users,
  payroll: Wallet,
  reports: BarChart3,
  loans: HandCoins,
  settings: Settings,
  users: ShieldCheck,
  audit: ScrollText,
};

export function Sidebar({
  items,
  userName,
  roleLabels,
}: {
  items: NavItem[];
  userName: string;
  roleLabels: string[];
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b px-5 py-4">
          <p className="text-base font-semibold">Payroll</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-3" aria-label="Main">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive(item.href)
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <p className="truncate px-3 text-sm font-medium">{userName}</p>
          <p className="truncate px-3 text-xs text-muted-foreground">{roleLabels.join(', ')}</p>
          <a
            href="/logout"
            className="mt-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </a>
        </div>
      </aside>

      {/* Mobile */}
      <header className="sticky top-0 z-10 border-b bg-card md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-semibold">Payroll</p>
          <a href="/logout" className="text-sm text-muted-foreground">
            Sign out
          </a>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
                isActive(item.href)
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
