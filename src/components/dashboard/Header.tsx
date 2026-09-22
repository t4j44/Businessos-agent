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
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-line bg-canvas px-6">
      <span className="truncate pl-12 text-sm font-medium text-dim lg:pl-0">
        {title}
      </span>

      <div className="flex items-center gap-2">
        {/* AI team active status */}
        <div className="flex items-center gap-2 rounded-full border border-good/20 bg-good/10 px-2.5 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
          </span>
          <span className="hidden text-xs font-medium text-good sm:block">
            AI team active
          </span>
        </div>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-dim transition-colors hover:bg-raised hover:text-text">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-canvas" />
        </button>

        {/* User avatar */}
        <div className="flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-full border border-line bg-raised text-xs font-semibold text-muted transition-colors hover:text-text">
          {userInitials}
        </div>
      </div>
    </header>
  );
}
