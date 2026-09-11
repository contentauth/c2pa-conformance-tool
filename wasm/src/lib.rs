use c2pa::{Context, Reader};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ManifestCertificateData {
    pub label: String,
    pub is_active: bool,
    pub cert_chain_pem: Option<String>,
    pub issuer_org: Option<String>,
    pub common_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractedCertificatesResult {
    pub active_manifest: Option<String>,
    pub manifests: HashMap<String, ManifestCertificateData>,
}

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

#[wasm_bindgen]
pub async fn read_manifest_store(
    file_bytes: Vec<u8>,
    format: String,
    settings_json: Option<String>,
) -> Result<String, JsValue> {
    let context = build_context(settings_json)?;

    let reader = Reader::from_context(context)
        .with_stream_async(&format, Cursor::new(file_bytes))
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to read C2PA data: {e}")))?;

    Ok(reader.crjson())
}

#[wasm_bindgen]
pub async fn extract_manifest_certificates(
    file_bytes: Vec<u8>,
    format: String,
    settings_json: Option<String>,
) -> Result<String, JsValue> {
    let context = build_context(settings_json)?;

    let reader = Reader::from_context(context)
        .with_stream_async(&format, Cursor::new(file_bytes))
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to read C2PA data: {e}")))?;

    let active_label = reader.active_label().map(|s| s.to_string());
    let mut manifests_map = HashMap::new();

    for (label, manifest) in reader.manifests() {
        let cert_chain_pem = manifest.signature_info().map(|s| s.cert_chain().to_string());
        let issuer_org = manifest.signature_info().and_then(|s| s.issuer.clone());
        let common_name = manifest.signature_info().and_then(|s| s.common_name.clone());
        let is_active = active_label.as_deref() == Some(label.as_str());

        manifests_map.insert(
            label.clone(),
            ManifestCertificateData {
                label: label.clone(),
                is_active,
                cert_chain_pem,
                issuer_org,
                common_name,
            },
        );
    }

    let result = ExtractedCertificatesResult {
        active_manifest: active_label,
        manifests: manifests_map,
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize certificates result: {e}")))
}

/// Validate a detached (`.c2pa`) manifest store against its referenced asset.
///
/// This is the sidecar-with-asset case: the C2PA manifest lives in its own file
/// (`manifest_bytes`) and the asset whose hash-bindings the manifest claims
/// lives separately (`asset_bytes`). We feed both into c2pa-rs's
/// `with_manifest_data_and_stream_async`, which evaluates the asset-hash
/// assertions *against the actual asset bytes* — something we cannot do with
/// the single-blob `read_manifest_store` path.
///
/// * `manifest_bytes` - raw bytes of the `.c2pa` sidecar (JUMBF manifest store).
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

#[wasm_bindgen]
pub async fn extract_sidecar_manifest_certificates(
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
            JsValue::from_str(&format!("Failed to read sidecar C2PA data: {e}"))
        })?;

    let active_label = reader.active_label().map(|s| s.to_string());
    let mut manifests_map = HashMap::new();

    for (label, manifest) in reader.manifests() {
        let cert_chain_pem = manifest.signature_info().map(|s| s.cert_chain().to_string());
        let issuer_org = manifest.signature_info().and_then(|s| s.issuer.clone());
        let common_name = manifest.signature_info().and_then(|s| s.common_name.clone());
        let is_active = active_label.as_deref() == Some(label.as_str());

        manifests_map.insert(
            label.clone(),
            ManifestCertificateData {
                label: label.clone(),
                is_active,
                cert_chain_pem,
                issuer_org,
                common_name,
            },
        );
    }

    let result = ExtractedCertificatesResult {
        active_manifest: active_label,
        manifests: manifests_map,
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize certificates result: {e}")))
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
