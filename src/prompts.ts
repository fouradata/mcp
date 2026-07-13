import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP Prompts - pre-written workflow templates the user can invoke from the
 * MCP client UI (Claude Desktop / Cursor / etc) instead of figuring out the
 * tool orchestration themselves.
 *
 * Prompt text enters the model context only when the user invokes it,
 * unlike tool descriptions which are loaded on every turn. So we can be more
 * verbose here.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "scrape_product_page",
    {
      title: "Scrape a product page",
      description:
        "Fetch an e-commerce product URL and extract structured product info as JSON (title, price, image, availability).",
      argsSchema: {
        url: z.string().describe("Product page URL (any e-commerce site)"),
      },
    },
    ({ url }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fetch the product page at ${url} using the foura_browser tool - most product pages are single-page apps and need JavaScript to render.\n\n` +
              `From the response body extract:\n` +
              `- product title\n` +
              `- price (with currency)\n` +
              `- primary product image URL (absolute, not relative)\n` +
              `- availability / stock status\n` +
              `- product SKU or ID if visible\n\n` +
              `If the response body is large (you'll see a resource_link instead of inline HTML), call resources/read on that URI to get the full page.\n\n` +
              `Return the result as JSON:\n` +
              `{"title": "...", "price": 0, "currency": "USD", "image_url": "...", "in_stock": true, "sku": "..."}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "extract_article",
    {
      title: "Extract an article",
      description:
        "Fetch a news/blog article URL and extract the main content (headline, author, body, date) stripped of nav/ads/footer.",
      argsSchema: {
        url: z.string().describe("Article URL"),
      },
    },
    ({ url }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fetch ${url} using the foura_single tool with unblocker:true. Most news and blog sites are server-rendered, so start with HTTP.\n\n` +
              `If foura_single returns a 403, captcha page, or empty content, retry the same URL with foura_proxy (maxTries:3) - it routes through a rotating proxy pool.\n\n` +
              `From the response, extract:\n` +
              `- headline (the main H1, not the page title bar)\n` +
              `- author byline (may be inside .author / [rel=author] / itemprop)\n` +
              `- publication date (look for <time>, .published, or JSON-LD)\n` +
              `- main article body (strip navigation, ads, related-content, footer, comments)\n` +
              `- canonical URL (rel=canonical or og:url)\n\n` +
              `Return as JSON:\n` +
              `{"title": "...", "author": "...", "date_published": "ISO8601", "body": "...", "canonical_url": "..."}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "monitor_pricing",
    {
      title: "Monitor a price",
      description:
        "Fetch a pricing page and extract the current price; compare to a target if provided.",
      argsSchema: {
        url: z.string().describe("Pricing or product page URL"),
        target_price: z
          .string()
          .optional()
          .describe("Optional target price to compare against (e.g. \"19.99\")"),
      },
    },
    ({ url, target_price }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Use the foura_proxy tool with maxTries:5 and unblocker:true to fetch ${url}. Pricing pages often have aggressive bot detection, so go through the proxy pool from the start.\n\n` +
              `Extract the current price (look for visible $/€/£ amounts, JSON-LD Offer schema, [itemprop=price]).\n\n` +
              (target_price
                ? `Compare against target price ${target_price}: report whether current is below/at/above target, and the absolute difference.\n\n`
                : "") +
              `Return as JSON:\n` +
              `{"url": "...", "current_price": 0.00, "currency": "USD"` +
              (target_price
                ? `, "target_price": ${target_price}, "difference": 0, "status": "below|at|above"`
                : "") +
              `}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "check_endpoint_health",
    {
      title: "Check API endpoint health",
      description:
        "GET a URL through foura_single with strict validation and report whether it's reachable and responding correctly.",
      argsSchema: {
        url: z.string().describe("HTTP endpoint URL to probe"),
        expected_text: z
          .string()
          .optional()
          .describe("Optional substring that must appear in the response body for the endpoint to count as healthy"),
      },
    },
    ({ url, expected_text }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Use the foura_single tool with GET on ${url}, timeout_ms:5000, and validate.status.accept:[200].` +
              (expected_text
                ? ` Also set validate.data.accept:["${expected_text}"] so the request only counts as success when the body contains "${expected_text}".`
                : "") +
              `\n\nReport:\n` +
              `- reachable (true if a response came back at all, false on connection error/timeout)\n` +
              `- status_code (HTTP code from target)\n` +
              `- total_time_ms (from the total_time field)\n` +
              `- validation_passed (true if status + body validation conditions were met)\n\n` +
              `Return as JSON:\n` +
              `{"url": "...", "reachable": true, "status_code": 200, "total_time_ms": 0, "validation_passed": true}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "bulk_fetch_urls",
    {
      title: "Fetch a list of URLs in parallel",
      description:
        "Fetch multiple URLs concurrently and return each outcome. Retry blocked URLs through foura_proxy.",
      argsSchema: {
        urls: z.string().describe("Comma-separated list of URLs to fetch"),
      },
    },
    ({ urls }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Parse the following comma-separated URLs and fetch each one concurrently using foura_single (unblocker:true).\n\n` +
              `URLs: ${urls}\n\n` +
              `For any URL that returns 403, captcha page, or empty body - retry that single URL with foura_proxy (maxTries:3).\n\n` +
              `Return a JSON array, one entry per URL in input order:\n` +
              `[{"url": "...", "status": 200, "success": true, "body_size_bytes": 0, "via": "single|proxy", "error": null}, ...]\n\n` +
              `Return only metadata, not full response bodies. If the caller needs body content, they should call foura_single individually.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "smart_fetch",
    {
      title: "Fetch a URL the smart way (auto)",
      description:
        "Fetch any URL with foura_auto - one call that picks the method (direct / proxy / browser), gets past common bot protection, and returns the content. Use when you just want the page and don't want to choose a tool.",
      argsSchema: {
        url: z.string().describe("URL to fetch"),
        must_contain: z
          .string()
          .optional()
          .describe("Optional substring the real page must contain - lets auto tell a real page from a challenge page on protected targets."),
        extract: z
          .string()
          .optional()
          .describe("Optional plain-English description of what to pull out of the page (e.g. \"title, price, image\")."),
      },
    },
    ({ url, must_contain, extract }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fetch ${url} using the foura_auto tool. It picks the fetch method for you (direct request, rotating proxy, or full browser) and gets past common bot protection automatically - you do not need to choose between foura_single / foura_proxy / foura_browser.\n\n` +
              (must_contain
                ? `Pass validate.data.accept:["${must_contain}"] so auto keeps escalating until the real page (containing "${must_contain}") comes back, not a challenge page.\n\n`
                : `If the first response looks like a challenge / block page rather than real content, re-call with validate.data.accept:["<a string the real page must contain>"] so auto knows what success looks like.\n\n`) +
              `The response includes completion details and a session ({proxy, cookies, userAgent}). For more pages from the same site, pass session.proxy into the proxy field of foura_single or foura_proxy.\n\n` +
              (extract
                ? `From the returned content, extract: ${extract}. Return the result as JSON.`
                : `Return the fetched content (or a concise summary of it, if it is large).`),
          },
        },
      ],
    }),
  );
}
