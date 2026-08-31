import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import SchedulingCalendar from './SchedulingCalendar'
import type { JobScheduling } from '../types'

// ─── Modal shell ──────────────────────────────────────────────────────────
//
// Everything about "what's currently on this cluster" (current jobs,
// recurring schedules, locks) is now surfaced directly on the calendar
// itself (month-view dots, day-view slot badges) rather than a separate
// text list above it — see SchedulingCalendar.tsx.

export default function ClusterScheduleModal({
  open,
  onClose,
  cluster,
  onApply,
}: {
  open: boolean
  onClose: () => void
  cluster: string
  onApply: (choice: JobScheduling) => void
}) {
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all">
                <div className="flex items-center justify-between mb-1">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    Schedule This Job — <span className="font-mono">{cluster || 'no cluster selected'}</span>
                  </Dialog.Title>
                  <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <XMarkIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                {!cluster ? (
                  <p className="py-8 text-center text-sm text-gray-400">Pick a cluster above first.</p>
                ) : (
                  <div className="mt-4 max-h-[75vh] overflow-y-auto space-y-4 pr-1">
                    <SchedulingCalendar cluster={cluster} onApply={(choice) => { onApply(choice); onClose() }} />
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
