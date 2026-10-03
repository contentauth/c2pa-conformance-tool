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

// Formats the file pickers offer alongside the browser's image/video/audio families. HEIF
// images and sequences are listed by extension because not every OS maps them to image/*.
const OTHER_ACCEPT = '.pdf,.dng,.arw,.cr2,.cr3,.nef,.orf,.rw2,.heic,.heif,.heics,.heifs'

/** `accept` value for asset pickers (no sidecars). */
export const ASSET_ACCEPT = `image/*,video/*,audio/*,${OTHER_ACCEPT},${TEXT_ACCEPT}`
