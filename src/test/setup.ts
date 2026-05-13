import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/svelte'
import '@testing-library/jest-dom'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock fetch for tests
global.fetch = vi.fn() as any

// Mock ResizeObserver (used by Svelte bind:clientWidth, not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
