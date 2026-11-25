/**
 * Rewrites every DOS modification time/date in a ZIP archive (local file headers and the
 * central directory) to a fixed value, so XLSX files generated from the same data are
 * byte-for-byte identical. ExcelJS stamps entries with the current time otherwise, which
 * would break checksum verification on re-download.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;

/** DOS time 00:00:00, DOS date 1980-01-01 (the minimum representable date). */
const FIXED_TIME = 0;
const FIXED_DATE = (0 << 9) | (1 << 5) | 1;

export function normalizeZipTimestamps(input: Uint8Array): Buffer {
  const buf = Buffer.from(input);
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: end of central directory not found');

  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('Corrupt ZIP central directory');
    buf.writeUInt16LE(FIXED_TIME, p + 12);
    buf.writeUInt16LE(FIXED_DATE, p + 14);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error('Corrupt ZIP local header');
    buf.writeUInt16LE(FIXED_TIME, localOffset + 10);
    buf.writeUInt16LE(FIXED_DATE, localOffset + 12);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return buf;
}
