import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUpDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

export interface SearchableSelectOption {
  value: string
  label: string
  hint?: string
}

/** Type-to-filter dropdown for picking a single value out of a (usually
 * small) fixed option list — used for the project/cluster/status filters
 * across Live Jobs, History, and Schedules, so users can type instead of
 * scrolling a plain <select>. Not a free-text field: the value is always
 * one of `options`, or "" (the "all" placeholder).
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'All',
  className,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[] | string[]
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const normalized: SearchableSelectOption[] = useMemo(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options]
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = normalized.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return normalized
    return normalized.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [normalized, query])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const displayValue = open ? query : selected?.label || ''

  return (
    <div className={clsx('relative', className)} ref={containerRef}>
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setQuery('') }}
          placeholder={selected ? selected.label : placeholder}
          className={clsx(
            'w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-sm shadow-sm',
            'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
            disabled && 'cursor-not-allowed bg-gray-50 text-gray-400',
            selected && !open && 'font-medium text-gray-900'
          )}
          autoComplete="off"
        />
        {value && !open ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); setQuery(''); inputRef.current?.blur() }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            title="Clear"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        ) : (
          <ChevronUpDownIcon className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full min-w-[10rem] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
            className={clsx(
              'block w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50',
              !value ? 'font-medium text-indigo-600' : 'text-gray-500'
            )}
          >
            {placeholder}
          </button>
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(o.value); setQuery(''); setOpen(false) }}
              className={clsx(
                'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-indigo-50',
                o.value === value ? 'font-medium text-indigo-600' : 'text-gray-700'
              )}
            >
              {o.label}
              {o.hint && <span className="ml-1.5 text-xs text-gray-400">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
