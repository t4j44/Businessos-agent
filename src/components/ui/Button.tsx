'use client'
import React from 'react'
import { Pending } from '@/components/ui/Skeleton'

interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'cta' | 'secondary' | 'outline' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  className?: string
  fullWidth?: boolean
}

export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  type = 'button',
  className = '',
  fullWidth = false,
}: ButtonProps) {
  // House motion: 150ms ease on all interactive properties. Hover brightness
  // and the accent glow live in globals.css so every button matches.
  const base =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 ease-[cubic-bezier(.2,.8,.2,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-accent hover:bg-accent-hover text-white',
    // The single place a gradient is allowed: the accent CTA.
    cta: 'btn-accent-gradient text-white hover:opacity-90',
    secondary:
      'bg-transparent border border-line text-muted hover:border-line-strong hover:text-text',
    outline:
      'bg-transparent border border-accent/40 text-accent hover:bg-accent/10',
    danger: 'bg-crit hover:bg-crit text-white',
    ghost: 'text-dim hover:text-text hover:bg-raised',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-sm gap-2',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading && <Pending />}
      {children}
    </button>
  )
}
