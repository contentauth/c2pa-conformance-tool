use c2pa::{Context, Error as C2paError, Reader};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();
}

fn build_context(settings_json: Option<String>) -> Result<Context, JsValue> {
    match settings_json {
        Some(json) if !json.trim().is_empty() => Context::new()
            .with_settings(json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse C2PA settings: {e}"))),
        _ => Ok(Context::new()),
    }
}

///
/// The caller is expected to always pass `verify.remote_manifest_fetch: false` in
/// `settings_json` — if the asset has no embedded manifest and only references one
/// hosted remotely, this returns `Err` with the message `"Remote manifest reference:
/// <url>"` instead of fetching it, so the caller can ask for consent first. Fetch the
/// URL yourself and validate the bytes via `read_sidecar_manifest_store`, which the
/// upstream SDK documents as usable for "a remote manifest or a sidecar manifest."
#[wasm_bindgen]
pub async fn read_manifest_store(
    file_bytes: Vec<u8>,
    format: String,
    settings_json: Option<String>,
) -> Result<String, JsValue> {
    let context = build_context(settings_json)?;

    match Reader::from_context(context)
        .with_stream_async(&format, Cursor::new(file_bytes))
        .await
    {
        Ok(reader) => Ok(reader.crjson()),
        Err(C2paError::RemoteManifestUrl(url)) => {
            Err(JsValue::from_str(&format!("Remote manifest reference: {url}")))
        }
        Err(e) => Err(JsValue::from_str(&format!("Failed to read C2PA data: {e}"))),
    }
}

/// Validate a detached (`.c2pa`) manifest store, a fetched remote manifest, or a
/// sidecar manifest against its referenced asset.
///
/// The C2PA manifest bytes live separately from the asset (`asset_bytes`) — either
/// because they came from a `.c2pa` sidecar file, or because the caller fetched them
/// from a remote manifest URL surfaced by `read_manifest_store`. We feed both into
/// c2pa-rs's `with_manifest_data_and_stream_async`, which evaluates the asset-hash
/// assertions *against the actual asset bytes* — something we cannot do with
/// the single-blob `read_manifest_store` path.
///
/// * `manifest_bytes` - raw bytes of the manifest store (JUMBF), from a `.c2pa`
///   sidecar or a fetched remote manifest.
/// * `asset_bytes` - raw bytes of the referenced asset.
/// * `asset_format` - MIME type of the asset (e.g. "image/jpeg"). The
///   sidecar's own format is always `application/c2pa` and the SDK infers that.
/// * `settings_json` - trust settings (same shape as `read_manifest_store`).
#[wasm_bindgen]
pub async fn read_sidecar_manifest_store(
    manifest_bytes: Vec<u8>,
    asset_bytes: Vec<u8>,
    asset_format: String,
    settings_json: Option<String>,
) -> Result<String, JsValue> {
    let context = build_context(settings_json)?;

    let reader = Reader::from_context(context)
        .with_manifest_data_and_stream_async(
            &manifest_bytes,
            &asset_format,
            Cursor::new(asset_bytes),
        )
        .await
        .map_err(|e| {
            JsValue::from_str(&format!("Failed to validate sidecar against asset: {e}"))
        })?;

    Ok(reader.crjson())
}

/// Resolve a JUMBF resource URI (e.g. a thumbnail identifier) to its raw bytes.
///
/// Re-reads the manifest store from the provided file bytes so no persistent
/// state is required between calls. Non-fatal: callers should treat errors as
/// "resource unavailable" rather than a hard failure.
///
/// * `file_bytes`   - Raw bytes of the original asset file.
/// * `format`       - MIME type of the asset (e.g. "image/jpeg").
/// * `uri`          - JUMBF resource URI from a crJSON `identifier` field.
/// * `settings_json`- Optional trust/verify settings (same shape as `read_manifest_store`).
#[wasm_bindgen]
pub async fn get_resource_bytes(
    file_bytes: Vec<u8>,
    format: String,
    uri: String,
    settings_json: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    let context = build_context(settings_json)?;

    let reader = Reader::from_context(context)
        .with_stream_async(&format, Cursor::new(file_bytes))
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to read C2PA data: {e}")))?;

    let mut out = Cursor::new(Vec::new());
    reader
        .resource_to_stream(&uri, &mut out)
        .map_err(|e| JsValue::from_str(&format!("Resource not found: {e}")))?;

    Ok(out.into_inner())
}

/// Get version information
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("c2pa-local-wasm v{} using c2pa-rs {}",
            env!("CARGO_PKG_VERSION"),
            c2pa::VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        let version = get_version();
        assert!(version.contains("c2pa-local-wasm"));
    }
}

/// Regression coverage for the trust_config/EKU behavior fixed alongside #59: c2pa-rs
/// (as of the "unified trust lists" redesign in upstream commit be7f5ea2) does not seed
/// any default EKU allow-list when custom trust anchors are supplied — the caller must
/// pass `trust.trust_config` explicitly, or certificates whose only relevant EKU is the
/// C2PA claim-signing OID (not one of the always-accepted email/timestamping/OCSP EKUs)
/// are rejected as `signingCredential.invalid`, even when their issuer is fully trusted.
///
/// This exercises the real `read_manifest_store` entry point end-to-end (not mocked),
/// against a real signed asset, with a settings JSON matching exactly what
/// `src/lib/c2pa.ts`'s `toLocalSettingsJson` sends — so a future c2pa-rs upgrade that
/// changes this contract (renames the field, changes its format, stops honoring it)
/// will fail this test rather than silently reintroducing the bug.
#[cfg(test)]
mod eku_trust_config_tests {
    use super::*;
    use c2pa::{create_signer, Builder, BuilderIntent, ClaimGeneratorInfo, DigitalSourceType, SigningAlg};

    const ROOT_CERT_PEM: &str = include_str!("../tests/fixtures/eku/root_cert.pem");
    const LEAF_CERT_PEM: &str = include_str!("../tests/fixtures/eku/leaf_cert.pem");
    const LEAF_KEY_PEM: &str = include_str!("../tests/fixtures/eku/leaf_key.pem");
    const BASE_JPEG: &[u8] = include_bytes!("../tests/fixtures/eku/base.jpg");

    // Must match DEFAULT_TRUST_CONFIG in src/lib/c2pa.ts.
    const DEFAULT_TRUST_CONFIG: &str = "1.3.6.1.5.5.7.3.4\n1.3.6.1.5.5.7.3.36\n1.3.6.1.5.5.7.3.8\n1.3.6.1.5.5.7.3.9\n1.3.6.1.4.1.311.76.59.1.9\n1.3.6.1.4.1.62558.2.1";

    /// Signs `BASE_JPEG` with a leaf certificate (chained to `ROOT_CERT_PEM`) whose
    /// *only* Extended Key Usage is the C2PA claim-signing OID (1.3.6.1.4.1.62558.2.1) —
    /// deliberately not id-kp-emailProtection, which c2pa-rs accepts unconditionally
    /// regardless of trust_config and so would not exercise this regression at all
    /// (even c2pa-rs's own generic test-signing certs use emailProtection).
    fn sign_test_asset() -> Vec<u8> {
        let signer = create_signer::from_keys(
            LEAF_CERT_PEM.as_bytes(),
            LEAF_KEY_PEM.as_bytes(),
            SigningAlg::Es256,
            None,
        )
        .expect("failed to build test signer from fixture cert/key");

        // verify_after_sign is disabled here because the signing certificate isn't in
        // any trust list yet at sign time (that's exactly what read_manifest_store,
        // called afterwards with real trust settings, is meant to test).
        let signing_context = Context::new()
            .with_settings(r#"{"verify":{"verify_after_sign":false}}"#)
            .expect("failed to build signing context");
        let mut builder = Builder::from_context(signing_context);
        builder.set_intent(BuilderIntent::Create(DigitalSourceType::Empty));
        builder.set_claim_generator_info(ClaimGeneratorInfo::new("conformulator-eku-test"));

        let mut source = Cursor::new(BASE_JPEG.to_vec());
        let mut dest = Cursor::new(Vec::new());
        builder
            .sign(signer.as_ref(), "image/jpeg", &mut source, &mut dest)
            .expect("failed to sign test asset");
        dest.into_inner()
    }

    /// Same shape `toLocalSettingsJson` (c2pa.ts) builds: `verify` plus a `trust` block
    /// with our root as the trust anchor and, optionally, `trust_config`.
    fn settings_json(trust_config: Option<&str>) -> String {
        let mut trust = serde_json::json!({ "trust_anchors": ROOT_CERT_PEM });
        if let Some(tc) = trust_config {
            trust["trust_config"] = serde_json::json!(tc);
        }
        serde_json::json!({
            "verify": { "verify_after_reading": true, "verify_trust": true },
            "trust": trust,
        })
        .to_string()
    }

    #[test]
    fn trust_config_makes_a_c2pa_only_eku_cert_trusted() {
        let signed_bytes = sign_test_asset();

        let crjson = pollster::block_on(read_manifest_store(
            signed_bytes,
            "image/jpeg".to_string(),
            Some(settings_json(Some(DEFAULT_TRUST_CONFIG))),
        ))
        .unwrap_or_else(|e| panic!("read_manifest_store failed: {e:?}"));

        assert!(
            crjson.contains("signingCredential.trusted"),
            "expected signingCredential.trusted in crJSON: {crjson}"
        );
        assert!(
            !crjson.contains("signingCredential.invalid"),
            "did not expect signingCredential.invalid in crJSON: {crjson}"
        );
        assert!(
            !crjson.contains("signingCredential.untrusted"),
            "did not expect signingCredential.untrusted in crJSON: {crjson}"
        );
    }

    /// Proves the test above is meaningful: without trust_config, the identical
    /// cert/asset — whose issuing root IS in trust_anchors — is still rejected purely
    /// on EKU grounds. This is the exact bug #59 reported and PR #60 fixed.
    #[test]
    fn without_trust_config_the_same_cert_is_rejected_on_eku_grounds() {
        let signed_bytes = sign_test_asset();

        let crjson = pollster::block_on(read_manifest_store(
            signed_bytes,
            "image/jpeg".to_string(),
            Some(settings_json(None)),
        ))
        .unwrap_or_else(|e| panic!("read_manifest_store failed: {e:?}"));

        assert!(
            !crjson.contains("signingCredential.trusted"),
            "expected the cert to be rejected without trust_config, but got: {crjson}"
        );
        // Matches issue #59's exact reported failure signature: both codes together,
        // even though the issuing root is in trust_anchors — the cert is rejected
        // purely because its EKU isn't on any (now-empty) accepted list.
        assert!(
            crjson.contains("signingCredential.invalid") && crjson.contains("certificate missing required EKU"),
            "expected 'certificate missing required EKU' without trust_config, but got: {crjson}"
        );
        assert!(
            crjson.contains("signingCredential.untrusted"),
            "expected signingCredential.untrusted without trust_config, but got: {crjson}"
        );
    }
}
