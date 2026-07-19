interface SaKey {
  client_email: string;
  private_key: string;
}

function sa(): SaKey {
  return JSON.parse(Deno.env.get('GCS_SA_KEY')!);
}

export function bucket(): string {
  return Deno.env.get('GCS_BUCKET')!;
}

const HOST = 'storage.googleapis.com';

/** RFC3986 encode. When `path` is true, '/' is preserved (path segments). */
function enc(s: string, path = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(path ? /%2F/g : /(?!)/g, '/');
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return hex(buf);
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

async function rsaSignHex(privateKeyPem: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  return hex(sig);
}

/**
 * Build a V4 signed URL for the given method/object. `contentType` (upload)
 * is added to the signed headers so the client's PUT must send that exact type.
 */
export async function signedUrl(
  method: 'PUT' | 'GET' | 'DELETE',
  objectPath: string,
  expiresSec: number,
  contentType?: string,
): Promise<string> {
  const { client_email, private_key } = sa();

  const now = new Date();
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const datestamp = stamp.slice(0, 8);
  const scope = `${datestamp}/auto/storage/goog4_request`;
  const credential = `${client_email}/${scope}`;

  const canonicalUri = `/${bucket()}/${enc(objectPath, true)}`;

  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const canonicalHeaders = (contentType ? `content-type:${contentType}\n` : '') + `host:${HOST}\n`;

  const queryParams: Record<string, string> = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': credential,
    'X-Goog-Date': stamp,
    'X-Goog-Expires': String(expiresSec),
    'X-Goog-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map(k => `${enc(k)}=${enc(queryParams[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = await rsaSignHex(private_key, stringToSign);
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

export async function deleteObject(objectPath: string): Promise<void> {
  const url = await signedUrl('DELETE', objectPath, 300);
  const res = await fetch(url, { method: 'DELETE' });
  // 404 is fine — object already gone; anything else is an error.
  if (!res.ok && res.status !== 404) {
    throw new Error(`GCS delete failed (${res.status}).`);
  }
}
