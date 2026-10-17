import { z } from "zod";

// --- Order Status & Model Definitions ---
export type OrderStatus =
  | "Processing"
  | "Out for Delivery"
  | "Delivered"
  | "Shipped"
  | "Cancelled"
  | "Returned";

export interface Order {
  id: string; // e.g. "ORD-101", "ORD-102", "ORD-103"
  customer: string;
  products: string;
  amount: number; // In INR (₹)
  currency: string; // "₹"
  status: OrderStatus;
  courier?: string; // e.g. "BlueDart", "Delhivery"
  trackingId?: string; // e.g. "BD-982103", "DL-441029"
  expectedDelivery?: string; // e.g. "6 PM today"
  deliveredAt?: string; // e.g. "14 days ago"
  daysSinceDelivery?: number;
  orderedAt?: string; // e.g. "3 hours ago"
  cancellationReason?: string;
  notes?: string[];
}

/**
 * Public/Sanitized order view.
 * Protects customer privacy by omitting PII (email, phone, private address).
 */
export interface SafeOrderDetails {
  orderId: string;
  customer: string;
  products: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  courier?: string;
  trackingId?: string;
  expectedDelivery?: string;
  deliveredAt?: string;
  orderedAt?: string;
}

// Zod Schema for Order Lookup Request
export const OrderLookupQuerySchema = z.object({
  orderId: z
    .string()
    .min(1, "Order ID cannot be empty")
    .max(30, "Order ID is too long"),
});

// Zod Schema for Order Cancellation Request
export const CancelOrderRequestSchema = z.object({
  orderId: z
    .string()
    .min(1, "Order ID is required"),
  reason: z
    .string()
    .max(300, "Reason must not exceed 300 characters")
    .optional()
    .default("Customer requested cancellation"),
});

export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>;

export type CancellationPolicyCode =
  | "CANCELLED_SUCCESS"
  | "CANNOT_CANCEL_OUT_FOR_DELIVERY"
  | "CANNOT_CANCEL_DELIVERED"
  | "CANNOT_CANCEL_SHIPPED"
  | "ALREADY_CANCELLED"
  | "NOT_FOUND";

export interface CancelOrderResult {
  success: boolean;
  orderId: string;
  previousStatus?: OrderStatus;
  newStatus?: OrderStatus;
  message: string;
  policyCode: CancellationPolicyCode;
}

// Zod Schema for Return Eligibility Request
export const ReturnEligibilityRequestSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  daysSinceDelivery: z.number().int().nonnegative().optional(),
  isOpened: z.boolean().default(false),
  isUsed: z.boolean().default(false),
  isOriginalPackaging: z.boolean().default(true),
  isDamaged: z.boolean().default(false),
  hoursSinceDelivery: z.number().nonnegative().optional(),
  hasPhotos: z.boolean().default(false),
});

export type ReturnEligibilityRequest = z.infer<typeof ReturnEligibilityRequestSchema>;

export interface ReturnEligibilityResult {
  orderId: string;
  eligible: boolean;
  reason: string;
  policyRule: string;
  orderStatus: OrderStatus;
  isWithinWindow: boolean;
  damageClaimValid?: boolean;
}

// --- Policy Types ---
export type PolicyCategory = "shipping" | "return" | "cancellation" | "cod" | "general";

export interface ShippingPolicyResult {
  amount: number;
  shippingFee: number;
  isFreeShipping: boolean;
  qualifiesThreshold: number; // 499
  summary: string;
}

export interface CodPolicyResult {
  amount: number;
  isEligible: boolean;
  maxCodLimit: number; // 2500
  paymentMethods: string[]; // ["Cash", "UPI"]
  summary: string;
}

export interface PolicyRule {
  category: PolicyCategory;
  title: string;
  summary: string;
  keyPoints: string[];
  strictRules: string[];
}

// --- Transcript & Chat Types ---
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  toolCalls?: ToolCallRecord[];
  isInterim?: boolean;
}

// --- Post-Call Summary Schema (legacy / internal rich schema) ---
export const PostCallSummarySchema = z.object({
  callId: z.string(),
  timestamp: z.string(),
  customerIntent: z.string().min(1, "Customer intent is required"),
  resolutionStatus: z.enum([
    "RESOLVED",
    "REQUIRES_FOLLOWUP",
    "ESCALATED",
    "CANCELLED_BY_CUSTOMER",
    "INFORMATIONAL",
  ]),
  orderId: z.string().nullable(),
  orderFound: z.boolean(),
  orderStatusBefore: z.string().nullable().optional(),
  orderStatusAfter: z.string().nullable().optional(),
  actionsTaken: z.array(z.string()),
  policiesEnforced: z.array(z.string()),
  customerSentiment: z.enum(["SATISFIED", "POSITIVE", "NEUTRAL", "FRUSTRATED"]),
  summaryNotes: z.string().min(1, "Summary notes are required"),
  escalationReason: z.string().optional(),
  followUpTasks: z.array(z.string()).optional(),
});

export type PostCallSummary = z.infer<typeof PostCallSummarySchema>;

// --- Required Assessment Call Summary Schema ---
// Exact schema from the DataStraw assessment specification.
// order_id MUST be null when no order was identified in the conversation.
export const CallSummarySchema = z.object({
  customer_intent: z.enum([
    "ORDER_TRACKING",
    "CANCELLATION",
    "RETURN",
    "POLICY_QUERY",
    "OUT_OF_SCOPE",
    "OTHER",
  ]),
  order_id: z
    .string()
    .nullable()
    .refine(
      (val) => val === null || /^ORD-\d+$/i.test(val),
      { message: "order_id must be a valid ORD-NNN identifier or null" }
    ),
  resolution_status: z.enum(["RESOLVED", "UNRESOLVED", "ESCALATED"]),
  call_summary: z
    .string()
    .min(10, "call_summary must be a meaningful description")
    .max(600, "call_summary must not exceed 600 characters"),
});

export type CallSummary = z.infer<typeof CallSummarySchema>;

// Transcript message sent to summary endpoint
export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export type VoiceAgentState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "MUTED"
  | "ENDED";
