/**
 * Unit Tests for Gemini Error Parsing, Classification, Redaction & Diagnostic Logging
 */

import {
  parseGeminiError,
  sanitizeGeminiMessage,
} from "../src/lib/gemini-errors";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runGeminiErrorTests() {
  console.log("\n========================================================");
  console.log("  GEMINI ERROR HANDLING & DIAGNOSTIC TEST SUITE");
  console.log("========================================================\n");

  // Test 1: Secret Redaction
  console.log("--- Group 1: Secret Redaction & Sanitization ---");
  const testKey = "AIzaSy" + "D1234567890abcdefghijklmnopqrstuv";
  const rawMsgWithKey = `Error fetching from https://generativelanguage.googleapis.com/v1beta/models?key=${testKey}: [401 Unauthorized] Invalid key`;
  const sanitized1 = sanitizeGeminiMessage(rawMsgWithKey);
  assert(!sanitized1.includes(testKey), "Never exposes raw AIza key");
  assert(sanitized1.includes("[REDACTED_API_KEY]"), "Replaces AIza key with [REDACTED_API_KEY]");

  const rawMsgWithBearer = "Authorization failure: Bearer ya29.a0AfH6SMCxyz123";
  const sanitizedBearer = sanitizeGeminiMessage(rawMsgWithBearer);
  assert(!sanitizedBearer.includes("ya29.a0AfH6SMCxyz123"), "Never exposes Bearer token");
  assert(sanitizedBearer.includes("[REDACTED_TOKEN]"), "Replaces token with [REDACTED_TOKEN]");

  // Test 2: HTTP 429 - Quota Exceeded / Too Many Requests
  console.log("\n--- Group 2: HTTP 429 Quota Exceeded / Rate Limit ---");
  const quotaErrorSample =
    `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${testKey}: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20. Please retry in 11h23m. [{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"41032s"}]`;

  const parsed429 = parseGeminiError(new Error(quotaErrorSample));
  assert(parsed429.httpStatus === 429, "Returns HTTP 429 status code");
  assert(parsed429.upstreamStatus === 429, "Captures upstreamStatus as 429");
  assert(parsed429.errorCode === "QUOTA_EXCEEDED", "Maps to errorCode 'QUOTA_EXCEEDED'");
  assert(parsed429.retryAfterSeconds === 41032, "Extracts retryAfterSeconds: 41032s");
  assert(!parsed429.sanitizedMessage.includes(testKey), "Sanitized message does not leak API key");
  assert(
    parsed429.userReply.includes("quota limit") || parsed429.userReply.includes("demand"),
    "User reply informs customer of quota/demand with empathy"
  );

  // Test 3: HTTP 401 - Unauthorized / Invalid API Key
  console.log("\n--- Group 3: HTTP 401 Unauthorized / Invalid API Key ---");
  const authErrorSample =
    `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent: [401 Unauthorized] API key not valid. Please pass a valid API key.`;
  const parsed401 = parseGeminiError(new Error(authErrorSample));
  assert(parsed401.httpStatus === 401, "Returns HTTP 401 status code");
  assert(parsed401.upstreamStatus === 401, "Captures upstreamStatus as 401");
  assert(parsed401.errorCode === "AUTH_ERROR", "Maps to errorCode 'AUTH_ERROR'");
  assert(
    parsed401.userReply.includes("authenticate") && parsed401.userReply.includes("GEMINI_API_KEY"),
    "User reply guides admin to verify GEMINI_API_KEY"
  );

  // Test 4: HTTP 403 - Forbidden / Permission Denied
  console.log("\n--- Group 4: HTTP 403 Forbidden / Permission Denied ---");
  const forbiddenSample =
    `[GoogleGenerativeAI Error]: Error fetching: [403 Forbidden] The caller does not have permission`;
  const parsed403 = parseGeminiError(new Error(forbiddenSample));
  assert(parsed403.httpStatus === 403, "Returns HTTP 403 status code");
  assert(parsed403.upstreamStatus === 403, "Captures upstreamStatus as 403");
  assert(parsed403.errorCode === "FORBIDDEN", "Maps to errorCode 'FORBIDDEN'");

  // Test 5: HTTP 404 - Model Not Found
  console.log("\n--- Group 5: HTTP 404 Model Not Found ---");
  const notFoundSample =
    `[GoogleGenerativeAI Error]: Error fetching: [404 Not Found] models/gemini-1.5-flash is not found for API version v1beta`;
  const parsed404 = parseGeminiError(new Error(notFoundSample));
  assert(parsed404.httpStatus === 404, "Returns HTTP 404 status code");
  assert(parsed404.upstreamStatus === 404, "Captures upstreamStatus as 404");
  assert(parsed404.errorCode === "MODEL_NOT_FOUND", "Maps to errorCode 'MODEL_NOT_FOUND'");
  assert(parsed404.userReply.includes("GEMINI_MODEL"), "Mentions GEMINI_MODEL setting in reply");

  // Test 6: HTTP 400 - Bad Request
  console.log("\n--- Group 6: HTTP 400 Bad Request ---");
  const badReqSample =
    `[GoogleGenerativeAI Error]: Error fetching: [400 Bad Request] Invalid argument: contents are empty`;
  const parsed400 = parseGeminiError(new Error(badReqSample));
  assert(parsed400.httpStatus === 400, "Returns HTTP 400 status code");
  assert(parsed400.upstreamStatus === 400, "Captures upstreamStatus as 400");
  assert(parsed400.errorCode === "BAD_REQUEST", "Maps to errorCode 'BAD_REQUEST'");

  // Test 7: HTTP 503 / 5xx - Service Unavailable / Model Overloaded
  console.log("\n--- Group 7: HTTP 503 Service Unavailable / Overload ---");
  const overloadSample =
    `[GoogleGenerativeAI Error]: Error fetching: [503 Service Unavailable] The model is temporarily overloaded.`;
  const parsed503 = parseGeminiError(new Error(overloadSample));
  assert(parsed503.httpStatus === 503, "Returns HTTP 503 status code");
  assert(parsed503.upstreamStatus === 503, "Captures upstreamStatus as 503");
  assert(parsed503.errorCode === "SERVICE_UNAVAILABLE", "Maps to errorCode 'SERVICE_UNAVAILABLE'");

  // Test 8: Object with .status property (GoogleGenerativeAIFetchError simulation)
  console.log("\n--- Group 8: GoogleGenerativeAIFetchError Object Structure ---");
  const mockFetchError = {
    name: "GoogleGenerativeAIFetchError",
    status: 429,
    statusText: "Too Many Requests",
    message: "Rate limit reached for project",
  };
  const parsedObj = parseGeminiError(mockFetchError);
  assert(parsedObj.httpStatus === 429, "Detects status property from error object");
  assert(parsedObj.upstreamStatus === 429, "Captures upstreamStatus 429 from error object");
  assert(parsedObj.errorCode === "QUOTA_EXCEEDED", "Maps to 'QUOTA_EXCEEDED'");

  console.log("\n========================================================");
  console.log("  ALL GEMINI ERROR TESTS PASSED WITH 100% SUCCESS!");
  console.log("========================================================\n");
}

runGeminiErrorTests().catch((err) => {
  console.error("Gemini error test suite failed:", err);
  process.exit(1);
});
