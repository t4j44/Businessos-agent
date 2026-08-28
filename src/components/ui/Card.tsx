import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

// Flat card: 1px border, 8px radius, no shadow.
export default function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  }

  return (
    <div className={`
      rounded-lg border border-[#1F1F23] bg-[#111113]
      ${paddings[padding]}
      ${hover ? 'hover:border-[#2A2A30] transition-colors duration-200 cursor-pointer' : ''}
      ${className}
    `}>
      {children}
    </div>
  )
}
