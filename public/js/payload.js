// Helpers for the decoded QR payload. The raw bytes are the source of truth
// (they travel base64-encoded); `text` is the decoder's reading of them.

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Human-readable form of a payload: the decoded text when there is one,
 * otherwise UTF-8 if the bytes are valid UTF-8, otherwise a hex preview.
 */
export function describe(text, bytes) {
  if (text) return { text, binary: false };
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (decoded) return { text: decoded, binary: false };
  } catch {
    // not UTF-8
  }
  const hex = Array.from(bytes.subarray(0, 96), (b) => b.toString(16).padStart(2, '0')).join(' ');
  return { text: bytes.length > 96 ? `${hex} …` : hex, binary: true, fullHex: () => toHex(bytes) };
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
