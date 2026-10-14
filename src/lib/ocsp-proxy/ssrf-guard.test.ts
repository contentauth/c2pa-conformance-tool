import { describe, it, expect, vi, afterEach } from 'vitest'
import { isForbiddenIp, resolveSafeIp, validateResponderUrl, SsrfBlockedError } from './ssrf-guard'

describe('isForbiddenIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['172.31.255.255', 'RFC1918 172.16/12 upper bound'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['169.254.169.254', 'link-local — cloud metadata endpoint'],
    ['169.254.0.1', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', '"this network"'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast/reserved'],
  ])('rejects %s (%s)', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true)
  })

  it.each([
    ['8.8.8.8', 'public (Google DNS)'],
    ['1.1.1.1', 'public (Cloudflare DNS)'],
    ['172.15.255.255', 'just below the RFC1918 172.16/12 range'],
    ['172.32.0.0', 'just above the RFC1918 172.16/12 range'],
  ])('allows %s (%s)', (ip) => {
    expect(isForbiddenIp(ip)).toBe(false)
  })

  it.each([
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique-local (fc00::/7)'],
    ['fd12:3456:789a::1', 'IPv6 unique-local (fd00::/8)'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 cloud metadata'],
    ['2001:db8::1', 'IPv6 documentation range'],
  ])('rejects %s (%s)', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true)
  })

  it('allows a public IPv6 address (Cloudflare DNS)', () => {
    expect(isForbiddenIp('2606:4700:4700::1111')).toBe(false)
  })

  it('rejects malformed input (fail closed)', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true)
    expect(isForbiddenIp('999.999.999.999')).toBe(true)
  })
})

describe('resolveSafeIp', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a literal forbidden IP without doing any DNS lookup', async () => {
    const dns = await import('node:dns/promises')
    const lookupSpy = vi.spyOn(dns.default, 'lookup')
    await expect(resolveSafeIp('169.254.169.254')).rejects.toThrow(SsrfBlockedError)
    expect(lookupSpy).not.toHaveBeenCalled()
  })

  it('returns a literal public IP as-is', async () => {
    await expect(resolveSafeIp('8.8.8.8')).resolves.toBe('8.8.8.8')
  })

  it('rejects a hostname that resolves only to a forbidden address', async () => {
    const dns = await import('node:dns/promises')
    vi.spyOn(dns.default, 'lookup').mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as never)
    await expect(resolveSafeIp('metadata.internal.example')).rejects.toThrow(SsrfBlockedError)
  })

  it('returns a safe address for a hostname resolving to a public IP', async () => {
    const dns = await import('node:dns/promises')
    vi.spyOn(dns.default, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    await expect(resolveSafeIp('ocsp.example.com')).resolves.toBe('93.184.216.34')
  })

  it('rejects a hostname that fails to resolve', async () => {
    const dns = await import('node:dns/promises')
    vi.spyOn(dns.default, 'lookup').mockRejectedValue(new Error('ENOTFOUND'))
    await expect(resolveSafeIp('does-not-resolve.example')).rejects.toThrow(SsrfBlockedError)
  })
})

describe('validateResponderUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a malformed URL', async () => {
    await expect(validateResponderUrl('not a url')).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects non-http(s) schemes', async () => {
    await expect(validateResponderUrl('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError)
    await expect(validateResponderUrl('ftp://example.com/x')).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects a URL whose host is a forbidden literal', async () => {
    await expect(validateResponderUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('resolves a valid https URL to its safe address', async () => {
    const dns = await import('node:dns/promises')
    vi.spyOn(dns.default, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    const { url, resolvedIp } = await validateResponderUrl('https://ocsp.example.com/some/path')
    expect(url.hostname).toBe('ocsp.example.com')
    expect(resolvedIp).toBe('93.184.216.34')
  })
})
