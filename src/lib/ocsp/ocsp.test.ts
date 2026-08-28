import { describe, expect, it } from 'vitest'
import { X509Certificate } from '@peculiar/x509'
import {
  splitPemCertificates,
  extractAiaEndpoints,
  buildOcspRequestDer,
  parseOcspResponseDer,
  createParsedCertificateItem,
  bufferToHex,
} from './parser'
import {
  checkCertificateOcsp,
  computeOcspBatchSummary,
  clearOcspCache,
} from './client'
import type { ParsedCertificateItem, OcspResponseData } from './types'

// Test fixture certificates
const TARGET_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDCzCCApGgAwIBAgIUAJNoVZ6rRVDrWpEX/foH+WYR3GIwCgYIKoZIzj0EAwMw
TjELMAkGA1UEBhMCVVMxEzARBgNVBAoMCkdvb2dsZSBMTEMxKjAoBgNVBAMMIUdv
b2dsZSBDMlBBIE1vYmlsZSBBIDFQIElDQSBHMyBMNDAeFw0yNjA1MjUwMDA4MzVa
Fw0yNjA4MjIwMDA4MzRaMDkxCzAJBgNVBAYTAlVTMRMwEQYDVQQKEwpHb29nbGUg
TExDMRUwEwYDVQQDEwxQaXhlbCBDYW1lcmEwWTATBgcqhkjOPQIBBggqhkjOPQMB
BwNCAATpTo3K9iY666kSKd+ytkjKC1a3L8HMk7+8liaWi8BUJSXuYYqTb9WIWy49
6faiXF9Ix6GBQBcM/iRB3qNV17bfo4IBYDCCAVwwDgYDVR0PAQH/BAQDAgbAMB8G
A1UdJQQYMBYGCCsGAQUFBwMEBgorBgEEAYPoXgIBMAwGA1UdEwEB/wQCMAAwHQYD
VR0OBBYEFKZCk/U1GUab8cvPgc7jAJv85H2bMB8GA1UdIwQYMBaAFFNttXLoIT5j
oYtbFXxh/dffEjGbMHIGCCsGAQUFBwEBBGYwZDAmBggrBgEFBQcwAYYaaHR0cDov
L2MycGEtb2NzcC5wa2kuZ29vZy8wOgYIKwYBBQUHMAKGLmh0dHA6Ly9wa2kuZ29v
Zy9jMnBhL21vYmlsZS1hLTFwLWljYS1nMy1sNC5jcnQwFwYDVR0gBBAwDjAMBgor
BgEEAYPoXgEBMBkGCSsGAQQBg+heAwQMBgorBgEEAYPoXgMUMDMGCSsGAQQBg+he
BAQmDCQwMTljZDliYS0zYjUxLTczYjctYjk1Zi01YmY4N2Y2MGYzZjIwCgYIKoZI
zj0EAwMDaAAwZQIxAM5TPDsiCuY7ws5c6+puFtGxzMg7XicHTw74Z3oSaQlJ4xBl
LK9saFQxgoCZTeRq/AIwMFqNx1AN0WG99peUer6AR9ZMLSjmJOd1u/2IXbFSI/K6
gK2csaSGKjYe7FiL3nLl
-----END CERTIFICATE-----`

const ISSUER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIC2zCCAmCgAwIBAgIUT8ox+CYy5uawPWuDq5i51htFNyIwCgYIKoZIzj0EAwMw
QzELMAkGA1UEBhMCVVMxEzARBgNVBAoMCkdvb2dsZSBMTEMxHzAdBgNVBAMMFkdv
b2dsZSBDMlBBIFJvb3QgQ0EgRzMwHhcNMjUwNzMxMjEzNDQ5WhcNMzAwNzMxMjEz
NDQ5WjBOMQswCQYDVQQGEwJVUzETMBEGA1UECgwKR29vZ2xlIExMQzEqMCgGA1UE
AwwhR29vZ2xlIEMyUEEgTW9iaWxlIEEgMVAgSUNBIEczIEw0MHYwEAYHKoZIzj0C
AQYFK4EEACIDYgAEdzciiVSAygXEOnYGN0w4CgRDWYMqsvolc2lpCyZnyDx5Q2po
V0vuiK+ts9r+jhQtTsd1ZMU5Gyx5h5z/vuOwzJcytaIoxjXu9qnrT9zvHb/cnWAb
w0yF6OQygtc8XHsfo4IBCDCCAQQwDgYDVR0PAQH/BAQDAgEGMB8GA1UdJQQYMBYG
CCsGAQUFBwMEBgorBgEEAYPoXgIBMBIGA1UdEwEB/wQIMAYBAf8CAQAwFwYDVR0g
BBAwDjAMBgorBgEEAYPoXgEBMGQGCCsGAQUFBwEBBFgwVjAsBggrBgEFBQcwAoYg
aHR0cDovL3BraS5nb29nL2MycGEvcm9vdC1nMy5jcnQwJgYIKwYBBQUHMAGGGmh0
dHA6Ly9jMnBhLW9jc3AucGtpLmdvb2cvMB8GA1UdIwQYMBaAFJxc2IlTQ+da1YHb
A94ZfwQqKi2qMB0GA1UdDgQWBBRTbbVy6CE+Y6GLWxV8Yf3X3xIxmzAKBggqhkjO
PQQDAwNpADBmAjEA+inCNKzYg71/IAwvgTN9KCkYNuBcB1Xhk6gYujZdRzgPHw3o
cmWxXH+QFnlYQrcMAjEA6nTiBHlgqcsQAAvFUE/iWvLjjNEfEiQU9kAmdbG77Naf
w9UC5rMVEBH+xS2SqWnq
-----END CERTIFICATE-----`

// Real DER response captured from Google C2PA OCSP Responder for revoked Pixel cert
const GOOGLE_OCSP_REVOKED_DER_B64 = `MIIEAwoBAKCCA/wwggP4BgkrBgEFBQcwAQEEggPpMIID5TCB/aFCMEAxCzAJBgNVBAYTAlVTMRMwEQYDVQQKEwpHb29nbGUgTExDMRwwGgYDVQQDExNDMlBBIE9DU1AgUmVzcG9uZGVyGA8yMDI2MDgyODE3MDEwMFowgaUwgaIwaTANBglghkgBZQMEAgEFAAQg4YztkeBJXSfihH/f5lwjsfmmQ039teQd7pnlofujSOEEIOw7EsEF0aD+ti2FXfclzoAJAs8gl0l6d9UfgVIHaRuOAhQAk2hVnqtFUOtakRf9+gf5ZhHcYqERGA8yMDI2MDUyNTAwMDgzNVoYDzIwMjYwODI4MTcwMTE4WqARGA8yMDI2MDkwNDE3MDExOFowCgYIKoZIzj0EAwIDRwAwRAIgcS5DcDFxTjuMsWPPWya7qKNVB0QFbalbGXDb9j9nPvYCIGCQqqCkL5ELKJWAhCzv33KtePCmgTB8TtlIbDuHjVa/oIICjDCCAogwggKEMIICCaADAgECAhNDv6alcJeh9va7oZ1occAdsuCZMAoGCCqGSM49BAMDME4xCzAJBgNVBAYTAlVTMRMwEQYDVQQKDApHb29nbGUgTExDMSowKAYDVQQDDCFHb29nbGUgQzJQQSBNb2JpbGUgQSAxUCBJQ0EgRzMgTDQwHhcNMjYwODI4MTYwMTE3WhcNMjYwOTI3MTYwMTE2WjBAMQswCQYDVQQGEwJVUzETMBEGA1UEChMKR29vZ2xlIExMQzEcMBoGA1UEAxMTQzJQQSBPQ1NQIFJlc3BvbmRlcjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABEem+Oj6OWX0noa3+oxO+2DZb02Q3Bk2sScMhe2PMkqrbVMHV6lE2dVPdBtv9LzSgW/PijPYAsmYefJTPHbUDKejgdMwgdAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMJMAwGA1UdEwEB/wQCMAAwHQYDVR0OBBYEFOKJwmtyq9IUxF2ykgWykxDyG+l3MB8GA1UdIwQYMBaAFFNttXLoIT5joYtbFXxh/dffEjGbMEoGCCsGAQUFBwEBBD4wPDA6BggrBgEFBQcwAoYuaHR0cDovL3BraS5nb29nL2MycGEvbW9iaWxlLWEtMXAtaWNhLWczLWw0LmNydDAPBgkrBgEFBQcwAQUEAgUAMAoGCCqGSM49BAMDA2kAMGYCMQC6cJPWPLDza1SgxVVkT8CMZb0y6YH5MOjeVL7TnWxm1TcBPDLZNtIKYIfIJ/45WjcCMQCl1IWljV0CGMGGVE6mve01z+ujSO5gRZBjLP9RDzadnJlIQcCJGiSGBuvSZZUXCRs=`

describe('OCSP Parser & AIA Extractor', () => {
  it('splits PEM chain into individual certificate strings', () => {
    const combined = `${TARGET_CERT_PEM}\n${ISSUER_CERT_PEM}`
    const list = splitPemCertificates(combined)
    expect(list).toHaveLength(2)
    expect(list[0]).toContain('BEGIN CERTIFICATE')
    expect(list[1]).toContain('BEGIN CERTIFICATE')
  })

  it('extracts AIA OCSP responder and CA issuers URLs', () => {
    const cert = new X509Certificate(TARGET_CERT_PEM)
    const { ocspResponderUrl, caIssuersUrl } = extractAiaEndpoints(cert)

    expect(ocspResponderUrl).toBe('http://c2pa-ocsp.pki.goog/')
    expect(caIssuersUrl).toBe('http://pki.goog/c2pa/mobile-a-1p-ica-g3-l4.crt')
  })

  it('creates rich ParsedCertificateItem with subject, issuer, serial, and AIA data', async () => {
    const targetCert = new X509Certificate(TARGET_CERT_PEM)
    const issuerCert = new X509Certificate(ISSUER_CERT_PEM)

    const item = await createParsedCertificateItem({
      id: 'test-manifest-signer',
      manifestLabel: 'urn:c2pa:test-manifest',
      manifestIndex: 0,
      manifestRole: 'active',
      manifestTitle: 'Pixel Camera Photo',
      certificateRole: 'claim_signer',
      targetCert,
      issuerCert,
    })

    expect(item.id).toBe('test-manifest-signer')
    expect(item.manifestRole).toBe('active')
    expect(item.subjectCommonName).toBe('Pixel Camera')
    expect(item.issuerCommonName).toBe('Google C2PA Mobile A 1P ICA G3 L4')
    expect(item.ocspResponderUrl).toBe('http://c2pa-ocsp.pki.goog/')
    expect(item.caIssuersUrl).toBe('http://pki.goog/c2pa/mobile-a-1p-ica-g3-l4.crt')
    expect(item.certThumbprint.length).toBeGreaterThan(10)
  })

  it('builds RFC 6960 OCSP Request DER correctly', async () => {
    const targetCert = new X509Certificate(TARGET_CERT_PEM)
    const issuerCert = new X509Certificate(ISSUER_CERT_PEM)

    const reqDer = await buildOcspRequestDer(targetCert, issuerCert)
    expect(reqDer).toBeInstanceOf(Uint8Array)
    expect(reqDer.byteLength).toBeGreaterThan(50)
  })

  it('parses real Google PKI revoked OCSP response DER', () => {
    const derBytes = Buffer.from(GOOGLE_OCSP_REVOKED_DER_B64, 'base64')
    const result = parseOcspResponseDer(new Uint8Array(derBytes))

    expect(result.status).toBe('revoked')
    expect(result.revokedAt).toBe('2026-05-25T00:08:35.000Z')
    expect(result.thisUpdate).toBe('2026-08-28T17:01:18.000Z')
    expect(result.nextUpdate).toBe('2026-09-04T17:01:18.000Z')
    expect(result.responderName).toContain('C2PA OCSP Responder')
  })
})

describe('OCSP Client Caching & Batch Summaries', () => {
  it('computes batch summary accurately across multiple certificates', () => {
    const mockItems: ParsedCertificateItem[] = [
      {
        id: 'c1',
        manifestLabel: 'm1',
        manifestIndex: 0,
        manifestRole: 'active',
        certificateRole: 'claim_signer',
        subject: 'CN=Good Cert',
        issuer: 'CN=Good CA',
        serialNumber: '111',
        notBefore: '',
        notAfter: '',
        isExpired: false,
        certThumbprint: 'tp1',
        targetCertPem: '',
        targetCertDer: new Uint8Array(),
        ocspResponderUrl: 'http://ocsp.example.com',
        caIssuersUrl: null,
      },
      {
        id: 'c2',
        manifestLabel: 'm2',
        manifestIndex: 1,
        manifestRole: 'ingredient',
        certificateRole: 'claim_signer',
        subject: 'CN=Revoked Cert',
        issuer: 'CN=Revoked CA',
        serialNumber: '222',
        notBefore: '',
        notAfter: '',
        isExpired: false,
        certThumbprint: 'tp2',
        targetCertPem: '',
        targetCertDer: new Uint8Array(),
        ocspResponderUrl: 'http://ocsp.example.com',
        caIssuersUrl: null,
      },
      {
        id: 'c3',
        manifestLabel: 'm3',
        manifestIndex: 2,
        manifestRole: 'ingredient',
        certificateRole: 'claim_signer',
        subject: 'CN=Local Test Cert',
        issuer: 'CN=Local Root',
        serialNumber: '333',
        notBefore: '',
        notAfter: '',
        isExpired: false,
        certThumbprint: 'tp3',
        targetCertPem: '',
        targetCertDer: new Uint8Array(),
        ocspResponderUrl: null, // No AIA
        caIssuersUrl: null,
      },
    ]

    const statusMap = new Map<string, OcspResponseData>([
      ['c1', { status: 'good', queriedAt: new Date().toISOString() }],
      ['c2', { status: 'revoked', revokedAt: '2026-01-01T00:00:00Z', queriedAt: new Date().toISOString() }],
    ])

    const summary = computeOcspBatchSummary(mockItems, statusMap, false)
    expect(summary.totalCertificates).toBe(3)
    expect(summary.withOcspResponder).toBe(2)
    expect(summary.checkedCount).toBe(2)
    expect(summary.goodCount).toBe(1)
    expect(summary.revokedCount).toBe(1)
    expect(summary.unknownCount).toBe(0)
    expect(summary.errorCount).toBe(0)
  })
})
