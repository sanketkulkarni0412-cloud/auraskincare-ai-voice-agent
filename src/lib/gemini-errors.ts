/**
 * Gemini Error Parsing and Diagnostic Module
 *
 * Provides safe error classification, status mapping, and redaction for upstream
 * Google Gemini API errors.
 *
 * Distinctly classifies:
 * - 400: Bad Request / Invalid Argument
 * - 401: Unauthorized / Invalid API Key
 * - 403: Forbidden / Permission Denied
 * - 404: Not Found / Model Not Supported
 * - 429: Too Many Requests / Quota Exceeded
 * - 5xx: Upstream Service Unavailable / Gemini Server Overload
 *
 * Security:
 * - Strictly redacts API keys and bearer tokens from all error messages.
 * - Never leaks server-side secrets or sensitive environment variables.
 */

export type GeminiErrorCode =
  | "BAD_REQUEST"
  | "AUTH_ERROR"
  | "FORBIDDEN"
  | "MODEL_NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ClassifiedGeminiError {
  /** The HTTP status code to return to the client (e.g. 400, 401, 403, 404, 429, 503, 500) */
  httpStatus: number;
  /** The upstream HTTP status code returned by Google Gemini (or 0 if undetermined) */
  upstreamStatus: number;
  /** Machine-readable error category */
  errorCode: GeminiErrorCode;
  /** Safe, sanitized error message with all API keys and secrets redacted */
  sanitizedMessage: string;
  /** Friendly, empathetic customer-facing message for voice speech and chat reply */
  userReply: string;
  /** Optional retry delay in seconds if provided by the upstream error */
  retryAfterSeconds?: number;
}

/**
 * Redact sensitive patterns such as Google AI Studio API keys (AIza...) and URL query keys
 */
export function sanitizeGeminiMessage(raw: string): string {
  if (!raw) return "";
  return raw
    // Redact standard Google API Key format
    .replace(/AIza[0-9A-Za-z\-_]{35}/g, "[REDACTED_API_KEY]")
    // Redact query parameter key=...
    .replace(/([?&]key=)[^&\s"]+/gi, "$1[REDACTED_API_KEY]")
    // Redact Authorization headers or Bearer tokens
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED_TOKEN]");
}

/**
 * Parse and classify errors thrown during Gemini API operations
 */
export function parseGeminiError(err: unknown): ClassifiedGeminiError {
  const rawMessage = err instanceof Error ? err.message : String(err || "");
  const sanitized = sanitizeGeminiMessage(rawMessage);

  // 1. Attempt to extract upstream HTTP status
  let upstreamStatus = 0;

  // Check if error object has a numeric status property (e.g., GoogleGenerativeAIFetchError)
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    upstreamStatus = (err as { status: number }).status;
  }

  // If not extracted, look for HTTP status patterns in message (e.g. "[429 Too Many Requests]")
  if (!upstreamStatus) {
    const bracketMatch = sanitized.match(/\[(\d{3})\s+[^\]]*\]/);
    if (bracketMatch) {
      upstreamStatus = parseInt(bracketMatch[1], 10);
    } else {
      const genericMatch = sanitized.match(/\b(?:HTTP|status)\s*[:=]?\s*(\d{3})\b/i);
      if (genericMatch) {
        upstreamStatus = parseInt(genericMatch[1], 10);
      }
    }
  }

  // If status is still undetermined, infer from keywords
  if (!upstreamStatus) {
    if (/RESOURCE_EXHAUSTED|quota|too many requests|rate limit/i.test(sanitized)) {
      upstreamStatus = 429;
    } else if (/UNAUTHENTICATED|API_KEY_INVALID|invalid api key|invalid key/i.test(sanitized)) {
      upstreamStatus = 401;
    } else if (/PERMISSION_DENIED|forbidden/i.test(sanitized)) {
      upstreamStatus = 403;
    } else if (/NOT_FOUND|model.*not found/i.test(sanitized)) {
      upstreamStatus = 404;
    } else if (/INVALID_ARGUMENT|bad request/i.test(sanitized)) {
      upstreamStatus = 400;
    } else if (/UNAVAILABLE|overloaded|service unavailable/i.test(sanitized)) {
      upstreamStatus = 503;
    } else if (/INTERNAL/i.test(sanitized)) {
      upstreamStatus = 500;
    }
  }

  // 2. Extract retryDelay if available (e.g. 'retryDelay":"41032s"' or 'retry in 11h23m')
  let retryAfterSeconds: number | undefined;
  const retrySecMatch = sanitized.match(/retryDelay["']?\s*:\s*["'](\d+)s["']/i);
  if (retrySecMatch) {
    retryAfterSeconds = parseInt(retrySecMatch[1], 10);
  } else {
    const retryInSecMatch = sanitized.match(/retry in\s+(\d+)s/i);
    if (retryInSecMatch) {
      retryAfterSeconds = parseInt(retryInSecMatch[1], 10);
    }
  }

  // 3. Map to distinct HTTP response status, error code, and friendly reply
  switch (upstreamStatus) {
    case 400:
      return {
        httpStatus: 400,
        upstreamStatus: 400,
        errorCode: "BAD_REQUEST",
        sanitizedMessage: sanitized,
        userReply:
          "The request to Gemini was malformed. Please try rephrasing your skincare question.",
      };

    case 401:
      return {
        httpStatus: 401,
        upstreamStatus: 401,
        errorCode: "AUTH_ERROR",
        sanitizedMessage: sanitized,
        userReply:
          "Aria cannot authenticate with the Gemini API. Please check that a valid GEMINI_API_KEY is configured on the server.",
      };

    case 403:
      return {
        httpStatus: 403,
        upstreamStatus: 403,
        errorCode: "FORBIDDEN",
        sanitizedMessage: sanitized,
        userReply:
          "Access to the Gemini AI service was denied. Please verify your project permissions and API key restrictions.",
      };

    case 404:
      return {
        httpStatus: 404,
        upstreamStatus: 404,
        errorCode: "MODEL_NOT_FOUND",
        sanitizedMessage: sanitized,
        userReply:
          "The configured Gemini model was not found. Please verify the GEMINI_MODEL configuration.",
      };

    case 429:
      return {
        httpStatus: 429,
        upstreamStatus: 429,
        errorCode: "QUOTA_EXCEEDED",
        sanitizedMessage: sanitized,
        userReply:
          "I apologize, but Aria's AI service is currently experiencing high demand or has reached its Google Gemini API quota limit. Please try again shortly or contact support@auraskincare.com.",
        retryAfterSeconds,
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        httpStatus: 503,
        upstreamStatus,
        errorCode: "SERVICE_UNAVAILABLE",
        sanitizedMessage: sanitized,
        userReply:
          "The Gemini AI service is temporarily unavailable or overloaded. Please try again in a few moments.",
        retryAfterSeconds,
      };

    default:
      return {
        httpStatus: 500,
        upstreamStatus: upstreamStatus || 500,
        errorCode: "INTERNAL_ERROR",
        sanitizedMessage: sanitized || "Unknown error executing chat turn",
        userReply:
          "I encountered an issue connecting to the Gemini service. Please check your network connection or try repeating your message.",
      };
  }
}

/**
 * Log server-side diagnostic information without leaking secrets
 */
export function logGeminiDiagnostic(
  classified: ClassifiedGeminiError,
  context = "api/chat"
): void {
  const statusDisplay =
    classified.upstreamStatus > 0
      ? `HTTP ${classified.upstreamStatus}`
      : `HTTP ${classified.httpStatus}`;

  console.error(
    `[${context}] Upstream Gemini Error: ${statusDisplay} (${classified.errorCode}) — ${classified.sanitizedMessage}`
  );

  if (classified.retryAfterSeconds !== undefined) {
    console.info(
      `[${context}] Upstream retry recommendation: retry after ${classified.retryAfterSeconds} seconds`
    );
  }
}
