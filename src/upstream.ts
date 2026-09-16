/**
 * Signals the FourA API publishes in response HEADERS rather than in the body,
 * plus the plan-refusal contract shared by all four tools.
 *
 * The body is not the whole answer. Credits are charged per call and reported in a
 * header; the class of exit that delivered is reported in a header on every route and
 * in the body only on /proxy; and a refusal raised by the caller's own plan names the
 * limit in a header and in a `reason` field. A tool that reads only the JSON body
 * reports "forbidden" for "your plan is out of credits", which is the difference
 * between a caller that stops and a caller that keeps spending.
 *
 * Documented at https://foura.ai/docs/api/response-headers and
 * https://foura.ai/docs/api/rate-limits.
 */

/** Header bag as undici reports it: lowercase names, single or repeated values. */
type HeaderBag = Record<string, string | string[] | undefined>;

export interface UpstreamMeta {
  /** Credits this call spent. Present on every response that reached the backend. */
  credits?: number;
  /** FourA's id for this call, set even when authentication fails. */
  request_id?: string;
  /** The class of exit that delivered, when the API reported one. */
  exitClass?: "standard" | "premium";
}

function first(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pull the per-call signals out of the response headers.
 *
 * Every field is optional on purpose: an older gateway, a proxy that strips headers, or a
 * request that died before the backend all produce a response with none of them, and that
 * is not an error.
 */
export function readUpstreamMeta(headers: HeaderBag): UpstreamMeta {
  const meta: UpstreamMeta = {};

  const credits = first(headers, "x-foura-credits");
  if (credits !== undefined) {
    const n = Number(credits);
    if (Number.isFinite(n)) meta.credits = n;
  }

  const requestId = first(headers, "x-foura-request-id");
  if (requestId !== undefined) meta.request_id = requestId;

  const exitClass = first(headers, "x-foura-exit-class");
  if (exitClass === "standard" || exitClass === "premium") meta.exitClass = exitClass;

  return meta;
}

/**
 * The stable code for a refusal raised by the caller's PLAN rather than by the target.
 *
 * `plan_limit_` followed by one of feature, premium, concurrency, rate, browser_daily,
 * credits, bandwidth. The API sends it as `reason` in the body and as the `X-FourA-Limit`
 * header; either one is enough, and the header is the fallback for a body shape that
 * changes. Returns null when the refusal did not come from a plan limit.
 */
export function planLimitCode(body: unknown, headers: HeaderBag): string | null {
  const reason = (body as Record<string, unknown> | null | undefined)?.reason;
  if (typeof reason === "string" && reason.startsWith("plan_limit_")) return reason;

  const header = first(headers, "x-foura-limit");
  if (header?.startsWith("plan_limit_")) return header;

  return null;
}

/**
 * Seconds to wait before retrying, as the API reports it on a plan refusal a wait can clear.
 *
 * The body field is `retry_after_seconds`; the tools publish `retryAfter`, so the two are
 * bridged here rather than in four handlers. A refusal a wait cannot clear (a feature the
 * plan does not carry) has no value and none is invented.
 */
export function planRetryAfter(body: unknown): number | undefined {
  const seconds = (body as Record<string, unknown> | null | undefined)?.retry_after_seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : undefined;
}
