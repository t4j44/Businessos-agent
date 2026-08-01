'use client';

import { Bell } from 'lucide-react';

interface HeaderProps {
  title: string;
  userInitials?: string;
}

export function Header({ title, userInitials = 'U' }: HeaderProps) {
  return (
    <header className="h-16 flex items-center justify-between px-6 bg-[#0F172A] border-b border-slate-700/50 flex-shrink-0">
      <h1 className="text-white text-xl font-semibold">{title}</h1>

      <div className="flex items-center gap-3">
        {/* AI team active status */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-emerald-400 text-xs font-medium hidden sm:block">
            Your AI team is active
          </span>
        </div>

        {/* Notification bell */}
        <button className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#2563EB] ring-2 ring-[#0F172A]" />
        </button>

        {/* User avatar */}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2563EB] to-violet-600 flex items-center justify-center text-white text-sm font-semibold cursor-pointer select-none shadow-lg shadow-blue-500/20">
          {userInitials}
        </div>
      </div>
    </header>
  );
}
