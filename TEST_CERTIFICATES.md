# Test Certificate Mode

The C2PA Verify tool includes a built-in test mode for conformance testing with known test certificates.

## Overview

Test mode allows you to:
- Load a pre-configured C2PA test root certificate into the trust list
- Download a test signing certificate that chains to the test root
- Sign and validate test content without affecting production certificates
- Add additional custom test certificates to the trust list

## How to Use Test Mode

### 1. Enable Test Mode

On the home page, scroll down to the **Test Certificates** section and click **"Enable Test Mode"**.

This will:
- Load the C2PA Conformance Test Root certificate into the trust list
- Enable the ability to add custom certificates
- Enable the download button for the test signing certificate

### 2. Download the Test Signing Certificate

Click **"Download Signing Cert (ZIP)"** to download `c2pa-test-signing-bundle.zip`.

The ZIP contains PEM files (e.g. the test signing certificate and private key). Extract and use the bundle for signing. **For testing only!**

⚠️ **Security Warning**: This private key is publicly available in the repository. Never use it for production content.

### 3. Sign Content with the Test Certificate

Use the C2PA tool or SDK to sign your test content:

```bash
# Using the c2pa CLI tool
# After extracting c2pa-test-signing-bundle.zip
c2pa your-image.jpg \
  --manifest manifest.json \
  --signer-path /path/to/extracted-signing-bundle.pem \
  --output signed-image.jpg
```

### 4. Validate Signed Content

Upload your signed content to the C2PA Verify tool. With test mode enabled, files signed with the test certificate will validate as **trusted** (shown in green).

### 5. Add Custom Certificates (Optional)

With test mode enabled, you can click **"Add Custom Certificate"** to upload additional test certificates to the trust list. This is useful for:
- Testing custom certificate chains
- Validating content from your own test CAs
- Conformance testing with specific certificate configurations

### 6. Disable Test Mode

Click **"Disable Test Mode"** to:
- Remove the test root certificate from the trust list
- Return to production validation mode
- Clear any custom certificates

## Test Certificate Details

### Test Root Certificate
- **Subject**: CN=C2PA Conformance Test Root, O=C2PA Test, C=US
- **Key Usage**: keyCertSign, cRLSign
- **Extended Key Usage**: 1.3.6.1.5.5.7.3.36 (C2PA)
- **Validity**: 10 years
- **Location**: `/public/test-certs/test-root-cert.pem`

### Test Signing Certificate
- **Subject**: CN=C2PA Conformance Test Signing, O=C2PA Test, C=US
- **Key Usage**: digitalSignature
- **Extended Key Usage**: 1.3.6.1.5.5.7.3.36 (C2PA)
- **Validity**: 10 years
- **Issuer**: C2PA Conformance Test Root
- **Download**: Signing cert is distributed as **ZIP** (`test-signing-bundle.zip`) from the UI; extract to get PEMs (certificate and private key)

## Use Cases

### Conformance Testing
Test mode is ideal for:
- Validating C2PA implementations against known certificates
- Testing certificate chain validation
- Verifying Extended Key Usage (EKU) handling
- Testing trust anchor management

### Development
Use test mode during development to:
- Test signing and validation workflows
- Debug certificate-related issues
- Validate manifest generation
- Test different certificate configurations

### Education
Test mode helps in:
- Understanding C2PA trust architecture
- Learning about certificate chains
- Exploring validation processes
- Demonstrating C2PA functionality

## Important Notes

1. **Test mode is session-only** - Test certificates are not persisted and will be cleared when you refresh the page

2. **Test certificates are clearly marked** - Files validated with test certificates show a warning banner indicating test mode was used

3. **The test root is highlighted** - In the certificate list, the test root has a blue border and "Test Root" badge

4. **The test root cannot be removed individually** - You must disable test mode to remove it

5. **Custom certificates can only be added when test mode is enabled** - This prevents accidentally mixing test and production certificates

## Example Workflow

```bash
# 1. Download the test signing certificate from the web UI

# 2. Create a simple manifest
cat > manifest.json << EOF
{
  "claim_generator": "my-test-tool/1.0",
  "assertions": [
    {
      "label": "c2pa.actions.v2",
      "data": {
        "actions": [
          {
            "action": "c2pa.edited"
          }
        ]
      }
    }
  ]
}
EOF

# 3. Sign an image (use the .pem from the extracted ZIP)
c2pa input.jpg \
  --manifest manifest.json \
  --signer-path /path/to/extracted-signing-bundle.pem \
  --output output.jpg

# 4. Upload output.jpg to the C2PA Verify tool with test mode enabled
# 5. Verify it shows as "trusted" with green validation status
```

## Troubleshooting

**Problem**: Test mode button doesn't work
- **Solution**: Check the browser console for errors. Make sure the `/test-certs/` files are accessible.

**Problem**: Signed content doesn't validate as trusted
- **Solution**: Ensure test mode is enabled before uploading the file. Check that you're using the correct signing certificate.

**Problem**: Can't add custom certificates
- **Solution**: Make sure test mode is enabled first. Custom certificates can only be added when test mode is active.

**Problem**: Test root certificate appears in certificate list but isn't used
- **Solution**: Try disabling and re-enabling test mode. Make sure you're uploading a file signed with a certificate that chains to the test root.

## Technical Details

The test certificates use:
- **Algorithm**: ECDSA with P-256 curve
- **Signature**: SHA-256 with ECDSA
- **EKU OID**: `1.3.6.1.5.5.7.3.36` (C2PA specific)
- **Format**: PEM encoded

The certificate chain:
```
C2PA Conformance Test Root (CA)
  └── C2PA Conformance Test Signing (End Entity)
```

For more information about the certificates, see `public/test-certs/README.md` (if present in the repo).
