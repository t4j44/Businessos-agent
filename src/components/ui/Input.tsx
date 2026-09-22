'use client'
import React from 'react'

interface InputProps {
  label?: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  error?: string
  disabled?: boolean
  className?: string
  required?: boolean
  hint?: string
  icon?: React.ReactNode
}

export default function Input({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  error,
  disabled = false,
  className = '',
  required = false,
  hint,
  icon,
}: InputProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="label-caps">
          {label}
          {required && <span className="text-crit ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`
            w-full bg-surface border rounded-lg px-4 py-2.5 text-sm text-text
            placeholder:text-dim
            focus:outline-none
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-150 ease-[cubic-bezier(.2,.8,.2,1)]
            ${icon ? 'pl-10' : ''}
            ${error
              ? 'border-crit'
              : 'border-line hover:border-line-strong'
            }
          `}
        />
      </div>
      {hint && !error && (
        <p className="text-xs text-dim">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-crit flex items-center gap-1">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  )
}
