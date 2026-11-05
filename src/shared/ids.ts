const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time: number, length: number): string {
  let value = time;
  let out = '';
  for (let i = length - 1; i >= 0; i -= 1) {
    const mod = value % 32;
    out = ENCODING[mod] + out;
    value = (value - mod) / 32;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ENCODING[byte % 32];
  return out;
}

/** ULID قابل للترتيب الزمني — بلا اعتماد خارجي. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}

export type IdPrefix =
  | 'evt'
  | 'job'
  | 'vol'
  | 'ast'
  | 'bat'
  | 'rev'
  | 'pub'
  | 'aud'
  | 'sty'
  | 'off'
  | 'usr'
  | 'task'
  | 'arc'
  | 'mov'
  | 'edt';

export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${ulid(now)}`;
}

export function isId(value: string, prefix?: IdPrefix): boolean {
  const pattern = prefix ? new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`) : /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/;
  return pattern.test(value);
}
