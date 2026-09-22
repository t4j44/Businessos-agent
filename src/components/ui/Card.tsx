import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  /**
   * `primary` keeps the elevated product card (border + light-catch).
   * `flat` is a supporting block — plain surface, no border, no elevation.
   */
  elevated?: boolean
}

export default function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
  elevated = true,
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  }

  const shell = elevated
    ? 'rounded-lg border border-line bg-surface shadow-lightcatch'
    : 'rounded-lg bg-surface/60'

  return (
    <div className={`
      ${shell}
      ${paddings[padding]}
      ${hover ? 'card-lift cursor-pointer hover:border-line-strong' : ''}
      ${className}
    `}>
      {children}
    </div>
  )
}
