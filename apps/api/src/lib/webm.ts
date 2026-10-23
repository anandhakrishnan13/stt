/**
 * Injects a Duration EBML element into a WebM byte stream.
 *
 * MediaRecorder in Chromium generates WebM streams without a Duration header
 * (or with unknown duration), causing HTML5 <audio> to guess duration from
 * buffered byte ranges and jump (e.g. 3s -> 6s -> 9s).
 *
 * By injecting the Duration element into the Segment Info header, audio players
 * and browsers immediately know the true duration and can seek accurately.
 */
export function injectWebmDuration(source: Uint8Array, durationMs: number): Uint8Array {
  if (source.length < 40 || durationMs <= 0) return source;

  // 1. Find Segment Info element ID: 0x15, 0x49, 0xa9, 0x66
  let infoPos = -1;
  const limit = Math.min(source.length - 4, 4096);
  for (let i = 0; i < limit; i++) {
    if (
      source[i] === 0x15 &&
      source[i + 1] === 0x49 &&
      source[i + 2] === 0xa9 &&
      source[i + 3] === 0x66
    ) {
      infoPos = i;
      break;
    }
  }
  if (infoPos === -1) return source;

  // 2. Check if Duration element (0x44, 0x89) is already present in Info
  const searchLimit = Math.min(infoPos + 250, source.length - 10);
  for (let i = infoPos + 4; i < searchLimit; i++) {
    if (source[i] === 0x44 && source[i + 1] === 0x89) {
      const sizeByte = source[i + 2];
      if (sizeByte === 0x84 && i + 7 <= source.length) {
        // 4-byte float32
        const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
        view.setFloat32(i + 3, durationMs, false);
        return source;
      }
      if (sizeByte === 0x88 && i + 11 <= source.length) {
        // 8-byte float64
        const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
        view.setFloat64(i + 3, durationMs, false);
        return source;
      }
    }
  }

  // 3. Read Info size VINT
  const sizePos = infoPos + 4;
  const firstByte = source[sizePos];
  if (firstByte === undefined) return source;

  let numBytes = 1;
  let mask = 0x80;
  while (!(firstByte & mask) && numBytes < 8) {
    mask >>= 1;
    numBytes++;
  }
  let currentInfoSize = firstByte & ~mask;
  for (let i = 1; i < numBytes; i++) {
    const nextByte = source[sizePos + i];
    if (nextByte === undefined) return source;
    currentInfoSize = (currentInfoSize << 8) | nextByte;
  }
  const infoHeaderEnd = sizePos + numBytes;

  // 4. Create Duration element:
  // ID: 0x44, 0x89 (2 bytes)
  // Size: 0x88 (1 byte VINT for 8 bytes float64)
  // Value: 8 bytes IEEE 754 float64 in TimecodeScale units (1ms per tick = durationMs)
  const durElement = new Uint8Array(11);
  durElement[0] = 0x44;
  durElement[1] = 0x89;
  durElement[2] = 0x88;
  const dv = new DataView(durElement.buffer);
  dv.setFloat64(3, durationMs, false);

  const newInfoSize = currentInfoSize + 11;

  if (numBytes === 1 && newInfoSize < 127) {
    const target = new Uint8Array(source.length + 11);
    target.set(source.subarray(0, sizePos), 0);
    target[sizePos] = 0x80 | newInfoSize;
    let writePos = sizePos + 1;
    target.set(durElement, writePos);
    writePos += 11;
    target.set(source.subarray(infoHeaderEnd), writePos);
    return target;
  }

  // Multi-byte VINT fallback
  const sizeBuf: number[] = [];
  let temp = newInfoSize;
  let len = 1;
  while (temp >= Math.pow(2, 7 * len) - 1 && len < 8) len++;
  const marker = 1 << (7 * len);
  const val = marker | newInfoSize;
  for (let i = len - 1; i >= 0; i--) {
    sizeBuf.push((val >> (i * 8)) & 0xff);
  }
  const beforeSize = source.subarray(0, sizePos);
  const afterHeader = source.subarray(infoHeaderEnd);
  const target = new Uint8Array(
    beforeSize.length + sizeBuf.length + durElement.length + afterHeader.length,
  );
  let offset = 0;
  target.set(beforeSize, offset);
  offset += beforeSize.length;
  target.set(new Uint8Array(sizeBuf), offset);
  offset += sizeBuf.length;
  target.set(durElement, offset);
  offset += durElement.length;
  target.set(afterHeader, offset);
  return target;
}
