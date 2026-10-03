import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  processFile, getVersion, isSidecarFile, resolveMimeType, SIDECAR_MIME,
  processRemoteManifest, revalidateRemoteManifest,
  _setLocalModuleForTesting, _fetchSoftBindingAlgorithmsForTesting, _resetSoftBindingCacheForTesting,
} from './c2pa'
import { ASSET_ACCEPT, TEXT_ACCEPT, isMidiFile, isMidiMimeType, isTextFile } from './fileTypes'
import type { ConformanceReport } from './types'

// ── Shared crJSON factory ─────────────────────────────────────────────────────

function makeCrJson(opts: {
  trusted?: boolean
  untrusted?: boolean
  itlTrusted?: boolean
} = {}): string {
  const success = []
  const failure = []
  if (opts.trusted) success.push({ code: 'signingCredential.trusted' })
  if (opts.untrusted) failure.push({ code: 'signingCredential.untrusted', explanation: 'untrusted' })
  if (opts.itlTrusted) success.push({ code: 'signingCredential.trusted' })
  success.push({ code: 'timeStamp.validated' }, { code: 'claimSignature.validated' })

  return JSON.stringify({
    manifests: [{
      label: 'urn:c2pa:test',
      'claim.v2': { 'dc:format': 'image/jpeg' },
      validationResults: { success, failure, informational: [] }
    }],
    activeManifest: 'urn:c2pa:test',
    validationResults: {
      activeManifest: { success, failure, informational: [] }
    }
  })
}

// ── Mock local WASM module ────────────────────────────────────────────────────

let readCallCount = 0

// Track trust settings per call so ITL tests can inspect them.
const recordedTrustAnchors: string[] = []
const recordedTrustConfigs: string[] = []

function makeLocalModule(opts: {
  // Call index → overrides; unmatched calls use defaults.
  calls?: Array<{ trusted?: boolean; untrusted?: boolean }>
  // Override read_manifest_store entirely, e.g. to simulate a rejection.
  readManifestStore?: (fileBytes: Uint8Array, format: string, settingsJson?: string) => Promise<string>
  // Present only when the test needs sidecar/remote-manifest validation.
  readSidecarManifestStore?: (
    manifestBytes: Uint8Array, assetBytes: Uint8Array, assetFormat: string, settingsJson?: string,
  ) => Promise<string>
} = {}): Parameters<typeof _setLocalModuleForTesting>[0] {
  return {
    default: vi.fn(() => Promise.resolve()),
    get_version: vi.fn(() => 'c2pa-local-wasm v0.1.0 using c2pa-rs 0.99.0'),
    read_manifest_store: opts.readManifestStore ?? vi.fn((_bytes, _format, settingsJson) => {
      const idx = readCallCount++
      if (settingsJson) {
        try {
          const s = JSON.parse(settingsJson)
          if (s?.trust?.trust_anchors) recordedTrustAnchors.push(s.trust.trust_anchors)
          if (s?.trust?.trust_config) recordedTrustConfigs.push(s.trust.trust_config)
        } catch { /* ignore */ }
      }
      const override = opts.calls?.[idx]
      return Promise.resolve(
        override
          ? makeCrJson(override)
          : makeCrJson({ trusted: true })
      )
    }),
    ...(opts.readSidecarManifestStore ? { read_sidecar_manifest_store: opts.readSidecarManifestStore } : {}),
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('c2pa utilities', () => {
  beforeEach(() => {
    readCallCount = 0
    recordedTrustAnchors.length = 0
    recordedTrustConfigs.length = 0
    vi.clearAllMocks()

    // Default: inject a mock local module that always returns a trusted result.
    _setLocalModuleForTesting(makeLocalModule())

    // Mock trust list + ITL fetches.
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      let content = '-----BEGIN CERTIFICATE-----\nMockCertificate\n-----END CERTIFICATE-----'
      if (url.includes('allowed.pem')) {
        content = '-----BEGIN CERTIFICATE-----\nITLAllowedCert\n-----END CERTIFICATE-----'
      } else if (url.includes('anchors.pem')) {
        content = '-----BEGIN CERTIFICATE-----\nITLAnchorCert\n-----END CERTIFICATE-----'
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        text: () => Promise.resolve(content),
        headers: new Headers({ 'content-type': 'text/plain' }),
      } as Response)
    }) as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    _setLocalModuleForTesting(null)
    _resetSoftBindingCacheForTesting()
    vi.restoreAllMocks()
  })

  // ── getVersion ──────────────────────────────────────────────────────────────

  describe('getVersion', () => {
    it('returns the local WASM version string', async () => {
      const version = await getVersion()
      expect(version).toMatch(/c2pa-local-wasm/)
    })
  })

  // ── Sidecar detection ───────────────────────────────────────────────────────

  describe('sidecar detection', () => {
    it('detects a .c2pa file with no browser-reported MIME as a sidecar', () => {
      const f = new File([new Uint8Array([0])], 'my-manifest.c2pa', { type: '' })
      expect(isSidecarFile(f)).toBe(true)
      expect(resolveMimeType(f)).toBe(SIDECAR_MIME)
    })

    it('detects a .c2pa file served as application/octet-stream', () => {
      const f = new File([new Uint8Array([0])], 'my-manifest.c2pa', { type: 'application/octet-stream' })
      expect(isSidecarFile(f)).toBe(true)
      expect(resolveMimeType(f)).toBe(SIDECAR_MIME)
    })

    it('detects a file whose MIME is already application/c2pa', () => {
      const f = new File([new Uint8Array([0])], 'no-extension', { type: SIDECAR_MIME })
      expect(isSidecarFile(f)).toBe(true)
      expect(resolveMimeType(f)).toBe(SIDECAR_MIME)
    })

    it('does NOT mis-detect a .jpg as a sidecar', () => {
      const f = new File([new Uint8Array([0])], 'photo.jpg', { type: 'image/jpeg' })
      expect(isSidecarFile(f)).toBe(false)
      expect(resolveMimeType(f)).toBe('image/jpeg')
    })

    it('falls back to the extension when the browser reports no specific MIME', () => {
      const empty = new File([new Uint8Array([0])], 'scan.ARW', { type: '' })
      expect(resolveMimeType(empty)).toBe('image/x-sony-arw')
      const octet = new File([new Uint8Array([0])], 'asset.heics', { type: 'application/octet-stream' })
      expect(resolveMimeType(octet)).toBe('heics')
      const noExt = new File([new Uint8Array([0])], 'blob', { type: 'application/octet-stream' })
      expect(resolveMimeType(noExt)).toBe('application/octet-stream')
    })
  })

  // ── Text formats ────────────────────────────────────────────────────────────

  describe('text formats', () => {
    const file = (name: string, type: string) => new File(['hello'], name, { type })

    it('maps text extensions to the format c2pa-rs registers, over the browser MIME', () => {
      expect(resolveMimeType(file('notes.txt', 'text/plain'))).toBe('text/plain')
      expect(resolveMimeType(file('README.md', ''))).toBe('text/markdown')
      expect(resolveMimeType(file('config.yaml', 'application/x-yaml'))).toBe('application/yaml')
      expect(resolveMimeType(file('Cargo.toml', ''))).toBe('application/toml')
      expect(resolveMimeType(file('setup.ini', 'application/octet-stream'))).toBe('ini')
      expect(resolveMimeType(file('app.js', 'application/x-javascript'))).toBe('text/javascript')
      expect(resolveMimeType(file('script.py', 'text/x-python-script'))).toBe('text/x-python')
      expect(resolveMimeType(file('Notes.MD', 'text/markdown'))).toBe('text/markdown')
    })

    it('recognises text files by extension only', () => {
      expect(isTextFile(file('notes.TXT', ''))).toBe(true)
      expect(isTextFile(file('feed.atom', ''))).toBe(true)
      expect(isTextFile(file('photo.jpg', 'image/jpeg'))).toBe(false)
      expect(isTextFile(file('manifest.c2pa', ''))).toBe(false)
      expect(isTextFile(file('txt', 'text/plain'))).toBe(false)
    })

    it('offers every text extension in the asset picker', () => {
      for (const ext of ['.txt', '.md', '.yaml', '.toml', '.ini', '.py', '.vtt']) {
        expect(ASSET_ACCEPT.split(',')).toContain(ext)
      }
      expect(TEXT_ACCEPT.split(',').every(e => ASSET_ACCEPT.split(',').includes(e))).toBe(true)
    })
  })

  // ── MIDI ────────────────────────────────────────────────────────────────────

  describe('MIDI', () => {
    const file = (name: string, type = '') => new File(['MThd'], name, { type })
    const unsupported = () => Promise.reject('Failed to read C2PA data: type is unsupported')

    it('maps MIDI extensions to audio/midi, over the browser MIME', () => {
      expect(resolveMimeType(file('song.mid'))).toBe('audio/midi')
      expect(resolveMimeType(file('song.MIDI', 'audio/mid'))).toBe('audio/midi')
    })

    it('recognises MIDI by extension or MIME type and offers it in the asset picker', () => {
      expect(isMidiFile(file('song.mid'))).toBe(true)
      expect(isMidiFile(file('song', 'audio/x-midi'))).toBe(true)
      expect(isMidiFile(file('song.mp3', 'audio/mpeg'))).toBe(false)
      expect(isMidiMimeType('audio/mid')).toBe(true)
      expect(isMidiMimeType('audio/wav')).toBe(false)
      expect(ASSET_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.mid', '.midi']))
    })

    it('explains that MIDI needs the c2pa-rs MIDI handler when the build lacks it', async () => {
      _setLocalModuleForTesting(makeLocalModule({ readManifestStore: unsupported }))
      await expect(processFile(file('song.mid', 'audio/midi')))
        .rejects.toThrow(/MIDI files \(audio\/midi\) are not supported yet.*contentauth\/c2pa-rs#2733/)
    })

    it('keeps the general unsupported-format message for other types', async () => {
      _setLocalModuleForTesting(makeLocalModule({ readManifestStore: unsupported }))
      await expect(processFile(file('clip.xyz', 'application/x-unknown')))
        .rejects.toThrow(/^Unsupported file format \(application\/x-unknown\)/)
    })
  })

  // ── processFile — basic ─────────────────────────────────────────────────────

  describe('processFile', () => {
    it('returns a manifest store with a trusted signature', async () => {
      const result = await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      expect(result.manifests?.length).toBeGreaterThan(0)
      expect(result.manifests?.[0]?.label).toBe('urn:c2pa:test')
      expect(result.usedITL).toBe(false)
    })

    it('attaches conformance tool version metadata', async () => {
      const result = await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      expect(result._conformanceToolVersion).toBeDefined()
    })

    it('handles different image types', async () => {
      const result = await processFile(new File(['test'], 'test.png', { type: 'image/png' }))
      expect(result.manifests?.length).toBeGreaterThan(0)
    })

    it('accepts optional test certificates', async () => {
      const testCert = '-----BEGIN CERTIFICATE-----\nTestCert\n-----END CERTIFICATE-----'
      const result = await processFile(
        new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
        [testCert],
      )
      expect(result.manifests?.length).toBeGreaterThan(0)
    })

    it('includes the standard C2PA EKUs in every trust validation pass', async () => {
      _setLocalModuleForTesting(makeLocalModule({
        calls: [
          { untrusted: true },  // main TL
          { untrusted: true },  // test certificates
          { trusted: true },    // ITL
        ],
      }))

      const testCert = '-----BEGIN CERTIFICATE-----\nTestCert\n-----END CERTIFICATE-----'
      await processFile(
        new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
        [testCert],
      )

      expect(recordedTrustConfigs).toHaveLength(3)
      for (const trustConfig of recordedTrustConfigs) {
        expect(trustConfig).toContain('1.3.6.1.4.1.62558.2.1')
        expect(trustConfig).toContain('1.3.6.1.5.5.7.3.36')
      }
    })
  })

  // ── ITL validation flow ─────────────────────────────────────────────────────

  describe('ITL validation fallback', () => {
    it('runs multiple passes when the main trust list reports untrusted', async () => {
      _setLocalModuleForTesting(makeLocalModule({
        calls: [
          { untrusted: true },  // call 0 — main TL: untrusted
          { trusted: true },    // call 1 — ITL: trusted
        ],
      }))

      await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      expect(readCallCount).toBeGreaterThanOrEqual(2)
    })

    it('sets usedITL=true when the ITL makes the signature trusted', async () => {
      _setLocalModuleForTesting(makeLocalModule({
        calls: [
          { untrusted: true },  // main TL: untrusted
          { trusted: true },    // ITL: trusted
        ],
      }))

      const result = await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      expect(result.usedITL).toBe(true)
    })

    it('leaves usedITL=false when the signature is trusted on the main list', async () => {
      // Default module always returns trusted — no ITL pass needed.
      const result = await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      expect(result.usedITL).toBe(false)
      expect(readCallCount).toBe(1)
    })

    it('includes ITL anchors in the trust settings during the ITL pass', async () => {
      _setLocalModuleForTesting(makeLocalModule({
        calls: [
          { untrusted: true },
          { trusted: true },
        ],
      }))

      await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
      const itlCall = recordedTrustAnchors.find((a) => a.includes('ITLAnchorCert'))
      expect(itlCall).toBeDefined()
    })
  })

  // ── Test certificate flow ───────────────────────────────────────────────────

  describe('test certificate flow', () => {
    it('sets usedTestCerts=true when test certs make the difference', async () => {
      _setLocalModuleForTesting(makeLocalModule({
        calls: [
          { untrusted: true },  // call 0 — main TL: untrusted
          { trusted: true },    // call 1 — with test certs: trusted
          { trusted: true },    // call 2 — ITL (won't be reached)
        ],
      }))

      const testCert = '-----BEGIN CERTIFICATE-----\nTestCert\n-----END CERTIFICATE-----'
      const result = await processFile(
        new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
        [testCert],
      )
      expect(result.usedTestCerts).toBe(true)
    })
  })

  // ── Soft binding registry fallback ──────────────────────────────────────────

  describe('soft binding registry fallback', () => {
    it('falls back to the raw.githubusercontent.com URL when sbal.c2pa.org is CORS-blocked', async () => {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url === 'https://sbal.c2pa.org/') {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        if (url.includes('raw.githubusercontent.com') && url.includes('softbinding-algorithm-list.json')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            json: () => Promise.resolve([{ alg: 'c2pa.hash.bmff.v3' }, { alg: 'c2pa.hash.data' }]),
          } as Response)
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`))
      }) as ReturnType<typeof vi.fn>

      const algs = await _fetchSoftBindingAlgorithmsForTesting()
      expect(algs).toEqual(['c2pa.hash.bmff.v3', 'c2pa.hash.data'])
    })

    it('returns an empty list without throwing when every source fails', async () => {
      global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as ReturnType<typeof vi.fn>

      const algs = await _fetchSoftBindingAlgorithmsForTesting()
      expect(algs).toEqual([])
    })
  })

  // ── Remote manifest handling ────────────────────────────────────────────────

  function mockFetchWithRemoteManifest(remoteManifestUrl: string, manifestBytes: Uint8Array) {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === remoteManifestUrl) {
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          arrayBuffer: () => Promise.resolve(manifestBytes.buffer),
        } as Response)
      }
      let content = '-----BEGIN CERTIFICATE-----\nMockCertificate\n-----END CERTIFICATE-----'
      if (url.includes('allowed.pem')) content = '-----BEGIN CERTIFICATE-----\nITLAllowedCert\n-----END CERTIFICATE-----'
      else if (url.includes('anchors.pem')) content = '-----BEGIN CERTIFICATE-----\nITLAnchorCert\n-----END CERTIFICATE-----'
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        text: () => Promise.resolve(content),
        json: () => Promise.reject(new Error('not json')),
        headers: new Headers({ 'content-type': 'text/plain' }),
      } as unknown as Response)
    }) as ReturnType<typeof vi.fn>
  }

  describe('remote manifest handling', () => {
    it('processFile surfaces the remote-manifest URL as a real Error, even though wasm rejects with a bare string', async () => {
      // wasm-bindgen turns Err(JsValue::from_str(...)) into a promise rejected with a
      // plain string, not an Error instance — reproduce that exactly here so this test
      // would have caught the bug where downstream `instanceof Error` checks silently
      // fell back to a generic message and dropped the URL.
      _setLocalModuleForTesting(makeLocalModule({
        readManifestStore: () =>
          Promise.reject('Remote manifest reference: https://example.com/manifest.c2pa'),
      }))

      const rejection = await processFile(new File(['test'], 'test.jpg', { type: 'image/jpeg' })).catch((e) => e)
      expect(rejection).toBeInstanceOf(Error)
      expect((rejection as Error).message).toBe('Remote manifest reference: https://example.com/manifest.c2pa')
    })

    it('processRemoteManifest fetches the manifest, validates it, and flags the report', async () => {
      const remoteManifestUrl = 'https://example.com/manifest.c2pa'
      const manifestBytes = new Uint8Array([1, 2, 3])
      mockFetchWithRemoteManifest(remoteManifestUrl, manifestBytes)

      _setLocalModuleForTesting(makeLocalModule({
        readSidecarManifestStore: () => Promise.resolve(makeCrJson({ trusted: true })),
      }))

      const { report, manifestBytes: returnedBytes } = await processRemoteManifest(
        new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
        remoteManifestUrl,
      )

      expect(report.fetchedRemoteManifest).toBe(true)
      expect(report.remoteManifestUrl).toBe(remoteManifestUrl)
      expect(returnedBytes).toEqual(manifestBytes)
    })

    it('processRemoteManifest throws when the fetch itself fails', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' } as Response)
      ) as ReturnType<typeof vi.fn>

      await expect(
        processRemoteManifest(new File(['test'], 'test.jpg', { type: 'image/jpeg' }), 'https://example.com/gone.c2pa')
      ).rejects.toThrow(/Failed to fetch remote manifest/)
    })

    it('revalidateRemoteManifest validates already-fetched bytes without a network call', async () => {
      const remoteManifestUrl = 'https://example.com/manifest.c2pa'
      const manifestBytes = new Uint8Array([1, 2, 3])

      const readSidecarSpy = vi.fn(() => Promise.resolve(makeCrJson({ trusted: true })))
      _setLocalModuleForTesting(makeLocalModule({ readSidecarManifestStore: readSidecarSpy }))

      const fetchedUrls: string[] = []
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        fetchedUrls.push(url)
        // Soft binding registry lookups are non-fatal if they fail; everything
        // else (trust list, ITL) should already be cached from earlier tests.
        return Promise.reject(new Error(`unexpected fetch: ${url}`))
      }) as ReturnType<typeof vi.fn>

      const report = await revalidateRemoteManifest(
        new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
        manifestBytes,
        remoteManifestUrl,
      )

      expect(report.fetchedRemoteManifest).toBe(true)
      expect(report.remoteManifestUrl).toBe(remoteManifestUrl)
      expect(readSidecarSpy).toHaveBeenCalled()
      expect(fetchedUrls).not.toContain(remoteManifestUrl)
    })
  })
})
