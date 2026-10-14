/**
 * A zip of a few files, stored as they are: a shared book downloaded as its pages (share/share.ts). Markdown is small
 * and a book is a handful of pages, so nothing is compressed, and a zip with nothing compressed is simple enough to
 * write here rather than bring in a library for it. Every archive tool opens it.
 */

export interface ZipFile {
  name: string;
  bytes: Uint8Array;
}

let table: Uint32Array | null = null;

/** CRC-32, the one zip asks for. */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The files as one zip. Names are written in UTF-8 (the flag says so), so a title in any script survives. */
export function zipFiles(files: readonly ZipFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(8, 0, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, file.bytes.length, true);
    l.setUint32(22, file.bytes.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, file.bytes.length, true);
    c.setUint32(24, file.bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, file.bytes);
    centrals.push(central);
    offset += local.length + file.bytes.length;
  }
  const size = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
