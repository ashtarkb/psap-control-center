import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clusters from './pages/Clusters'
import ClusterDetail from './pages/ClusterDetail'
import Reservations from './pages/Reservations'
import Calendar from './pages/Calendar'
import Testing from './pages/Testing'
import Results from './pages/Results'
import LoginPage from './pages/LoginPage'
import { isAuthenticated } from './stores/authStore'

function NotFound() {
  return (
    <div className="text-center py-12">
      <h1 className="text-4xl font-bold text-gray-900">404</h1>
      <p className="mt-2 text-lg text-gray-600">Page not found</p>
      <Link to="/dashboard" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
        Go to Dashboard
      </Link>
    </div>
  )
}

function App() {
  const [authed, setAuthed] = useState(isAuthenticated())
  const syncAuth = useCallback(() => setAuthed(isAuthenticated()), [])

  useEffect(() => {
    window.addEventListener('auth-change', syncAuth)
    return () => window.removeEventListener('auth-change', syncAuth)
  }, [syncAuth])

  if (!authed) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="clusters" element={<Clusters />} />
        <Route path="clusters/:id" element={<ClusterDetail />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="testing" element={<Testing />} />
        <Route path="results" element={<Results />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
