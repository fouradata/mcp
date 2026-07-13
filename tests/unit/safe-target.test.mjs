import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertPublicTarget, SsrfBlockedError } from "../../dist/safe-target.js";
import { TEST_SITES } from "../helpers/sites.mjs";

async function isBlocked(url) {
  try {
    await assertPublicTarget(url);
    return false;
  } catch (e) {
    if (e instanceof SsrfBlockedError) return true;
    throw e;
  }
}

describe("safe-target - public hosts (must NOT block)", () => {
  test("1. example.com", async () => assert.equal(await isBlocked(TEST_SITES.static), false));
  test("2. 1.1.1.1 (Cloudflare)", async () => assert.equal(await isBlocked("https://1.1.1.1"), false));
  test("3. 8.8.8.8 (Google DNS)", async () => assert.equal(await isBlocked("https://8.8.8.8"), false));
  test("4. 2606:4700:4700::1111 IPv6", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.cloudflare_v6), false));
  test("5. 172.32.0.0 just outside RFC1918", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.just_outside_172), false));
  test("6. api.foura.ai resolves public", async () => assert.equal(await isBlocked("https://api.foura.ai"), false));
});

describe("safe-target - private/reserved hosts (must block)", () => {
  test("7. 127.0.0.1 loopback", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.loopback), true));
  test("8. 127.0.0.255 loopback edge", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.loopback_high), true));
  test("9. localhost DNS->loopback", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.localhost), true));
  test("10. 0.0.0.0", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.any), true));
  test("11. 10.0.0.1 RFC1918", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.rfc1918_10), true));
  test("12. 172.16.0.1 RFC1918", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.rfc1918_172), true));
  test("13. 172.31.255.255 RFC1918 edge", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.rfc1918_172_edge), true));
  test("14. 192.168.1.1 RFC1918", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.rfc1918_192), true));
  test("15. 192.168.255.255 RFC1918 edge", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.rfc1918_192_edge), true));
  test("16. 169.254.169.254 AWS metadata", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.aws_metadata), true));
  test("17. 100.64.0.1 CGNAT", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.cgnat), true));
  test("18. 100.127.255.254 CGNAT edge", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.cgnat_edge), true));
  test("19. 224.0.0.1 multicast", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.multicast), true));
  test("20. 198.18.0.1 benchmarking", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.benchmarking), true));
  test("21. [::1] IPv6 loopback", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_loopback), true));
  test("22. [::] IPv6 any", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_any), true));
  test("23. [fe80::1] IPv6 link-local", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_linklocal), true));
  test("24. [fc00::1] IPv6 ULA", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_ula), true));
  test("25. [2001:db8::1] IPv6 documentation", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_doc), true));
  test("26. [::ffff:192.168.1.1] IPv4-mapped private", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ipv6_v4mapped), true));
  test("27. ftp:// unsupported scheme", async () => assert.equal(await isBlocked(TEST_SITES.ssrf.ftp_scheme), true));
  test("28. malformed URL throws", async () => {
    let threw = false;
    try {
      await assertPublicTarget("not-a-url");
    } catch (e) {
      threw = e instanceof SsrfBlockedError;
    }
    assert.equal(threw, true);
  });
});
