// Real-site catalog - single source of truth for every test URL.
// When a site's shape changes or a domain rotates, edit this file.

export const TEST_SITES = {
  // Sanity baselines - stable, free
  static: "https://example.com",
  static_org: "https://example.org",

  // httpbin - http-behavior coverage (stable + free)
  json: "https://httpbin.org/json",
  cookies_set: "https://httpbin.org/cookies/set?a=1&b=2",          // regression source
  cookies_set_single: "https://httpbin.org/cookies/set?solo=only",
  cookies_set_triple: "https://httpbin.org/cookies/set?a=1&b=2&c=3",
  cookies_read: "https://httpbin.org/cookies",
  echo_headers: "https://httpbin.org/headers",
  echo_anything: "https://httpbin.org/anything",
  ip: "https://httpbin.org/ip",
  redirect_3: "https://httpbin.org/redirect/3",
  delay: (sec) => `https://httpbin.org/delay/${sec}`,
  status: (code) => `https://httpbin.org/status/${code}`,
  basic_auth: "https://httpbin.org/basic-auth/user/pass",

  // Real BG e-commerce (a real-world
  techmart_phone: "https://techmart.bg/smartfon-samsung-sm-a366b-galaxy-a36-5g-6128gb-black",
  techmart_home: "https://techmart.bg",

  // Real BG marketplace
  onlinemashini: "https://www.onlinemashini.com",

  // Large static (offload trigger when offload_large:true)
  wikipedia: "https://en.wikipedia.org/wiki/Web_scraping",
  hackernews: "https://news.ycombinator.com/",

  // Anti-bot territory - loose checks, may change
  google_search: "https://www.google.com/search?q=mcp+server",

  // SSRF targets - must always block
  ssrf: {
    loopback: "http://127.0.0.1",
    loopback_high: "http://127.0.0.255",
    localhost: "http://localhost",
    any: "http://0.0.0.0",
    rfc1918_10: "http://10.0.0.1",
    rfc1918_172: "http://172.16.0.1",
    rfc1918_192: "http://192.168.1.1",
    rfc1918_192_edge: "http://192.168.255.255",
    rfc1918_172_edge: "http://172.31.255.255",
    just_outside_172: "http://172.32.0.0",       // public, must NOT block
    cgnat: "http://100.64.0.1",
    cgnat_edge: "http://100.127.255.254",
    aws_metadata: "http://169.254.169.254/latest/meta-data/",
    multicast: "http://224.0.0.1",
    benchmarking: "http://198.18.0.1",
    ipv6_loopback: "http://[::1]",
    ipv6_any: "http://[::]",
    ipv6_linklocal: "http://[fe80::1]",
    ipv6_ula: "http://[fc00::1]",
    ipv6_doc: "http://[2001:db8::1]",
    ipv6_v4mapped: "http://[::ffff:192.168.1.1]",
    cloudflare_v6: "http://[2606:4700:4700::1111]",  // public, must NOT block
    ftp_scheme: "ftp://example.com",
    malformed: "http://[gibberish]",
  },
};
