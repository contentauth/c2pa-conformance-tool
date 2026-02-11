/**
 * Debug utility for conditional logging
 * Set DEBUG=true in environment or localStorage to enable debug logs
 */

const isDebugEnabled = (): boolean => {
  // Check if we're in development mode
  if (import.meta.env.DEV) {
    return true
  }

  // Allow enabling debug in production via localStorage
  try {
    return localStorage.getItem('DEBUG') === 'true'
  } catch {
    return false
  }
}

const DEBUG = isDebugEnabled()

export const debug = {
  log: (...args: any[]) => {
    if (DEBUG) console.log(...args)
  },

  error: (...args: any[]) => {
    // Always show errors
    console.error(...args)
  },

  warn: (...args: any[]) => {
    if (DEBUG) console.warn(...args)
  },

  info: (...args: any[]) => {
    if (DEBUG) console.info(...args)
  }
}
