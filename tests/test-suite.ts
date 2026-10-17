/**
 * Aura Skincare AI Voice Agent — Master Test Suite
 * DataStraw Technical Hiring Assessment
 *
 * Runs all test suites sequentially:
 * 1. Orders & Business Policies (Normalization, Cancellation, Return, Shipping, COD)
 * 2. Gemini AI & Tool Calling (Schemas, Function Calling, Domain Guardrails)
 * 3. Post-Call Summary (10 Scenarios, Schema Validation, Idempotency, Fallbacks)
 */

async function runMasterTestSuite() {
  console.log("\n############################################################");
  console.log("   AURA SKINCARE AI VOICE AGENT — FULL ASSESSMENT TEST RUN  ");
  console.log("############################################################\n");

  // Suite 1: Orders and Policies
  await import("./orders-and-policies.test");

  // Suite 2: Gemini Scenarios
  await import("./gemini-scenarios.test");

  // Suite 3: Gemini Error Classification & Redaction
  await import("./gemini-errors.test");

  // Suite 4: Post-Call Summary
  await import("./summary.test");

  console.log("\n############################################################");
  console.log("   ALL SUITES COMPLETED SUCCESSFULLY!                      ");
  console.log("############################################################\n");
}

runMasterTestSuite().catch((err) => {
  console.error("Master Test Suite failed:", err);
  process.exit(1);
});
