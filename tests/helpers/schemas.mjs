// Pulls the zod schema objects out of the built tool files for unit tests.
import { z } from "zod";
import { __test as singleTest } from "../../dist/tools/single.js";
import { __test as proxyTest } from "../../dist/tools/proxy.js";
import { __test as browserTest } from "../../dist/tools/browser.js";

export const single = {
  inputSchema: z.object(singleTest.singleInputShape),
  outputSchema: z.object(singleTest.singleOutputShape),
  headerInfoSchema: singleTest.ResponseHeadersSchema,
  deriveCode: singleTest.deriveCode,
};

export const proxy = {
  inputSchema: z.object(proxyTest.proxyInputShape),
  outputSchema: z.object(proxyTest.proxyOutputShape),
  innerRequestSchema: proxyTest.ProxyInnerRequestSchema,
  headerInfoSchema: proxyTest.ProxyResponseHeadersSchema,
  deriveCode: proxyTest.deriveCode,
};

export const browser = {
  inputSchema: z.object(browserTest.browserInputShape),
  outputSchema: z.object(browserTest.browserOutputShape),
  cdpCookieSchema: browserTest.CdpCookieSchema,
  inputCookieSchema: browserTest.BrowserCookieInputSchema,
  deriveCode: browserTest.deriveCode,
};
