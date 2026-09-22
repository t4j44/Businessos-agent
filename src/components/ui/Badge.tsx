import React from 'react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'green' | 'blue' | 'red' | 'amber' | 'gray' | 'purple'
  size?: 'sm' | 'md'
  dot?: boolean
}

// Low-opacity fill + hairline border, matching the agent status pills.
export default function Badge({
  children,
  variant = 'gray',
  size = 'sm',
  dot = false,
}: BadgeProps) {
  const variants = {
    green:  'bg-good/10 text-good border-good/20',
    blue:   'bg-accent/10 text-accent border-accent/20',
    red:    'bg-crit/10 text-crit border-crit/20',
    amber:  'bg-warn/10 text-warn border-warn/20',
    gray:   'bg-faint/10 text-muted border-line-strong',
    purple: 'bg-accent/10 text-accent border-accent/20',
  }

  const dotColors = {
    green: 'bg-good',
    blue: 'bg-accent',
    red: 'bg-crit',
    amber: 'bg-warn',
    gray: 'bg-dim',
    purple: 'bg-accent',
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  }

  return (
    <span className={`
      inline-flex items-center gap-1.5 font-medium rounded-full border
      ${variants[variant]} ${sizes[size]}
    `}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  )
}
