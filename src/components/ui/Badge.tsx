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
    green:  'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20',
    blue:   'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20',
    red:    'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20',
    amber:  'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20',
    gray:   'bg-[#52525B]/10 text-[#A1A1AA] border-[#2A2A30]',
    purple: 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20',
  }

  const dotColors = {
    green: 'bg-[#10B981]',
    blue: 'bg-[#7C3AED]',
    red: 'bg-[#EF4444]',
    amber: 'bg-[#F59E0B]',
    gray: 'bg-[#71717A]',
    purple: 'bg-[#7C3AED]',
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
