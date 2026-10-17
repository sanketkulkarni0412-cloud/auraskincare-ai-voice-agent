import { CallSummary, CallSummarySchema, TranscriptMessage } from "@/lib/types";

/**
 * Deterministic fallback generator for post-call summaries.
 * Used when GEMINI_API_KEY is not configured, when the Gemini API is unreachable,
 * or when Gemini output fails schema validation.
 *
 * Infers:
 * - customer_intent: ORDER_TRACKING | CANCELLATION | RETURN | POLICY_QUERY | OUT_OF_SCOPE | OTHER
 * - order_id: canonical "ORD-NNN" if present, else null
 * - resolution_status: RESOLVED | UNRESOLVED | ESCALATED
 * - call_summary: concise, factual 1-2 sentence description
 */
export function generateDeterministicSummary(messages: TranscriptMessage[]): CallSummary {
  // Empty call check
  if (!messages || messages.length === 0) {
    return {
      customer_intent: "OTHER",
      order_id: null,
      resolution_status: "UNRESOLVED",
      call_summary: "Customer connected to Aria but disconnected without speaking.",
    };
  }

  const userTurns = messages.filter((m) => m.role === "user");
  const assistantTurns = messages.filter((m) => m.role === "assistant");

  // If there's only the welcome message and no customer input
  if (userTurns.length === 0) {
    return {
      customer_intent: "OTHER",
      order_id: null,
      resolution_status: "UNRESOLVED",
      call_summary: "Customer connected to Aria but disconnected without speaking.",
    };
  }

  const userText = userTurns
    .map((m) => m.content.toLowerCase())
    .join(" ");

  const assistantText = assistantTurns
    .map((m) => m.content.toLowerCase())
    .join(" ");

  const combined = userText + " " + assistantText;

  // Extract first mentioned order ID (ORD-NNN pattern or variations like 'ord 101')
  const orderMatch = combined.match(/\bord[-\s]?(\d{3,})\b/i);
  const order_id = orderMatch ? `ORD-${orderMatch[1]}` : null;

  // Classify intent based on customer request
  let customer_intent: CallSummary["customer_intent"] = "OTHER";
  if (
    userText.includes("cancel") ||
    userText.includes("cancellation")
  ) {
    customer_intent = "CANCELLATION";
  } else if (
    userText.includes("return") ||
    userText.includes("refund")
  ) {
    customer_intent = "RETURN";
  } else if (
    userText.includes("where is") ||
    userText.includes("track") ||
    userText.includes("delivery") ||
    userText.includes("status")
  ) {
    customer_intent = "ORDER_TRACKING";
  } else if (
    userText.includes("policy") ||
    userText.includes("shipping") ||
    userText.includes("how long") ||
    userText.includes("cod")
  ) {
    customer_intent = "POLICY_QUERY";
  } else if (
    userText.includes("flight") ||
    userText.includes("hotel") ||
    userText.includes("weather") ||
    userText.includes("movie") ||
    (!combined.includes("order") &&
      !combined.includes("skincare") &&
      !combined.includes("serum") &&
      !combined.includes("cream") &&
      !combined.includes("aura"))
  ) {
    customer_intent = "OUT_OF_SCOPE";
  }

  // Classify resolution
  let resolution_status: CallSummary["resolution_status"] = "UNRESOLVED";
  const escalatedSignals = [
    "supervisor",
    "manager",
    "escalate",
    "senior support",
    "human agent",
  ];
  const unresolvedSignals = [
    "not found",
    "unable to cancel",
    "cannot be cancelled",
    "not eligible",
    "ineligible",
    "window has passed",
    "exceeded",
    "cannot cancel",
    "failed",
    "doesn't appear",
    "i'm sorry",
  ];
  const resolvedSignals = [
    "successfully cancelled",
    "your order has been cancelled",
    "cancellation confirmed",
    "refund will be processed",
    "out for delivery",
    "expected to arrive",
    "expected delivery",
    "tracking id",
    "return request has been approved",
    "here is your order",
  ];

  if (escalatedSignals.some((s) => combined.includes(s))) {
    resolution_status = "ESCALATED";
  } else if (unresolvedSignals.some((s) => assistantText.includes(s))) {
    resolution_status = "UNRESOLVED";
  } else if (resolvedSignals.some((s) => assistantText.includes(s))) {
    resolution_status = "RESOLVED";
  } else if (customer_intent === "OUT_OF_SCOPE") {
    // Agent politely declines out of scope inquiries
    resolution_status = "RESOLVED";
  } else {
    resolution_status = "RESOLVED";
  }

  // Build summary sentence
  const intentLabels: Record<CallSummary["customer_intent"], string> = {
    ORDER_TRACKING: "order tracking",
    CANCELLATION: "order cancellation",
    RETURN: "a return or refund request",
    POLICY_QUERY: "policy information",
    OUT_OF_SCOPE: "an out-of-scope inquiry",
    OTHER: "a general inquiry",
  };

  const orderPart = order_id ? ` for order ${order_id}` : "";
  const statusPart =
    resolution_status === "RESOLVED"
      ? "The inquiry was successfully resolved."
      : resolution_status === "ESCALATED"
      ? "The call was escalated to human support."
      : "The request could not be completed under Aura Skincare policy.";

  const call_summary = `Customer inquired regarding ${intentLabels[customer_intent]}${orderPart}. ${statusPart}`;

  const result: CallSummary = {
    customer_intent,
    order_id,
    resolution_status,
    call_summary,
  };

  return CallSummarySchema.parse(result);
}
