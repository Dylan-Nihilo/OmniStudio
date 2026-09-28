/**
 * Hosted deployments publish the Studio at one canonical address (production:
 * https://studio.omnisline.com/app/, behind the gateway). The same container still answers on
 * its raw host port, and a session started there lives on another origin with its own cookies
 * and auth allowlist entry, so a page loaded anywhere else is sent to the canonical address
 * before the app boots. Routes are hash-based (#/login, #/invite/...), so carrying the hash
 * over keeps the visitor on the same screen.
 *
 * The check has to run before any bundle loads, so it ships as an inline <head> script. It is
 * kept as source text here and the tests execute that exact text.
 */

export function normalizeCanonicalUrl(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_CANONICAL_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_CANONICAL_URL must be http(s): ${raw}`);
  }
  if (url.search || url.hash || !url.pathname.endsWith("/")) {
    // The page is compared by prefix and the hash route is appended verbatim, so the address
    // has to be a directory with nothing after it.
    throw new Error(`NEXT_PUBLIC_CANONICAL_URL must end with "/" and carry no query or hash: ${raw}`);
  }
  return url.origin + url.pathname;
}

export function canonicalRedirectScript(canonicalUrl: string): string {
  const target = JSON.stringify(canonicalUrl).replace(/</g, "\\u003c");
  // Loopback hosts are left alone so the image can still be checked through a tunnel or on
  // the host itself; non-http protocols cover the desktop shells.
  return `(function(c){try{var l=window.location,h=l.hostname;if(l.protocol!=="http:"&&l.protocol!=="https:")return;if(h==="localhost"||h==="127.0.0.1"||h==="[::1]")return;if((l.origin+l.pathname).indexOf(c)===0)return;l.replace(c+l.hash);}catch(e){}})(${target});`;
}
