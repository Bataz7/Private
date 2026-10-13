/** node:crypto — createHash عبر tjs:hashing، و randomUUID من WebCrypto. */
// @ts-ignore — وحدة مدمجة في txiki
import { createHash as tjsHash } from "tjs:hashing";

export function createHash(alg: string) {
  const h = tjsHash(alg.toLowerCase());
  const api = {
    update(data: string | Uint8Array) {
      h.update(data);
      return api;
    },
    digest(enc = "hex"): string {
      return h.digest(enc);
    },
  };
  return api;
}

export const randomUUID = () => (globalThis as any).crypto.randomUUID();
export default { createHash, randomUUID };
