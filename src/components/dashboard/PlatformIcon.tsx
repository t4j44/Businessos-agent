import type { ReactElement } from 'react'
import { Globe } from 'lucide-react'

// lucide dropped its brand glyphs, so the three platforms the creative agent
// writes for are drawn inline. They inherit currentColor like a lucide icon,
// so they can be coloured by the surrounding class.

type IconProps = { className?: string }

function Instagram({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Facebook({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
    </svg>
  )
}

function LinkedIn({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm1.78 13.02H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  )
}

const ICONS: Record<string, (p: IconProps) => ReactElement> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: LinkedIn,
}

// Per-platform tint, kept low-opacity so a row of them stays calm.
export const PLATFORM_TINT: Record<string, string> = {
  instagram: 'bg-[#EC4899]/10 text-[#EC4899] border-[#EC4899]/20',
  facebook: 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20',
  linkedin: 'bg-[#0EA5E9]/10 text-[#0EA5E9] border-[#0EA5E9]/20',
}
export const DEFAULT_TINT = 'bg-[#52525B]/10 text-[#A1A1AA] border-[#2A2A30]'

export function platformTint(platform: string) {
  return PLATFORM_TINT[String(platform).toLowerCase()] ?? DEFAULT_TINT
}

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = ICONS[String(platform).toLowerCase()]
  if (!Icon) return <Globe className={className ?? 'h-4 w-4'} aria-hidden />
  return <Icon className={className ?? 'h-4 w-4'} />
}

// Display name for a platform key, since rows arrive lowercased from the agent.
export function platformLabel(platform: string) {
  const key = String(platform).toLowerCase()
  if (key === 'linkedin') return 'LinkedIn'
  if (!key) return 'Unknown'
  return key.charAt(0).toUpperCase() + key.slice(1)
}
