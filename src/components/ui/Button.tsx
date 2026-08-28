'use client'
import React from 'react'

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
  // No drop shadows: the system is flat.
  const base =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-[#7C3AED] hover:bg-[#6D28D9] text-white',
    // The single place a gradient is allowed: the accent CTA.
    cta: 'btn-accent-gradient text-white hover:opacity-90',
    secondary:
      'bg-transparent border border-[#1F1F23] text-[#A1A1AA] hover:border-[#2A2A30] hover:text-[#F4F4F5]',
    outline:
      'bg-transparent border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/10',
    danger: 'bg-[#EF4444] hover:bg-[#DC2626] text-white',
    ghost: 'text-[#71717A] hover:text-[#F4F4F5] hover:bg-[#17171A]',
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
      {loading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
