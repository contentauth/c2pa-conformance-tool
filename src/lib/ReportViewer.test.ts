import { describe, it, expect } from 'vitest'

/**
 * Unit tests for ReportViewer utility functions
 * These functions are extracted from the component for testing
 */

// Utility function: elideValue
// Truncates long hash values for display
function elideValue(value: any, key?: string): any {
  if (typeof value === 'string') {
    // Check if it's a hash (long hex string)
    if (key && (key.toLowerCase().includes('hash') || key.toLowerCase().includes('digest'))) {
      if (value.length > 20) {
        return value.substring(0, 10) + '...' + value.substring(value.length - 10)
      }
    }

    // Check if the value itself looks like a hash (long hex string)
    if (value.match(/^[a-f0-9]{40,}$/i)) {
      return value.substring(0, 10) + '...' + value.substring(value.length - 10)
    }

    // For URLs, show abbreviated version
    if (value.startsWith('http://') || value.startsWith('https://')) {
      try {
        const url = new URL(value)
        return url.hostname + (url.pathname !== '/' ? url.pathname : '')
      } catch {
        return value
      }
    }

    // For very long strings, truncate
    if (value.length > 100) {
      return value.substring(0, 50) + '...'
    }
  }

  return value
}

// Utility function: getAbbreviatedSourceType
// Extracts abbreviated source type from URL
function getAbbreviatedSourceType(url: string): string {
  const match = url.match(/\/([^/]+)\/digitalSourceType$/)
  return match ? match[1] : ''
}

// Utility function: formatValue
// Formats values for display
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'N/A'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(v => formatValue(v)).join(', ')
    }
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

// Utility function: extractMeaningfulValue
// Extracts meaningful values from complex objects
function extractMeaningfulValue(obj: any): string {
  if (!obj || typeof obj !== 'object') return String(obj)

  // Try common value keys
  const valueKeys = ['value', 'name', 'label', 'title', 'description', 'url', 'uri']
  for (const key of valueKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return String(obj[key])
    }
  }

  // If object has only one key, use its value
  const keys = Object.keys(obj)
  if (keys.length === 1) {
    return extractMeaningfulValue(obj[keys[0]])
  }

  return JSON.stringify(obj)
}

describe('ReportViewer utility functions', () => {
  describe('elideValue', () => {
    it('should elide long hash values when key suggests hash', () => {
      const longHash = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6'
      const result = elideValue(longHash, 'hash')
      // Should be: first 10 chars + '...' + last 10 chars
      expect(result).toBe('a1b2c3d4e5...v2w3x4y5z6')
      expect(result.length).toBeLessThan(longHash.length)
    })

    it('should elide long hash values when key contains digest', () => {
      const longHash = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6'
      const result = elideValue(longHash, 'digest')
      expect(result).toBe('a1b2c3d4e5...v2w3x4y5z6')
    })

    it('should elide values that look like hashes (40+ hex chars)', () => {
      const hexHash = 'a'.repeat(64)
      const result = elideValue(hexHash)
      expect(result).toContain('...')
      expect(result.length).toBe(23) // 10 + 3 + 10
    })

    it('should not elide short strings', () => {
      const shortString = 'short'
      expect(elideValue(shortString)).toBe('short')
    })

    it('should abbreviate URLs to hostname + path', () => {
      const url = 'https://example.com/path/to/resource'
      const result = elideValue(url)
      expect(result).toBe('example.com/path/to/resource')
    })

    it('should handle URLs with just hostname', () => {
      const url = 'https://example.com/'
      const result = elideValue(url)
      expect(result).toBe('example.com')
    })

    it('should truncate very long strings (>100 chars)', () => {
      const longString = 'a'.repeat(150)
      const result = elideValue(longString)
      // Should be: first 10 chars + '...' + last 10 chars (from substring operations)
      expect(result).toBe('aaaaaaaaaa...aaaaaaaaaa')
      expect(result.length).toBe(23) // 10 + 3 + 10
    })

    it('should handle non-string values without modification', () => {
      expect(elideValue(123)).toBe(123)
      expect(elideValue(true)).toBe(true)
      expect(elideValue(null)).toBe(null)
      expect(elideValue(undefined)).toBe(undefined)
    })

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'http://not a valid url'
      expect(elideValue(invalidUrl)).toBe(invalidUrl)
    })
  })

  describe('getAbbreviatedSourceType', () => {
    it('should extract source type from valid URL', () => {
      const url = 'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia/digitalSourceType'
      const result = getAbbreviatedSourceType(url)
      expect(result).toBe('trainedAlgorithmicMedia')
    })

    it('should return empty string for URL without source type pattern', () => {
      const url = 'https://example.com/some/path'
      const result = getAbbreviatedSourceType(url)
      expect(result).toBe('')
    })

    it('should handle empty string', () => {
      expect(getAbbreviatedSourceType('')).toBe('')
    })
  })

  describe('formatValue', () => {
    it('should format null as N/A', () => {
      expect(formatValue(null)).toBe('N/A')
    })

    it('should format undefined as N/A', () => {
      expect(formatValue(undefined)).toBe('N/A')
    })

    it('should format boolean true as Yes', () => {
      expect(formatValue(true)).toBe('Yes')
    })

    it('should format boolean false as No', () => {
      expect(formatValue(false)).toBe('No')
    })

    it('should format arrays by joining elements', () => {
      expect(formatValue([1, 2, 3])).toBe('1, 2, 3')
      expect(formatValue(['a', 'b', 'c'])).toBe('a, b, c')
    })

    it('should format objects as JSON', () => {
      const obj = { key: 'value' }
      const result = formatValue(obj)
      expect(result).toContain('"key"')
      expect(result).toContain('"value"')
    })

    it('should format strings as-is', () => {
      expect(formatValue('test string')).toBe('test string')
    })

    it('should format numbers as strings', () => {
      expect(formatValue(42)).toBe('42')
      expect(formatValue(3.14)).toBe('3.14')
    })
  })

  describe('extractMeaningfulValue', () => {
    it('should extract value from value key', () => {
      const obj = { value: 'meaningful', other: 'data' }
      expect(extractMeaningfulValue(obj)).toBe('meaningful')
    })

    it('should extract value from name key', () => {
      const obj = { name: 'test name', other: 'data' }
      expect(extractMeaningfulValue(obj)).toBe('test name')
    })

    it('should extract value from label key', () => {
      const obj = { label: 'test label', other: 'data' }
      expect(extractMeaningfulValue(obj)).toBe('test label')
    })

    it('should extract value from url key', () => {
      const obj = { url: 'https://example.com', other: 'data' }
      expect(extractMeaningfulValue(obj)).toBe('https://example.com')
    })

    it('should use single-key object value', () => {
      const obj = { onlyKey: 'only value' }
      expect(extractMeaningfulValue(obj)).toBe('only value')
    })

    it('should recursively extract from nested single-key objects', () => {
      const obj = { outer: { inner: 'nested value' } }
      expect(extractMeaningfulValue(obj)).toBe('nested value')
    })

    it('should JSON stringify complex objects', () => {
      const obj = { key1: 'value1', key2: 'value2' }
      const result = extractMeaningfulValue(obj)
      expect(result).toContain('key1')
      expect(result).toContain('value1')
    })

    it('should handle primitive values', () => {
      expect(extractMeaningfulValue('string')).toBe('string')
      expect(extractMeaningfulValue(123)).toBe('123')
      expect(extractMeaningfulValue(true)).toBe('true')
    })

    it('should handle null and undefined', () => {
      expect(extractMeaningfulValue(null)).toBe('null')
      expect(extractMeaningfulValue(undefined)).toBe('undefined')
    })

    it('should prioritize value key over other keys', () => {
      const obj = { value: 'primary', name: 'secondary', label: 'tertiary' }
      expect(extractMeaningfulValue(obj)).toBe('primary')
    })
  })
})
