import { BeakerIcon, RocketLaunchIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'

export default function Testing() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 font-display">Automated Testing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure and run automated performance tests on your clusters
        </p>
      </div>

      <div className="card p-12 text-center">
        <div className="mx-auto h-20 w-20 rounded-2xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
          <BeakerIcon className="h-10 w-10 text-purple-600" />
        </div>
        <h3 className="mt-6 text-xl font-semibold text-gray-900">Coming Soon</h3>
        <p className="mt-2 text-gray-500 max-w-md mx-auto">
          The automated testing interface is under development. This feature will allow you to
          configure, schedule, and run performance benchmarks across your clusters.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3 max-w-2xl mx-auto">
          <div className="p-4 rounded-xl bg-gray-50">
            <RocketLaunchIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">Quick Start Tests</h4>
            <p className="mt-1 text-sm text-gray-500">
              Launch pre-configured benchmark suites
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-50">
            <Cog6ToothIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">Custom Pipelines</h4>
            <p className="mt-1 text-sm text-gray-500">
              Build custom test workflows
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-50">
            <BeakerIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">MLPerf Integration</h4>
            <p className="mt-1 text-sm text-gray-500">
              Run standard ML benchmarks
            </p>
          </div>
        </div>

        <div className="mt-8 p-4 rounded-xl bg-blue-50 text-left max-w-lg mx-auto">
          <h4 className="font-medium text-blue-900">Planned Features:</h4>
          <ul className="mt-2 text-sm text-blue-700 space-y-1">
            <li>• Integration with TOPSAIL testing framework</li>
            <li>• vLLM inference benchmarking</li>
            <li>• GPU utilization monitoring</li>
            <li>• Automated regression detection</li>
            <li>• Test scheduling and queue management</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
