import { createLogger } from '../utils/logger'

const logger = createLogger('AuthStore')

export type UserRole = 'admin' | 'user'

export interface AuthSession {
  username: string
  role: UserRole
}

let session: AuthSession | null = null

export function getSession(): AuthSession | null {
  return session
}

export function isAuthenticated(): boolean {
  return session !== null
}

export function isAdmin(): boolean {
  return session?.role === 'admin'
}

export function getUsername(): string | null {
  return session?.username ?? null
}

export function getRole(): UserRole | null {
  return session?.role ?? null
}

export function setSession(user: AuthSession): void {
  session = user
  logger.info('User authenticated:', user.username, `(${user.role})`)
  window.dispatchEvent(new Event('auth-change'))
}

export function clearSession(): void {
  session = null
  logger.info('User logged out')
  window.dispatchEvent(new Event('auth-change'))
}
