import { useEffect, useMemo, useRef, useState } from 'react'
import { useClusters } from '../hooks/useClusters'
import type { Cluster } from '../types'

// Searchable dropdown for picking a cluster registered in the Control
// Center's own Clusters page (GET /clusters) — separate from anything
// Forge-side. Still a free-text field underneath (you can submit against a
// cluster name that isn't registered yet), but as you type it filters and
// shows matching registered clusters to pick from — same look and
// interaction as the "Pull Request" search box next to it.

export default function ClusterCombobox({
  value,
  onChange,
  required = false,
  inputClassName = 'input mt-1',
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
  /** Match whatever input styling the surrounding form uses. */
  inputClassName?: string
}) {
  const { data: clustersData } = useClusters()
  const clusters = useMemo(() => clustersData?.clusters || [], [clustersData])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return clusters
    return clusters.filter((c: Cluster) => c.name.toLowerCase().includes(q))
  }, [clusters, value])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        className={inputClassName}
        placeholder="Search or type a cluster name..."
        autoComplete="off"
        required={required}
      />
      {open && clusters.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md bg-white shadow-lg border border-gray-200">
          {filtered.length === 0 ? (
            <div className="w-full text-left px-3 py-2 text-sm text-gray-500 border-b border-gray-100">
              No registered cluster matches "{value}" — you can still submit against this name.
            </div>
          ) : (
            filtered.map((c: Cluster) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.name)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 border-b border-gray-50"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                {(c.provider || c.gpu_type) && (
                  <span className="text-gray-400 ml-1">
                    ({[c.provider, c.gpu_type].filter(Boolean).join(' · ')})
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
