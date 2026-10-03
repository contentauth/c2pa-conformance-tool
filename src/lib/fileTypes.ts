// File-type tables shared by the upload UI and the c2pa-rs bridge (kept free of the WASM loader).

// Text formats, keyed by extension, with the format name c2pa-rs registers for each: plain text
// (C2PA A.8, `unstable_plain_text`) and structured text (C2PA A.9, `unstable_structured_text`).
// Both handlers are experimental (unstable) in c2pa-rs. Browsers report these inconsistently
// (`.yaml` as application/x-yaml, `.ini` and `.toml` as nothing), so the extension wins over the
// browser-reported MIME type. `ini` has no registered MIME type.
export const TEXT_EXTENSION_MIME_MAP: Record<string, string> = {
  'txt': 'text/plain',
  'md': 'text/markdown',
  'markdown': 'text/markdown',
  'yaml': 'application/yaml',
  'yml': 'application/yaml',
  'toml': 'application/toml',
  'ini': 'ini',
  'js': 'text/javascript',
  'mjs': 'text/javascript',
  'css': 'text/css',
  'sql': 'application/sql',
  'tex': 'application/x-tex',
  'py': 'text/x-python',
  'rss': 'application/rss+xml',
  'atom': 'application/atom+xml',
  'vtt': 'text/vtt',
}

/** File-picker `accept` entries for the text formats above. */
export const TEXT_ACCEPT = Object.keys(TEXT_EXTENSION_MIME_MAP).map(ext => `.${ext}`).join(',')

export function fileExtension(file: File): string {
  return file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
}

/** True for the text formats c2pa-rs reads (see TEXT_EXTENSION_MIME_MAP). */
export function isTextFile(file: File): boolean {
  return fileExtension(file) in TEXT_EXTENSION_MIME_MAP
}

// Fonts (OpenType and TrueType, `font/otf` and `font/ttf`). Reading them needs the c2pa-rs font
// handler (contentauth/c2pa-rs#2768), which is not in a c2pa-rs release yet; until then c2pa-rs
// reports them as unsupported. The C2PA specification marks the font `C2PA` table as
// preliminary. Browsers report fonts inconsistently (font/ttf, application/x-font-ttf, or
// nothing), so the extension wins over the browser-reported MIME type.
export const FONT_EXTENSION_MIME_MAP: Record<string, string> = {
  'otf': 'font/otf',
  'ttf': 'font/ttf',
}

/** True for the font formats above. */
export function isFontFile(file: File): boolean {
  return fileExtension(file) in FONT_EXTENSION_MIME_MAP
}

// Machine-learning model and dataset formats, with the format name each c2pa-rs handler
// registers. None is in a c2pa-rs release yet; until the handler PR listed for each is merged,
// c2pa-rs reports them as unsupported. Browsers report no MIME type for these.
export const ML_FORMATS: Record<string, { format: string; label: string; pr: number }> = {
  'safetensors': { format: 'safetensors', label: 'SafeTensors model', pr: 2769 },
  'onnx': { format: 'onnx', label: 'ONNX model', pr: 2770 },
  'parquet': { format: 'application/vnd.apache.parquet', label: 'Apache Parquet dataset', pr: 2771 },
  'keras': { format: 'keras', label: 'Keras model', pr: 2775 },
}

/** The ML format entry for a file, by extension. */
export function mlFormatOf(file: File): (typeof ML_FORMATS)[string] | undefined {
  return ML_FORMATS[fileExtension(file)]
}

/** The ML format entry for a format name passed to c2pa-rs. */
export function mlFormatByName(format: string): (typeof ML_FORMATS)[string] | undefined {
  return Object.values(ML_FORMATS).find(f => f.format === format)
}

// Formats the file pickers offer alongside the browser's image/video/audio families.
const OTHER_ACCEPT = '.pdf,.dng,.arw,.cr2,.cr3,.nef,.orf,.rw2'
const FONT_ACCEPT = Object.keys(FONT_EXTENSION_MIME_MAP).map(ext => `.${ext}`).join(',')
const ML_ACCEPT = Object.keys(ML_FORMATS).map(ext => `.${ext}`).join(',')

/** `accept` value for asset pickers (no sidecars). */
export const ASSET_ACCEPT = `image/*,video/*,audio/*,${OTHER_ACCEPT},${FONT_ACCEPT},${ML_ACCEPT},${TEXT_ACCEPT}`
