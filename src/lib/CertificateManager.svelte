<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { X509Certificate } from '@peculiar/x509'

  export let testCertificates: string[] = []

  const dispatch = createEventDispatcher<{
    certificatesUpdated: string[]
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
      const san = cert.getExtension('2.5.29.17') // Subject Alternative Name OID
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
      const ext = cert.getExtension('2.5.29.15') // Key Usage OID
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
      const ext = cert.getExtension('2.5.29.37') // Extended Key Usage OID
      if (!ext) return []

      // Common EKU OIDs
      const ekuOIDs: Record<string, string> = {
        '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
        '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
        '1.3.6.1.5.5.7.3.3': 'Code Signing',
        '1.3.6.1.5.5.7.3.4': 'Email Protection',
        '1.3.6.1.5.5.7.3.8': 'Timestamping',
        '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
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
        alert('Invalid certificate file. Please upload a PEM-encoded certificate.')
      }
    }

    reader.readAsText(file)
    input.value = '' // Reset input
  }

  function removeCertificate(index: number) {
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
</script>

<div class="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
  <div class="flex-1">
    <div class="flex items-start gap-3 mb-3">
      <div class="flex-shrink-0 w-10 h-10 bg-amber-600 dark:bg-amber-500 rounded-lg flex items-center justify-center">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-bold text-amber-900 dark:text-amber-100 text-lg">
          Test Certificates
        </h3>
        <p class="text-sm text-amber-800/90 dark:text-amber-200/90 mt-1">
          Upload test certificates for conformance testing. Session-only and clearly marked in results.
        </p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 mt-4">
      <div>
        {#if testCertificates.length > 0}
          <span class="inline-flex items-center gap-2 px-3 py-1 bg-amber-200 dark:bg-amber-800/50 text-amber-900 dark:text-amber-100 rounded-full text-sm font-semibold">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {testCertificates.length} {testCertificates.length === 1 ? 'certificate' : 'certificates'} loaded
          </span>
        {/if}
      </div>
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm whitespace-nowrap shadow-md hover:shadow-lg transform hover:scale-105"
        on:click={handleClick}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Upload Certificate
      </button>
    </div>

    {#if testCertificates.length > 0}
      <div class="mt-4 space-y-2">
        {#each testCertificates as cert, index}
          <div class="bg-white/70 dark:bg-amber-950/50 backdrop-blur-sm rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-white dark:hover:bg-amber-950 transition-colors overflow-hidden">
            <div class="flex items-center justify-between p-3 text-sm group">
              <button
                on:click={() => toggleExpand(index)}
                class="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity"
              >
                <div class="w-8 h-8 bg-amber-100 dark:bg-amber-800 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg class="w-4 h-4 text-amber-700 dark:text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <span class="text-amber-900 dark:text-amber-100 font-medium block truncate">
                    {extractSubjectFromPEM(cert)}
                  </span>
                </div>
                <svg
                  class="w-5 h-5 text-amber-600 dark:text-amber-400 transition-transform flex-shrink-0 {expandedCerts.has(index) ? 'rotate-180' : ''}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                class="flex items-center justify-center w-8 h-8 text-amber-600 dark:text-amber-400 hover:text-white hover:bg-amber-600 dark:hover:bg-amber-700 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"
                on:click={() => removeCertificate(index)}
                title="Remove certificate"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {#if expandedCerts.has(index)}
              {@const certInfo = parseCertificate(cert)}
              <div class="px-4 py-3 border-t border-amber-200 dark:border-amber-800 bg-white/50 dark:bg-amber-950/20">
                {#if certInfo}
                  <div class="space-y-2 text-xs">
                    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-start">
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Subject:</div>
                      <div class="text-amber-900 dark:text-amber-100 font-mono break-all text-left">{certInfo.subject}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Issuer:</div>
                      <div class="text-amber-900 dark:text-amber-100 font-mono break-all text-left">{certInfo.issuer}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Valid From:</div>
                      <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.validFrom}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Valid To:</div>
                      <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.validTo}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Serial Number:</div>
                      <div class="text-amber-900 dark:text-amber-100 font-mono break-all text-left">{certInfo.serialNumber}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Signature Algorithm:</div>
                      <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.signatureAlgorithm}</div>
                      
                      <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Public Key Algorithm:</div>
                      <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.publicKeyAlgorithm}</div>
                      
                      {#if certInfo.keyUsage.length > 0}
                        <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Key Usage:</div>
                        <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.keyUsage.join(', ')}</div>
                      {/if}
                      
                      {#if certInfo.extendedKeyUsage.length > 0}
                        <div class="font-semibold text-amber-800 dark:text-amber-400 text-left">Extended Key Usage:</div>
                        <div class="text-amber-900 dark:text-amber-100 text-left">{certInfo.extendedKeyUsage.join(', ')}</div>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="text-red-700 dark:text-red-300 text-xs py-1">
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
