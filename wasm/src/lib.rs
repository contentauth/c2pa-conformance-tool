use c2pa::{Context, Reader};
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
