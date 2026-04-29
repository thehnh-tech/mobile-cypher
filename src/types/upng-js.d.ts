declare module 'upng-js' {
  export interface DecodedPNG {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown>;
    data: Uint8Array;
  }

  export function decode(buf: ArrayBuffer | Uint8Array): DecodedPNG;
  export function toRGBA8(img: DecodedPNG): ArrayBuffer[];
  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean,
  ): ArrayBuffer;
}
