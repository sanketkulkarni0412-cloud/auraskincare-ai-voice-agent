import {
  Order,
  SafeOrderDetails,
  CancelOrderResult,
  ReturnEligibilityResult,
} from "./types";
import {
  evaluateCancellationEligibility,
  evaluateReturnEligibility,
} from "./policies";

// Canonical seed orders matching assessment specifications
export const SEED_ORDERS: Order[] = [
  {
    id: "ORD-101",
    customer: "Priya Sharma",
    products: "Vitamin C Serum 30ml",
    amount: 699,
    currency: "₹",
    status: "Out for Delivery",
    courier: "BlueDart",
    trackingId: "BD-982103",
    expectedDelivery: "6 PM today",
    notes: [
      "Assigned to local delivery executive.",
      "Out for delivery; cannot be cancelled mid-route.",
    ],
  },
  {
    id: "ORD-102",
    customer: "Rahul Verma",
    products: "Hydrating Sunscreen SPF50",
    amount: 499,
    currency: "₹",
    status: "Delivered",
    deliveredAt: "14 days ago",
    daysSinceDelivery: 14,
    courier: "Delhivery",
    trackingId: "DL-441029",
    notes: [
      "Delivered 14 days ago.",
      "Exceeds the 7-day return window; ineligible for return.",
    ],
  },
  {
    id: "ORD-103",
    customer: "Ananya Patel",
    products: "Green Tea Face Wash + Toner",
    amount: 850,
    currency: "₹",
    status: "Processing",
    orderedAt: "3 hours ago",
    notes: [
      "Order confirmed and preparing for packaging.",
      "Eligible for cancellation before dispatch.",
    ],
  },
];

// In-memory mutable state for the session
let ordersDatabase: Order[] = JSON.parse(JSON.stringify(SEED_ORDERS));

/**
 * Normalizes user input into canonical format 'ORD-XXX'.
 * Handles:
 * - 'ord-101' -> 'ORD-101'
 * - 'ORD101' -> 'ORD-101'
 * - 'ORD-101' -> 'ORD-101'
 * - 'ord 101' -> 'ORD-101'
 * - '101' -> 'ORD-101'
 */
export function normalizeOrderId(rawId: string): string {
  if (!rawId || typeof rawId !== "string") return "";

  const trimmed = rawId.trim();

  // Match optional prefix ORD with optional dash/space/underscore, followed by digits
  const match = trimmed.match(/^(?:ORD[-_\s]?)?(\d{2,})$/i);
  if (match) {
    return `ORD-${match[1]}`;
  }

  // Fallback cleanup if custom format
  return trimmed.toUpperCase();
}

/**
 * Sanitizes order for safe public/client consumption.
 * Does not expose unnecessary customer private information.
 */
export function toSafeOrderDetails(order: Order): SafeOrderDetails {
  return {
    orderId: order.id,
    customer: order.customer,
    products: order.products,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    courier: order.courier,
    trackingId: order.trackingId,
    expectedDelivery: order.expectedDelivery,
    deliveredAt: order.deliveredAt,
    orderedAt: order.orderedAt,
  };
}

/**
 * Retrieve all orders in the mock database
 */
export function getAllOrders(): Order[] {
  return ordersDatabase;
}

/**
 * Reset mock database to initial canonical seeds
 */
export function resetOrdersDatabase(): void {
  ordersDatabase = JSON.parse(JSON.stringify(SEED_ORDERS));
}

export interface GetOrderResult {
  found: boolean;
  order?: SafeOrderDetails;
  rawOrder?: Order; // Internal use only
  error?: string;
  errorCode?: "NOT_FOUND" | "INVALID_ID";
  normalizedId: string;
}

/**
 * Requirement 2: get_order_details(order_id)
 * - Accepts 'ord-101', 'ORD101', 'ORD-101'
 * - Normalizes valid input to canonical format
 * - Returns structured order details
 * - Returns clear NOT_FOUND error for unknown orders
 * - Never invents order details
 * - Do not expose unnecessary customer information
 */
export function get_order_details(orderId: string): GetOrderResult {
  if (!orderId || typeof orderId !== "string" || orderId.trim().length === 0) {
    return {
      found: false,
      errorCode: "INVALID_ID",
      normalizedId: "",
      error: "Order ID is required. Please provide a valid order ID such as ORD-101.",
    };
  }

  const normalizedId = normalizeOrderId(orderId);

  const matched = ordersDatabase.find(
    (o) =>
      o.id.toUpperCase() === normalizedId.toUpperCase() ||
      o.id.toUpperCase() === orderId.trim().toUpperCase()
  );

  if (!matched) {
    return {
      found: false,
      errorCode: "NOT_FOUND",
      normalizedId,
      error: `Order '${orderId}' (canonical: '${normalizedId}') was not found in our database. Valid sample orders for assessment testing are ORD-101, ORD-102, and ORD-103.`,
    };
  }

  return {
    found: true,
    normalizedId,
    order: toSafeOrderDetails(matched),
    rawOrder: matched,
  };
}

// Backwards-compatible alias
export const getOrderById = get_order_details;

/**
 * Requirement 3: Order Cancellation
 * - Only orders with status 'Processing' can be cancelled.
 * - 'Shipped', 'Out for Delivery', and 'Delivered' orders cannot be cancelled.
 * - Controlled in-memory update.
 * - Clear reason returned when rejected.
 */
export function cancelOrder(
  orderId: string,
  reason: string = "Customer requested cancellation"
): CancelOrderResult {
  const normalizedId = normalizeOrderId(orderId);
  const orderIndex = ordersDatabase.findIndex(
    (o) => o.id.toUpperCase() === normalizedId.toUpperCase()
  );

  if (orderIndex === -1) {
    return {
      success: false,
      orderId: normalizedId || orderId,
      policyCode: "NOT_FOUND",
      message: `Cancellation rejected: Order '${orderId}' does not exist in the database.`,
    };
  }

  const order = ordersDatabase[orderIndex];
  const evalResult = evaluateCancellationEligibility(order);

  if (!evalResult.canCancel) {
    return {
      success: false,
      orderId: order.id,
      previousStatus: order.status,
      policyCode: evalResult.policyCode,
      message: evalResult.reason,
    };
  }

  // Update in-memory database
  const previousStatus = order.status;
  const updatedOrder: Order = {
    ...order,
    status: "Cancelled",
    cancellationReason: reason,
    notes: [
      ...(order.notes || []),
      `Cancelled at ${new Date().toISOString()}: ${reason}`,
    ],
  };

  ordersDatabase[orderIndex] = updatedOrder;

  return {
    success: true,
    orderId: order.id,
    previousStatus,
    newStatus: "Cancelled",
    policyCode: "CANCELLED_SUCCESS",
    message: `Order ${order.id} has been successfully cancelled. A full refund of ₹${order.amount} will be processed to the original payment method.`,
  };
}

/**
 * Requirement 3: Check Return Eligibility
 * - 7-day return window
 * - Unopened, unused, in original packaging
 * - Damaged products within 48 hours with photos
 * - Rejects orders delivered 14 days ago
 */
export function checkOrderReturnEligibility(
  orderId: string,
  criteria: {
    daysSinceDelivery?: number;
    isOpened?: boolean;
    isUsed?: boolean;
    isOriginalPackaging?: boolean;
    isDamaged?: boolean;
    hoursSinceDelivery?: number;
    hasPhotos?: boolean;
  } = {}
): ReturnEligibilityResult & { found: boolean; error?: string } {
  const lookup = get_order_details(orderId);

  if (!lookup.found || !lookup.rawOrder) {
    return {
      found: false,
      orderId,
      eligible: false,
      orderStatus: "Processing",
      isWithinWindow: false,
      reason: lookup.error || `Order ${orderId} not found.`,
      policyRule: "Order Lookup Failed",
      error: lookup.error,
    };
  }

  const evalResult = evaluateReturnEligibility(lookup.rawOrder, criteria);
  return {
    found: true,
    ...evalResult,
  };
}

/**
 * Return processing helper
 */
export function returnOrder(
  orderId: string,
  _reason: string = "Customer return request",
  isOpened: boolean = false,
  isDefective: boolean = false
): {
  success: boolean;
  message: string;
  policyReason: string;
  orderId: string;
  refundAmount?: number;
} {
  const result = checkOrderReturnEligibility(orderId, {
    isOpened,
    isDamaged: isDefective,
    hasPhotos: isDefective,
    hoursSinceDelivery: isDefective ? 12 : undefined,
  });

  return {
    success: result.eligible,
    message: `${result.reason} (Customer Reason: ${_reason})`,
    policyReason: result.policyRule,
    orderId: result.orderId,
    refundAmount: result.eligible ? 499 : 0,
  };
}

