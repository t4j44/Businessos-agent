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
        <label className="text-sm font-medium text-[#A1A1AA]">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]">
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
            w-full bg-[#111113] border rounded-lg px-4 py-2.5 text-sm text-white
            placeholder:text-[#71717A]
            focus:outline-none focus:ring-2 focus:ring-[#7C3AED] focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
            ${icon ? 'pl-10' : ''}
            ${error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-[#1F1F23] hover:border-[#2A2A30]'
            }
          `}
        />
      </div>
      {hint && !error && (
        <p className="text-xs text-[#71717A]">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  )
}
