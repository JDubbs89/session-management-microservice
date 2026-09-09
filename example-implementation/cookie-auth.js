// The API verifies the JWT. The game never accepts a decoded claim as authentication.
export const COOKIE_NAME = 'trivia_token';

export function readToken(req) {
  const values = (req.headers.cookie || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  try {
    const token = decodeURIComponent(values[0].slice(COOKIE_NAME.length + 1));
    return token.length > 0 && token.length <= 4096 ? token : null;
  } catch { return null; }
}

// Call only after api.me(token) succeeds. This sets an earlier local expiry;
// signature/revocation/role verification remains the API's responsibility.
export function expiresAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) return payload.exp * 1000;
  } catch { /* Reject API responses that are not expiring JWTs. */ }
  throw Object.assign(new Error('The authentication service returned an invalid session.'), { status: 502 });
}

export function cookie(token, expiry, secure) {
  const maxAge = token ? Math.max(0, Math.floor((expiry - Date.now()) / 1000)) : 0;
  return `${COOKIE_NAME}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function jsonBody(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    throw Object.assign(new Error('Use a JSON request body.'), { status: 415 });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try {
    const value = JSON.parse(body || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
}
