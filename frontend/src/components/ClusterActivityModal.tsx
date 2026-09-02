import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import SchedulingCalendar from './SchedulingCalendar'

/** Read-only "what's happening on this cluster" popup — shown on the Submit
 * page when the selected cluster has something running or coming up soon
 * (see hasUpcomingClusterActivity in Testing.tsx), so a user can sanity-check
 * the cluster's schedule before submitting without cluttering the form with
 * an always-on inline calendar. */
export default function ClusterActivityModal({
  open,
  onClose,
  cluster,
}: {
  open: boolean
  onClose: () => void
  cluster: string
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
                  <div>
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Heads up — <span className="font-mono">{cluster}</span> has activity coming up
                    </Dialog.Title>
                    <p className="mt-0.5 text-xs text-gray-500">Times shown in your local timezone.</p>
                  </div>
                  <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <XMarkIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                <div className="mt-4 max-h-[75vh] overflow-y-auto space-y-4 pr-1">
                  <SchedulingCalendar cluster={cluster} variant="submit" onApply={() => {}} readOnly initialView="day" />
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                  >
                    Got it, continue
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
