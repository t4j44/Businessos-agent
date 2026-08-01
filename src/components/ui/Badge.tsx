import React from 'react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'green' | 'blue' | 'red' | 'amber' | 'gray' | 'purple'
  size?: 'sm' | 'md'
  dot?: boolean
}

export default function Badge({
  children,
  variant = 'gray',
  size = 'sm',
  dot = false,
}: BadgeProps) {
  const variants = {
    green: 'bg-green-900/50 text-green-400 border-green-800',
    blue: 'bg-blue-900/50 text-blue-400 border-blue-800',
    red: 'bg-red-900/50 text-red-400 border-red-800',
    amber: 'bg-amber-900/50 text-amber-400 border-amber-800',
    gray: 'bg-slate-700 text-slate-300 border-slate-600',
    purple: 'bg-purple-900/50 text-purple-400 border-purple-800',
  }

  const dotColors = {
    green: 'bg-green-400',
    blue: 'bg-blue-400',
    red: 'bg-red-400',
    amber: 'bg-amber-400',
    gray: 'bg-slate-400',
    purple: 'bg-purple-400',
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
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
