import { describe, expect, it, vi } from "vitest";

import { canonicalRedirectScript, normalizeCanonicalUrl } from "@/lib/canonicalRedirect";

const CANONICAL = "https://studio.omnisline.com/app/";

function runAt(href: string, canonical = CANONICAL) {
  const url = new URL(href);
  const replace = vi.fn();
  const location = {
    protocol: url.protocol,
    hostname: url.hostname,
    origin: url.origin,
    pathname: url.pathname,
    hash: url.hash,
    replace,
  };
  new Function("window", canonicalRedirectScript(canonical))({ location });
  return replace;
}

describe("canonical redirect", () => {
  it("sends the raw host port to the canonical address and keeps the hash route", () => {
    expect(runAt("http://47.236.165.75:3000/#/invite/abc").mock.calls).toEqual([
      [`${CANONICAL}#/invite/abc`],
    ]);
    expect(runAt("http://47.236.165.75:3000/").mock.calls).toEqual([[CANONICAL]]);
  });

  it("leaves the canonical address itself alone", () => {
    expect(runAt(`${CANONICAL}#/login`)).not.toHaveBeenCalled();
    expect(runAt(`${CANONICAL}index.html`)).not.toHaveBeenCalled();
  });

  it("redirects the gateway root fallback and plain http on the canonical host", () => {
    expect(runAt("https://studio.omnisline.com/unknown")).toHaveBeenCalledWith(CANONICAL);
    expect(runAt("http://studio.omnisline.com/app/#/login")).toHaveBeenCalledWith(
      `${CANONICAL}#/login`,
    );
  });

  it("never redirects loopback hosts or desktop shells", () => {
    expect(runAt("http://localhost:3000/")).not.toHaveBeenCalled();
    expect(runAt("http://127.0.0.1:3000/")).not.toHaveBeenCalled();
    expect(runAt("http://[::1]:3000/")).not.toHaveBeenCalled();
    expect(runAt("tauri://localhost/")).not.toHaveBeenCalled();
  });

  it("escapes the address so it cannot close the inline script", () => {
    expect(canonicalRedirectScript("https://x.test/</script>/")).not.toContain("</script>");
  });
});

describe("normalizeCanonicalUrl", () => {
  it("treats an unset value as no redirect", () => {
    expect(normalizeCanonicalUrl(undefined)).toBeNull();
    expect(normalizeCanonicalUrl("  ")).toBeNull();
  });

  it("accepts a directory address", () => {
    expect(normalizeCanonicalUrl(" https://Studio.Omnisline.com/app/ ")).toBe(CANONICAL);
  });

  it("fails the build on addresses the prefix check cannot handle", () => {
    expect(() => normalizeCanonicalUrl("studio.omnisline.com/app/")).toThrow();
    expect(() => normalizeCanonicalUrl("https://studio.omnisline.com/app")).toThrow();
    expect(() => normalizeCanonicalUrl("https://studio.omnisline.com/app/?x=1")).toThrow();
    expect(() => normalizeCanonicalUrl("ftp://studio.omnisline.com/app/")).toThrow();
  });
});
