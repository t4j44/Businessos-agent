import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

export default function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  }

  return (
    <div className={`
      bg-slate-800 border border-slate-700 rounded-xl
      ${paddings[padding]}
      ${hover ? 'hover:border-slate-600 transition-colors duration-200 cursor-pointer' : ''}
      ${className}
    `}>
      {children}
    </div>
  )
}
