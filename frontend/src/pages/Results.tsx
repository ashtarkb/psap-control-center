import { ChartBarIcon, ArrowTopRightOnSquareIcon, TableCellsIcon } from '@heroicons/react/24/outline'

export default function Results() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 font-display">Results & Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          View test results and access MLFlow experiments
        </p>
      </div>

      <div className="card p-12 text-center">
        <div className="mx-auto h-20 w-20 rounded-2xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center">
          <ChartBarIcon className="h-10 w-10 text-green-600" />
        </div>
        <h3 className="mt-6 text-xl font-semibold text-gray-900">Coming Soon</h3>
        <p className="mt-2 text-gray-500 max-w-md mx-auto">
          The results dashboard is under development. This feature will provide access to test
          results and link to your self-hosted MLFlow instance for detailed experiment tracking.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3 max-w-2xl mx-auto">
          <div className="p-4 rounded-xl bg-gray-50">
            <ChartBarIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">Performance Dashboard</h4>
            <p className="mt-1 text-sm text-gray-500">
              Visualize benchmark results
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-50">
            <ArrowTopRightOnSquareIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">MLFlow Integration</h4>
            <p className="mt-1 text-sm text-gray-500">
              Direct links to experiments
            </p>
          </div>
          <div className="p-4 rounded-xl bg-gray-50">
            <TableCellsIcon className="h-8 w-8 text-gray-400 mx-auto" />
            <h4 className="mt-2 font-medium text-gray-900">Comparison Tables</h4>
            <p className="mt-1 text-sm text-gray-500">
              Compare across runs
            </p>
          </div>
        </div>

        <div className="mt-8 p-4 rounded-xl bg-green-50 text-left max-w-lg mx-auto">
          <h4 className="font-medium text-green-900">Planned Features:</h4>
          <ul className="mt-2 text-sm text-green-700 space-y-1">
            <li>• Direct integration with self-hosted MLFlow</li>
            <li>• Performance regression tracking</li>
            <li>• Historical trend analysis</li>
            <li>• Export results to CSV/JSON</li>
            <li>• Automated report generation</li>
          </ul>
        </div>

        <div className="mt-8 p-4 rounded-xl bg-gray-100 max-w-lg mx-auto">
          <p className="text-sm text-gray-600">
            <strong>Note:</strong> Configure your MLFlow server URL in the environment
            variables to enable direct linking once this feature is available.
          </p>
          <code className="mt-2 block text-xs bg-gray-200 p-2 rounded font-mono">
            MLFLOW_BASE_URL=https://your-mlflow-server.example.com
          </code>
        </div>
      </div>
    </div>
  )
}
