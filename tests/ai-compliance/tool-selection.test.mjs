// AI tool-selection — does Claude pick the right tool for a wide range of
// REAL client tasks? Covers 12 domain categories × multiple framings.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../integration-stdio/_common.mjs";
import { pickTool, isAIAvailable } from "./_judge.mjs";

let toolDefs;
let aiOk;

before(async () => {
  aiOk = await isAIAvailable();
  if (!aiOk) return;
  const client = await startServer();
  try {
    const tools = await client.listTools();
    toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  } finally {
    await client.close();
  }
});

// Each case lists `accept` — array of acceptable tool names. Most have one;
// some are genuinely ambiguous and allow two.
const CASES = [
  // ───────── Simple HTTP / API ─────────
  { name: "01. plain HTML fetch", task: "Fetch the HTML of https://example.com as fast as possible.", accept: ["foura_single"] },
  { name: "02. JSON REST API with auth header", task: "Hit https://api.example.com/v1/users with an Authorization: Bearer token and parse the JSON.", accept: ["foura_single"] },
  { name: "03. simple health-check ping", task: "Just check if https://example.com responds at all.", accept: ["foura_single"] },
  { name: "04. fetch sitemap.xml", task: "Download https://example.com/sitemap.xml as text.", accept: ["foura_single"] },
  { name: "05. GraphQL POST", task: "Send a GraphQL POST to https://api.example.com/graphql with a JSON body {query:'...'}.", accept: ["foura_single"] },
  { name: "06. WebDAV PROPFIND", task: "Send a PROPFIND request to https://dav.example.com/calendar/ with Depth:1.", accept: ["foura_single"] },
  { name: "07. binary image download", task: "Download a PNG image from https://images.example.com/logo.png as base64.", accept: ["foura_single"] },
  { name: "08. server-rendered HN", task: "Get the front page of news.ycombinator.com.", accept: ["foura_single"] },

  // ───────── Proxy / anti-bot ─────────
  { name: "09. IP-blocked 403, plain HTML", task: "I keep getting 403 Forbidden from https://shop.example.com — it's plain server-rendered HTML, no JavaScript, just my IP is blocked. Rotate egress.", accept: ["foura_proxy"] },
  { name: "10. geo-blocked site, no JS", task: "https://news.example.bg returns 403 from my US IP. The content is static HTML. Try from a Bulgarian-looking IP.", accept: ["foura_proxy"] },
  { name: "11. rate-limit 429 — switch to fresh IP", task: "I'm hitting 429 Too Many Requests on https://api.public.example.com from a single IP. Distribute across IPs.", accept: ["foura_proxy"] },
  // v0.3.0: with foura_auto as the smart default, friction/ambiguous "get me the
  // content past a block" tasks legitimately route to auto (it escalates to
  // proxy/browser internally). accept widened to include it — this is the intended
  // default-first behavior, not a regression.
  { name: "12. SERP scrape — Google", task: "Scrape Google search results for 'mcp server' — the page is server-rendered but blocks scrapers from cloud IPs.", accept: ["foura_proxy", "foura_browser", "foura_auto"] },
  { name: "13. cloud-IP fingerprint block", task: "AWS IP block at https://app.example.com — page is plain HTML, no JS challenge.", accept: ["foura_proxy"] },

  // ───────── Browser / JS / SPA ─────────
  { name: "14. SPA product page price", task: "Scrape the current price from a single-page-app store at https://shop.example.com/p/123 — the price loads via JavaScript after a few hundred ms.", accept: ["foura_browser", "foura_auto"] },
  { name: "15. lazy-loaded content after scroll", task: "Get the full product list at https://catalog.example.com — items load as you scroll.", accept: ["foura_browser"] },
  { name: "16. CDP cookies after navigation", task: "I need the full cookies (HttpOnly, sameSite, etc.) set by https://app.example.com after the page loads its JS.", accept: ["foura_browser"] },
  { name: "17. JS-rendered article", task: "Scrape the article body from https://medium.com/article-slug — content loads via React.", accept: ["foura_browser"] },
  { name: "18. Cloudflare JS challenge", task: "https://shop.example.com runs a Cloudflare JS challenge that takes 5 seconds. Get past it.", accept: ["foura_browser"] },
  { name: "19. custom UA + cookies render", task: "Load https://example.com in a browser session with a custom User-Agent and pre-set session cookies.", accept: ["foura_browser"] },
  { name: "20. browser click-through", task: "I need to navigate to https://example.com, wait for the cookie consent banner, and capture cookies that the page sets after consent.", accept: ["foura_browser"] },

  // ───────── E-commerce real-world ─────────
  { name: "21. Bulgarian e-com product (techmart)", task: "Get title, price, image, stock for https://techmart.bg/smartfon-samsung — it's a single-page app.", accept: ["foura_browser"] },
  { name: "22. classifieds listing", task: "Fetch a real-estate listing from https://imot.bg/listing/12345 — server-rendered HTML with images.", accept: ["foura_single", "foura_proxy"] },

  // ───────── News / articles ─────────
  { name: "23. NYT article behind paywall metadata", task: "Get the article title, author, date, summary from https://nytimes.com/2026/05/14/tech.html — server-rendered.", accept: ["foura_single", "foura_proxy", "foura_auto"] },
  { name: "24. financial filing PDF", task: "Download a 10-K filing PDF from https://sec.gov/Archives/edgar/data/foo.pdf as base64.", accept: ["foura_single"] },

  // ───────── Real client patterns ─────────
  { name: "25. captcha visible — no JS challenge", task: "Page https://service.example.com shows a captcha image but otherwise the HTML is static. The IP triggers the captcha — rotating IP fixes it.", accept: ["foura_proxy"] },
  { name: "26. captcha + JS challenge mixed", task: "Page https://service.example.com renders a Turnstile JS widget that requires a real browser to solve.", accept: ["foura_browser"] },
  { name: "27. RSS feed", task: "Fetch the RSS feed at https://blog.example.com/feed.xml — static XML.", accept: ["foura_single"] },
  { name: "28. OG metadata only", task: "Get just the og:image and og:title from https://example.com/article — first 8KB of HTML is enough.", accept: ["foura_single"] },
  { name: "29. JSON webhook handler", task: "Send a JSON POST to https://hooks.example.com/incoming and read the response.", accept: ["foura_single"] },
  { name: "30. login form with JS-driven submission", task: "I need to log into https://app.example.com that uses JavaScript-driven form submission — the submit button triggers JS code that builds the request, the form doesn't POST directly. After login I need the session cookies.", accept: ["foura_browser"] },

  // ───────── WAF escalation regression (v0.2.10 driver) ─────────
  // Without these, an agent re-introducing the v0.2.10 failure mode (giving up on
  // a Vercel/CF/Akamai target instead of using foura_proxy with maxTries:25-30)
  // would ship silently.
  { name: "31. Vercel Security Checkpoint", task: "foura_single returned 429 from https://iqair.com/bulgaria/sofia with header x-vercel-mitigated: challenge and body title 'Vercel Security Checkpoint'. I still need that page.", accept: ["foura_proxy"] },
  { name: "32. Cloudflare 'Just a moment' challenge", task: "foura_single came back with title 'Just a moment...' and header cf-mitigated: challenge from https://shop.example.com. Need the underlying content.", accept: ["foura_proxy"] },
  { name: "33. chain after proxy cleared the WAF", task: "foura_proxy cleared the Vercel challenge for https://iqair.com/bulgaria/sofia and returned proxy ID '5SF2A2'. The page is a single-page-app that needs JS to render the AQI value. What's next?", accept: ["foura_browser"] },

  // ───────── Auto — smart-default orchestrator (v0.3.0 driver) ─────────
  // The agent should reach for foura_auto when the task is "just get me the
  // content" and the right method (single / proxy / browser) is unknown or
  // explicitly delegated. Explicit-method tasks above must still pick the
  // primitive — these cases guard the delegated/uncertain framing only.
  { name: "34. just get the content, pick the method", task: "Just get me the content of https://example.com — I don't care how you fetch it, pick whatever method works best.", accept: ["foura_auto"] },
  { name: "35. unknown defenses, fetch it for me", task: "Fetch the page at https://shop.example.com/p/123. I don't know whether it's blocked, geo-fenced, or needs JavaScript — figure it out and just give me the page content.", accept: ["foura_auto"] },
  { name: "36. one URL, handle escalation automatically", task: "Here's a URL: https://news.example.com/article. Get past whatever anti-bot protection it has automatically and return the article HTML. Don't make me choose between proxy and browser.", accept: ["foura_auto"] },
  { name: "37. smartest/cheapest path to content", task: "Scrape https://www.onlinemashini.com using the smartest, cheapest path that actually works — escalate only if you have to.", accept: ["foura_auto"] },
];

describe("AI tool-selection — broad real-world coverage", () => {
  for (const c of CASES) {
    test(c.name, async (t) => {
      if (!aiOk) return t.skip("claude -p unavailable");
      const picked = await pickTool(c.task, toolDefs);
      assert.ok(
        c.accept.includes(picked),
        `task: "${c.task}"\nexpected one of ${JSON.stringify(c.accept)}, got "${picked}"`,
      );
    });
  }
});
