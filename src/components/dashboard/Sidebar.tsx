'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, Phone, Star, DollarSign, Target, PenLine, BarChart3, Brain,
  Settings, CreditCard, LogOut, Menu, X, ChevronLeft, ChevronRight, Building2,
  MessageSquare, CalendarDays, Crosshair,
} from 'lucide-react';

type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  soon?: boolean;
};

type NavGroup = { heading: string; items: NavItem[] };

// Plain-English navigation. Enrichment is folded into Outreach.
const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Your AI Team',
    items: [
      { href: '/dashboard',             icon: Home,      label: 'Home' },
      { href: '/dashboard/my-business', icon: Building2, label: 'My Business', subtitle: 'Your brand, voice & data' },
      { href: '/dashboard/calls',    icon: Phone,      label: 'Calls',    subtitle: 'Answers your phone 24/7' },
      { href: '/dashboard/receptionist', icon: MessageSquare, label: 'Receptionist', subtitle: 'Chats with site visitors' },
      { href: '/dashboard/scheduler',    icon: CalendarDays,  label: 'Scheduler',    subtitle: 'Books your appointments' },
      { href: '/dashboard/reviews',  icon: Star,       label: 'Reviews',  subtitle: 'Handles your reputation' },
      { href: '/dashboard/invoices', icon: DollarSign, label: 'Invoices', subtitle: 'Chases your payments' },
    ],
  },
  {
    heading: 'Grow',
    items: [
      { href: '/dashboard/hunter',  icon: Crosshair, label: 'Hunter',   subtitle: 'Finds local businesses' },
      { href: '/dashboard/leads',   icon: Target,   label: 'Outreach', subtitle: 'Finds and emails leads' },
      { href: '/dashboard/content', icon: PenLine,  label: 'Content',  subtitle: 'Posts for you' },
    ],
  },
  {
    heading: 'Intelligence',
    items: [
      { href: '/dashboard/brief', icon: BarChart3, label: 'Weekly Brief', subtitle: 'Your Monday report' },
      { href: '#',                icon: Brain,     label: 'Advisory',     subtitle: 'Your AI board', soon: true },
    ],
  },
  {
    heading: 'Account',
    items: [
      { href: '/dashboard/settings', icon: Settings,   label: 'Settings' },
      { href: '/dashboard/billing',  icon: CreditCard, label: 'Billing' },
    ],
  },
];

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-[#1F1F23] text-[#A1A1AA] border-[#2A2A30]',
  core:       'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/25',
  growth:     'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25',
  scale:      'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25',
  enterprise: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [client, setClient] = useState<{ name: string; plan_tier: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/client');
        if (!res.ok) return;
        const json = await res.json();
        setClient({ name: json.name, plan_tier: json.plan_tier });
      } catch {
        // Sidebar still renders without identity — no need to surface this.
      }
    })();
  }, []);

  const handleSignOut = async () => {
    try {
      const { supabaseBrowser } = await import('@/lib/supabase');
      await supabaseBrowser.auth.signOut();
    } catch {
      // Sign out anyway if no session exists.
    }
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '#') return false;
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const planTier = (client?.plan_tier || 'starter').toLowerCase();
  const badgeStyle = PLAN_BADGE[planTier] ?? PLAN_BADGE.starter;

  const renderItem = (item: NavItem) => {
    const { href, icon: Icon, label, subtitle, soon } = item;
    const active = isActive(href);

    const inner = (
      <>
        {/* Accent left border marks the active item — no background fill */}
        <span
          className={`absolute inset-y-1 left-0 w-[2px] rounded-r ${active ? 'bg-[#7C3AED]' : 'bg-transparent'}`}
        />
        <Icon
          className={`h-[18px] w-[18px] flex-shrink-0 ${
            active ? 'text-[#7C3AED]' : soon ? 'text-[#52525B]' : 'text-[#A1A1AA]'
          }`}
        />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={`text-sm font-semibold ${
                  active ? 'text-[#F4F4F5]' : soon ? 'text-[#71717A]' : 'text-[#E4E4E7]'
                }`}
              >
                {label}
              </span>
              {soon && (
                <span className="rounded-full border border-[#F59E0B]/25 bg-[#F59E0B]/10 px-1.5 py-px text-[10px] font-semibold text-[#F59E0B]">
                  Soon
                </span>
              )}
            </span>
            {subtitle && (
              <span className="mt-0.5 block truncate text-xs text-[#71717A]">{subtitle}</span>
            )}
          </span>
        )}
      </>
    );

    const base =
      'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors';

    // Advisory is not wired up yet, so it renders inert rather than as a link.
    if (soon) {
      return (
        <div
          key={label}
          title={collapsed ? `${label} — coming soon` : undefined}
          className={`${base} cursor-not-allowed opacity-60 ${collapsed ? 'justify-center' : ''}`}
        >
          {inner}
        </div>
      );
    }

    return (
      <Link
        key={href}
        href={href}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? (subtitle ? `${label} — ${subtitle}` : label) : undefined}
        className={`${base} ${
          active ? '' : 'hover:bg-[#17171A]'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        {inner}
      </Link>
    );
  };

  const NavContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#7C3AED]">
          <span className="text-sm font-bold text-white">B</span>
        </div>
        {!collapsed && (
          <span className="text-base font-semibold tracking-tight text-[#F4F4F5]">Business OS</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="space-y-0.5">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#52525B]">
                {group.heading}
              </p>
            )}
            {collapsed && <div className="mx-3 mb-1.5 border-t border-[#1F1F23]" />}
            {group.items.map(renderItem)}
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="space-y-1 border-t border-[#1F1F23] px-3 py-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-[#52525B] transition-colors hover:bg-[#17171A] hover:text-[#A1A1AA] lg:flex ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 flex-shrink-0" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 flex-shrink-0" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>

        {!collapsed && (
          <div className="rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2.5">
            <p className="truncate text-sm font-medium text-[#F4F4F5]">
              {client?.name || 'Your Business'}
            </p>
            <span
              className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeStyle}`}
            >
              {planTier}
            </span>
          </div>
        )}

        <button
          onClick={handleSignOut}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[#A1A1AA] transition-colors hover:bg-[#17171A] hover:text-[#EF4444] ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Sign out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 rounded-lg border border-[#1F1F23] bg-[#111113] p-2 text-[#A1A1AA] transition-colors hover:text-[#F4F4F5] lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer — full labels once opened */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-[#1F1F23] bg-[#111113] transition-transform duration-200 ease-in-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute right-3 top-4 rounded-lg p-1.5 text-[#A1A1AA] transition-colors hover:bg-[#17171A] hover:text-[#F4F4F5]"
        >
          <X className="h-4 w-4" />
        </button>
        {NavContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-shrink-0 flex-col border-r border-[#1F1F23] bg-[#111113] transition-all duration-200 ease-in-out lg:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {NavContent}
      </aside>
    </>
  );
}
