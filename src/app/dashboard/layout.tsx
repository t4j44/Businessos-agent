'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { Header } from '../../components/dashboard/Header';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Home',
  '/dashboard/my-business': 'My Business',
  '/dashboard/calls': 'Calls',
  '/dashboard/reviews': 'Reviews',
  '/dashboard/invoices': 'Invoices',
  '/dashboard/leads': 'Outreach',
  '/dashboard/content': 'Content',
  '/dashboard/brief': 'Weekly Brief',
  '/dashboard/enrichment': 'Enrichment',
  '/dashboard/billing': 'Billing',
  '/dashboard/settings': 'Settings',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'Dashboard';

  return (
    <div className="flex h-screen bg-[#09090B] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
