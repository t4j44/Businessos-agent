'use client';

import { Bell } from 'lucide-react';

interface HeaderProps {
  title: string;
  userInitials?: string;
}

// Thin chrome bar. The section name sits here as a breadcrumb at 14px — the
// 32px page title belongs to the page itself, via <PageHeader />.
export function Header({ title, userInitials = 'U' }: HeaderProps) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-[#1F1F23] bg-[#0A0A0B] px-6">
      <span className="truncate pl-12 text-sm font-medium text-[#71717A] lg:pl-0">
        {title}
      </span>

      <div className="flex items-center gap-2">
        {/* AI team active status */}
        <div className="flex items-center gap-2 rounded-full border border-[#10B981]/20 bg-[#10B981]/10 px-2.5 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#10B981]" />
          </span>
          <span className="hidden text-xs font-medium text-[#10B981] sm:block">
            AI team active
          </span>
        </div>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-[#71717A] transition-colors hover:bg-[#17171A] hover:text-[#F4F4F5]">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#7C3AED] ring-2 ring-[#0A0A0B]" />
        </button>

        {/* User avatar */}
        <div className="flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-full border border-[#1F1F23] bg-[#17171A] text-xs font-semibold text-[#A1A1AA] transition-colors hover:text-[#F4F4F5]">
          {userInitials}
        </div>
      </div>
    </header>
  );
}
