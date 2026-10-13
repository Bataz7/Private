import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

// Fetches a user-supplied URL without letting it reach this machine or the private network (SSRF).
// Only https, every redirect hop is re-checked, the body is streamed with a hard size cap, and the address is checked at
// connection time (inside the socket's own DNS lookup), so a name cannot resolve to a public address for the check and to a
// private one for the connection (DNS rebinding).

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96], ['100::', 64], ['2001::', 32], ['2002::', 16], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

// BlockList also understands IPv4-mapped IPv6 (::ffff:127.0.0.1 and its ::ffff:7f00:1 form) against the IPv4 rules.
export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (!family) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function assertPublicHost(url: URL) {
  if (url.protocol !== 'https:') throw new Error('Only https links are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('That address is not allowed.');
  if (isIP(host) && isPrivateAddress(host)) throw new Error('That address is not allowed.');
}

// The socket resolves the name itself; anything private in the answer refuses the connection.
function guardedLookup(hostname: string, options: any, callback: (...args: any[]) => void) {
  dnsLookup(hostname, { all: true, family: options?.family || 0 }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) return callback(new Error('That address is not allowed.'));
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

type Hop = { redirect: URL } | { body: Buffer };

function fetchOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { lookup: guardedLookup as any, timeout: timeoutMs, headers: { 'user-agent': 'RiftBot/1.0', accept: '*/*' } }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) { response.resume(); try { return resolve({ redirect: new URL(location, url) }); } catch { return reject(new Error('Bad redirect.')); } }
      if (status < 200 || status >= 300) { response.resume(); return reject(new Error(`Download failed (${status}).`)); }
      if (Number(response.headers['content-length'] || 0) > maxBytes) { request.destroy(); return reject(new Error('File is too large.')); }
      const chunks: Buffer[] = []; let total = 0;
      response.on('data', (chunk: Buffer) => { total += chunk.length; if (total > maxBytes) { request.destroy(); return reject(new Error('File is too large.')); } chunks.push(chunk); });
      response.on('end', () => resolve({ body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('The download took too long.')));
    request.on('error', reject);
    request.end();
  });
}

export async function safeFetchBuffer(input: string, { maxBytes = 10 * 1024 * 1024, timeoutMs = 15_000, maxRedirects = 3 } = {}) {
  let url = new URL(input);
  for (let hop = 0; ; hop += 1) {
    assertPublicHost(url);
    const result = await fetchOnce(url, maxBytes, timeoutMs);
    if ('body' in result) return result.body;
    if (hop >= maxRedirects) throw new Error('Too many redirects.');
    url = result.redirect;
  }
}
