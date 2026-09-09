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
