// How many leading bytes of a file matchesType needs to see.
export const SIGNATURE_BYTES = 4096;

// Whether a file's leading bytes match its declared type, so a file can't be stored as a photo or video it isn't.
// `bytes` (a Uint8Array or Buffer) is the file's first SIGNATURE_BYTES bytes, or the whole file if it is smaller.
// The browser checks before uploading so a bad file is refused straight away; the server checks again when a save
// first uses the file, since only that check can be trusted.
export function matchesType(mime, bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  const startsWith = signature => signature.every((byte, i) => bytes[i] === byte);
  const mp4 = bytes.length >= 16 && ascii(4, 8) === 'ftyp';
  switch (mime) {
    case 'image/png':
      return startsWith([137, 80, 78, 71, 13, 10, 26, 10]);
    case 'image/jpeg':
      return startsWith([255, 216, 255]);
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4':
      return mp4;
    case 'video/quicktime':
      return bytes.length >= 16 && (mp4 || ['moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(4, 8)));
    case 'video/webm':
      return bytes.length >= 16 && startsWith([0x1a, 0x45, 0xdf, 0xa3]) && ascii(0, SIGNATURE_BYTES).includes('webm');
    default:
      return false;
  }
}
