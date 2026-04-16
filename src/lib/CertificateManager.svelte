<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { X509Certificate } from '@peculiar/x509'
  import { CERTIFICATE_OID, EXTENDED_KEY_USAGE_OID } from './constants'

  export let testCertificates: string[] = []
  export let testModeEnabled = false
  export let testRootLoaded = false

  const dispatch = createEventDispatcher<{
    certificatesUpdated: string[]
    testModeChanged: { enabled: boolean; rootLoaded: boolean }
  }>()

  let fileInput: HTMLInputElement
  let expandedCerts: Set<number> = new Set()

  interface CertificateInfo {
    subject: string
    issuer: string
    validFrom: string
    validTo: string
    serialNumber: string
    signatureAlgorithm: string
    publicKeyAlgorithm: string
    subjectAltNames: string[]
    keyUsage: string[]
    extendedKeyUsage: string[]
  }

  function parseCertificate(pemContent: string): CertificateInfo | null {
    try {
      const cert = new X509Certificate(pemContent)
      
      return {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: cert.notBefore.toLocaleString(),
        validTo: cert.notAfter.toLocaleString(),
        serialNumber: cert.serialNumber,
        signatureAlgorithm: cert.signatureAlgorithm.name,
        publicKeyAlgorithm: cert.publicKey.algorithm.name,
        subjectAltNames: extractSubjectAltNames(cert),
        keyUsage: extractKeyUsage(cert),
        extendedKeyUsage: extractExtendedKeyUsage(cert)
      }
    } catch (err) {
      console.error('Error parsing certificate:', err)
      return null
    }
  }

  function extractSubjectAltNames(cert: X509Certificate): string[] {
    try {
      const san = cert.getExtension(CERTIFICATE_OID.SUBJECT_ALT_NAME)
      if (san) {
        // Basic extraction - in reality this would need proper ASN.1 parsing
        return ['(Present - detailed parsing not implemented)']
      }
      return []
    } catch {
      return []
    }
  }

  function extractKeyUsage(cert: X509Certificate): string[] {
    try {
      const ext = cert.getExtension(CERTIFICATE_OID.KEY_USAGE)
      if (!ext) return []

      // Parse the key usage bit string
      const value = ext.value
      if (!value || value.byteLength < 2) return []

      const dataView = new DataView(value)
      const unusedBits = dataView.getUint8(0)
      const keyUsageByte = dataView.getUint8(1)

      const usages: string[] = []
      const keyUsageFlags = [
        'Digital Signature',
        'Non Repudiation',
        'Key Encipherment',
        'Data Encipherment',
        'Key Agreement',
        'Key Cert Sign',
        'CRL Sign',
        'Encipher Only',
        'Decipher Only'
      ]

      for (let i = 0; i < 9; i++) {
        if (keyUsageByte & (1 << (7 - i))) {
          usages.push(keyUsageFlags[i])
        }
      }

      return usages.length > 0 ? usages : ['None']
    } catch (err) {
      console.error('Error parsing key usage:', err)
      return ['(Parse error)']
    }
  }

  function extractExtendedKeyUsage(cert: X509Certificate): string[] {
    try {
      const ext = cert.getExtension(CERTIFICATE_OID.EXTENDED_KEY_USAGE)
      if (!ext) return []

      const ekuOIDs: Record<string, string> = {
        [EXTENDED_KEY_USAGE_OID.SERVER_AUTH]: 'TLS Web Server Authentication',
        [EXTENDED_KEY_USAGE_OID.CLIENT_AUTH]: 'TLS Web Client Authentication',
        [EXTENDED_KEY_USAGE_OID.CODE_SIGNING]: 'Code Signing',
        [EXTENDED_KEY_USAGE_OID.EMAIL_PROTECTION]: 'Email Protection',
        [EXTENDED_KEY_USAGE_OID.TIME_STAMPING]: 'Timestamping',
        [EXTENDED_KEY_USAGE_OID.OCSP_SIGNING]: 'OCSP Signing',
        '1.3.6.1.4.1.311.10.3.12': 'Document Signing',
        '2.16.840.1.113730.4.1': 'Netscape Server Gated Crypto'
      }

      // Parse the extension value as bytes and look for OID patterns
      const bytes = new Uint8Array(ext.value)
      const usages: string[] = []
      
      // Simple OID detection by looking for the byte patterns
      // OIDs are encoded in ASN.1 as 0x06 (OBJECT IDENTIFIER tag) followed by length and value
      let i = 0
      while (i < bytes.length - 2) {
        if (bytes[i] === 0x06) { // OID tag
          const oidLength = bytes[i + 1]
          if (i + 2 + oidLength <= bytes.length) {
            const oidBytes = bytes.slice(i + 2, i + 2 + oidLength)
            const oid = decodeOID(oidBytes)
            if (oid && ekuOIDs[oid]) {
              usages.push(ekuOIDs[oid])
            } else if (oid) {
              usages.push(oid) // Show unknown OIDs as-is
            }
            i += 2 + oidLength
          } else {
            i++
          }
        } else {
          i++
        }
      }

      return usages.length > 0 ? usages : []
    } catch (err) {
      console.error('Error parsing extended key usage:', err)
      return []
    }
  }

  function decodeOID(bytes: Uint8Array): string | null {
    try {
      if (bytes.length === 0) return null
      
      const result: number[] = []
      // First byte encodes first two arcs
      result.push(Math.floor(bytes[0] / 40))
      result.push(bytes[0] % 40)
      
      let value = 0
      for (let i = 1; i < bytes.length; i++) {
        value = (value << 7) | (bytes[i] & 0x7f)
        if ((bytes[i] & 0x80) === 0) {
          result.push(value)
          value = 0
        }
      }
      
      return result.join('.')
    } catch {
      return null
    }
  }

  function extractSubjectFromPEM(pemContent: string): string {
    try {
      const cert = new X509Certificate(pemContent)
      const subjectStr = cert.subject
      
      // Extract CN (Common Name) from subject
      const cnMatch = subjectStr.match(/CN=([^,]+)/)
      if (cnMatch) {
        return cnMatch[1].trim()
      }
      
      // Extract O (Organization) as fallback
      const oMatch = subjectStr.match(/O=([^,]+)/)
      if (oMatch) {
        return oMatch[1].trim()
      }
      
      return 'Unknown Certificate'
    } catch (err) {
      console.error('Error extracting subject:', err)
      return 'Certificate (Parse error)'
    }
  }

  function toggleExpand(index: number) {
    const newExpanded = new Set(expandedCerts)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    expandedCerts = newExpanded
  }

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const file = files[0]
    const reader = new FileReader()

    reader.onload = (e) => {
      const content = e.target?.result as string
      if (content && (content.includes('BEGIN CERTIFICATE') || content.includes('BEGIN TRUSTED CERTIFICATE'))) {
        testCertificates = [...testCertificates, content]
        dispatch('certificatesUpdated', testCertificates)
        console.log('✅ Test certificate added:', file.name)
      } else {
        alert('Invalid certificate file. Please select a PEM-encoded certificate.')
      }
    }

    reader.onerror = () => {
      console.error('Failed to read certificate file:', reader.error)
      alert('Failed to read certificate file. Please try again.')
    }

    reader.readAsText(file)
    input.value = '' // Reset input
  }

  function removeCertificate(index: number) {
    // Prevent removing the test root if it's the first certificate and test mode is enabled
    if (index === 0 && testModeEnabled && testRootLoaded) {
      alert('Cannot remove the test root certificate. Disable test mode first.')
      return
    }

    testCertificates = testCertificates.filter((_, i) => i !== index)
    dispatch('certificatesUpdated', testCertificates)
    // Clean up expanded state
    const newExpanded = new Set(expandedCerts)
    newExpanded.delete(index)
    expandedCerts = newExpanded
  }

  function handleClick() {
    fileInput.click()
  }

  // Embedded C2PA test root certificate (avoids network fetch issues)
  const TEST_ROOT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICBTCCAaygAwIBAgIUUtIyu93JJmVhLMyrf/bsIavWFNAwCgYIKoZIzj0EAwIw
RjEjMCEGA1UEAwwaQzJQQSBDb25mb3JtYW5jZSBUZXN0IFJvb3QxEjAQBgNVBAoM
CUMyUEEgVGVzdDELMAkGA1UEBhMCVVMwHhcNMjYwMjA4MTYwMTE0WhcNMzYwMjA2
MTYwMTE0WjBGMSMwIQYDVQQDDBpDMlBBIENvbmZvcm1hbmNlIFRlc3QgUm9vdDES
MBAGA1UECgwJQzJQQSBUZXN0MQswCQYDVQQGEwJVUzBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABAvaFRB/XQHFjRuzNp3bjzAbA83Ky4mLGP+wea5NOlgb3BW5xIM2
gUIUSR5S06YtHZI1fzabIgi1VStcO7Q1NJSjeDB2MA8GA1UdEwEB/wQFMAMBAf8w
DgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTPq5ZiRWulFSlnGo6SZSDgVFqODzAf
BgNVHSMEGDAWgBTPq5ZiRWulFSlnGo6SZSDgVFqODzATBgNVHSUEDDAKBggrBgEF
BQcDJDAKBggqhkjOPQQDAgNHADBEAiAH+KVmLpBx+Kovr4Rtr2tDgPP6iNobYBOa
MCZvLxXCtwIgCxkR0Gbdwef8k0bf1tC3dz+4NDe0S8wdCx5ZgeRPkq4=
-----END CERTIFICATE-----`

  async function enableTestMode() {
    try {
      console.log('🔍 Loading embedded C2PA test root certificate')
      const rootCert = TEST_ROOT_CERT_PEM.trim()
      console.log('📄 Certificate loaded, length:', rootCert.length, 'chars')

      testCertificates = [rootCert, ...testCertificates]
      testModeEnabled = true
      testRootLoaded = true
      dispatch('certificatesUpdated', testCertificates)
      dispatch('testModeChanged', { enabled: true, rootLoaded: true })
      console.log('✅ Test mode enabled - test root certificate loaded')
    } catch (err) {
      console.error('❌ Failed to enable test mode:', err)
      alert(`Failed to load test root certificate: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function disableTestMode() {
    // Clear ALL test certificates when disabling test mode
    if (testModeEnabled) {
      testCertificates = []
      testModeEnabled = false
      testRootLoaded = false
      dispatch('certificatesUpdated', testCertificates)
      dispatch('testModeChanged', { enabled: false, rootLoaded: false })
      console.log('✅ Test mode disabled - all test certificates cleared')
    }
  }

  async function downloadTestSigningCert() {
    try {
      const response = await fetch('/test-certs/test-signing-bundle.zip')
      if (!response.ok) throw new Error('Failed to download test signing certificate')
      const zipBlob = await response.blob()

      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'c2pa-test-signing-bundle.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('✅ Test signing certificate bundle downloaded (ZIP)')
    } catch (err) {
      console.error('Failed to download test signing certificate:', err)
      alert('Failed to download test signing certificate')
    }
  }
</script>

<div class="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-800/50 dark:to-gray-800/50 border-2 border-amber-300 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
  <div class="flex-1">
    <div class="flex items-start gap-3 mb-3">
      <div class="flex-shrink-0 w-10 h-10 bg-amber-600 dark:bg-gray-600 rounded-lg flex items-center justify-center">
        <svg class="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /><path d="M15 19l2 2l4 -4" /></svg>
      </div>
      <div class="flex-1">
        <h3 class="font-bold text-amber-900 dark:text-gray-100 text-lg">
          Test Certificates
        </h3>
        <p class="text-sm text-amber-800/90 dark:text-gray-400 mt-1">
          Add test certificates for conformance testing. Session-only and clearly marked in results.
        </p>
      </div>
    </div>

    <!-- Test Mode Controls -->
    <div class="mt-4 p-4 bg-blue-50 dark:bg-gray-800/50 border-2 border-blue-200 dark:border-gray-600 rounded-xl">
      <div class="flex items-start gap-3 mb-3">
        <div class="flex-shrink-0 w-8 h-8 bg-blue-600 dark:bg-gray-600 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <div class="flex-1">
          <h4 class="font-bold text-blue-900 dark:text-gray-100 text-base mb-1">
            C2PA Test Mode
          </h4>
          <p class="text-xs text-blue-800 dark:text-gray-300">
            Load the built-in C2PA conformance test root certificate and download a signing certificate for testing
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        {#if !testModeEnabled}
          <button
            class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
            on:click={enableTestMode}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M20 8.04l-12.122 12.124a2.857 2.857 0 1 1 -4.041 -4.04l12.122 -12.124" /><path d="M7 13h8" /><path d="M19 15l1.5 1.6a2 2 0 1 1 -3 0l1.5 -1.6" /><path d="M15 3l6 6" /></svg>
            Enable Test Mode
          </button>
        {:else}
          <button
            class="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
            on:click={disableTestMode}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>
            Disable Test Mode
          </button>
          <button
            class="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
            on:click={downloadTestSigningCert}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" /></svg>
            Download Signing Cert (ZIP)
          </button>
        {/if}
      </div>
    </div>

    <!-- Certificate Status and Add Button -->
    <div class="flex items-center justify-between gap-4 mt-4">
      <div>
        {#if testCertificates.length > 0}
          <span class="inline-flex items-center gap-2 px-3 py-1 bg-amber-200 dark:bg-gray-700/50 text-amber-900 dark:text-gray-100 rounded-full text-sm font-semibold">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11.998 2l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021l.115 -.007zm3.71 7.293a1 1 0 0 0 -1.415 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>
            {testCertificates.length} {testCertificates.length === 1 ? 'certificate' : 'certificates'} loaded
          </span>
        {/if}
      </div>
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm whitespace-nowrap shadow-md hover:shadow-lg transform"
        on:click={handleClick}
        disabled={!testModeEnabled}
        class:opacity-50={!testModeEnabled}
        class:cursor-not-allowed={!testModeEnabled}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 5l0 14" /><path d="M5 12l14 0" /></svg>
        Add Custom Certificate
      </button>
    </div>

    {#if testCertificates.length > 0}
      <div class="mt-4 space-y-2">
        {#each testCertificates as cert, index}
          {@const isTestRoot = index === 0 && testModeEnabled && testRootLoaded}
          <div class="bg-white/70 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg border {isTestRoot ? 'border-blue-400 dark:border-gray-600 ring-2 ring-blue-200 dark:ring-gray-700' : 'border-amber-200 dark:border-gray-700'} hover:bg-white dark:hover:bg-gray-800 transition-all overflow-hidden">
            <div class="flex items-center justify-between p-3 text-sm group">
              <button
                on:click={() => toggleExpand(index)}
                class="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity"
              >
                <div class="w-8 h-8 {isTestRoot ? 'bg-blue-100 dark:bg-gray-700' : 'bg-amber-100 dark:bg-gray-700'} rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg class="w-4 h-4 {isTestRoot ? 'text-blue-700 dark:text-gray-300' : 'text-amber-700 dark:text-gray-300'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path d="M9 9l1 0" /><path d="M9 13l6 0" /><path d="M9 17l6 0" /></svg>
                </div>
                <div class="flex-1 min-w-0">
                  <span class="text-amber-900 dark:text-gray-100 font-medium block truncate">
                    {extractSubjectFromPEM(cert)}
                  </span>
                  {#if isTestRoot}
                    <span class="inline-block mt-0.5 px-2 py-0.5 bg-blue-200 dark:bg-gray-700 text-blue-900 dark:text-gray-100 text-xs font-semibold rounded">
                      Test Root
                    </span>
                  {/if}
                </div>
                <svg
                  class="w-5 h-5 text-amber-600 dark:text-gray-400 transition-transform flex-shrink-0 {expandedCerts.has(index) ? 'rotate-180' : ''}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                class="flex items-center justify-center w-8 h-8 text-amber-600 dark:text-gray-400 hover:text-white hover:bg-amber-600 dark:hover:bg-gray-600 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"
                on:click={() => removeCertificate(index)}
                title="Remove certificate"
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>
              </button>
            </div>
            
            {#if expandedCerts.has(index)}
              {@const certInfo = parseCertificate(cert)}
              <div class="px-4 py-3 border-t border-amber-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/20">
                {#if certInfo}
                  <div class="space-y-2 text-xs">
                    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-start">
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Subject:</div>
                      <div class="text-amber-900 dark:text-gray-100 font-mono break-all text-left">{certInfo.subject}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Issuer:</div>
                      <div class="text-amber-900 dark:text-gray-100 font-mono break-all text-left">{certInfo.issuer}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Valid From:</div>
                      <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.validFrom}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Valid To:</div>
                      <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.validTo}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Serial Number:</div>
                      <div class="text-amber-900 dark:text-gray-100 font-mono break-all text-left">{certInfo.serialNumber}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Signature Algorithm:</div>
                      <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.signatureAlgorithm}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Public Key Algorithm:</div>
                      <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.publicKeyAlgorithm}</div>
                      
                      {#if certInfo.keyUsage.length > 0}
                        <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Key Usage:</div>
                        <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.keyUsage.join(', ')}</div>
                      {/if}
                      
                      {#if certInfo.extendedKeyUsage.length > 0}
                        <div class="font-semibold text-amber-800 dark:text-gray-400 text-left">Extended Key Usage:</div>
                        <div class="text-amber-900 dark:text-gray-100 text-left">{certInfo.extendedKeyUsage.join(', ')}</div>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="text-red-700 dark:text-gray-400 text-xs py-1">
                    Failed to parse certificate
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".pem,.crt,.cer"
  on:change={handleFileSelect}
  class="hidden"
/>
