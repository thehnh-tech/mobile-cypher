// Hermes' built-in TextDecoder only supports utf-8 and utf-16. fast-png (and
// other libs that read text chunks from binary formats) constructs
// `new TextDecoder('latin1')` at module load and crashes the bundle with
// "RangeError: Unknown encoding: latin1". We wrap the global TextDecoder so
// latin1 / iso-8859-1 / windows-1252 fall back to a tiny manual decoder
// (latin1 is just byte → char-code identity for 0..255).
//
// MUST be imported before any module that constructs TextDecoder('latin1') —
// keep it as one of the very first imports in App.tsx.

const NativeTextDecoder: typeof TextDecoder | undefined =
  (globalThis as any).TextDecoder;

if (NativeTextDecoder) {
  const isLatin1 = (enc?: string) => {
    if (!enc) return false;
    const e = enc.toLowerCase();
    return (
      e === 'latin1' ||
      e === 'iso-8859-1' ||
      e === 'iso8859-1' ||
      e === 'windows-1252'
    );
  };

  function Patched(this: any, encoding?: string, options?: TextDecoderOptions) {
    if (isLatin1(encoding)) {
      return {
        encoding: 'iso-8859-1',
        fatal: !!options?.fatal,
        ignoreBOM: !!options?.ignoreBOM,
        decode(input?: BufferSource): string {
          if (!input) return '';
          const bytes =
            input instanceof Uint8Array
              ? input
              : ArrayBuffer.isView(input)
                ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
                : new Uint8Array(input as ArrayBuffer);
          let out = '';
          // Chunk to avoid argument-count limits on String.fromCharCode.
          const CHUNK = 4096;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            out += String.fromCharCode.apply(
              null,
              Array.from(bytes.subarray(i, i + CHUNK)),
            );
          }
          return out;
        },
      };
    }
    return new NativeTextDecoder!(encoding as any, options);
  }
  Patched.prototype = NativeTextDecoder.prototype;
  (globalThis as any).TextDecoder = Patched;
}
