import {
  Order,
  PolicyCategory,
  PolicyRule,
  ReturnEligibilityResult,
  ShippingPolicyResult,
  CodPolicyResult,
  CancellationPolicyCode,
} from "./types";

export type { PolicyCategory, PolicyRule };

/**
 * 1. SHIPPING POLICY:
 * - Orders of ₹499 and above qualify for free shipping.
 * - Orders below ₹499 have a ₹50 shipping fee.
 */
export const SHIPPING_FREE_THRESHOLD = 499;
export const SHIPPING_STANDARD_FEE = 50;

export function calculateShippingFee(amount: number): ShippingPolicyResult {
  const isFree = amount >= SHIPPING_FREE_THRESHOLD;
  const shippingFee = isFree ? 0 : SHIPPING_STANDARD_FEE;

  return {
    amount,
    shippingFee,
    isFreeShipping: isFree,
    qualifiesThreshold: SHIPPING_FREE_THRESHOLD,
    summary: isFree
      ? `Orders above ₹${SHIPPING_FREE_THRESHOLD} qualify for Free Shipping. Your order amount is ₹${amount}.`
      : `Orders below ₹${SHIPPING_FREE_THRESHOLD} have a ₹${SHIPPING_STANDARD_FEE} shipping fee. Your order amount is ₹${amount}.`,
  };
}

/**
 * 2. RETURN POLICY:
 * - Returns are permitted within 7 days only if the product is unopened, unused, and in its original packaging.
 * - Damaged products must be reported within 48 hours with photos.
 * - An order delivered 14 days ago must not be marked return-eligible.
 */
export const RETURN_WINDOW_DAYS = 7;
export const DAMAGE_REPORT_WINDOW_HOURS = 48;

export function evaluateReturnEligibility(
  order: Order,
  criteria: {
    daysSinceDelivery?: number;
    isOpened?: boolean;
    isUsed?: boolean;
    isOriginalPackaging?: boolean;
    isDamaged?: boolean;
    hoursSinceDelivery?: number;
    hasPhotos?: boolean;
  } = {}
): ReturnEligibilityResult {
  const orderStatus = order.status;

  // Rule 1: Order must be delivered to initiate a return
  if (orderStatus !== "Delivered") {
    return {
      orderId: order.id,
      eligible: false,
      reason: `Cannot return Order ${order.id}. Current status is '${orderStatus}'. Returns can only be initiated after delivery.`,
      policyRule: "Return Eligibility: Delivered orders only",
      orderStatus,
      isWithinWindow: false,
    };
  }

  // Rule 2: Damaged goods handling
  if (criteria.isDamaged) {
    const hours = criteria.hoursSinceDelivery ?? 0;
    if (hours > DAMAGE_REPORT_WINDOW_HOURS) {
      return {
        orderId: order.id,
        eligible: false,
        reason: `Damaged products must be reported within ${DAMAGE_REPORT_WINDOW_HOURS} hours of delivery. This report was made after ${hours} hours.`,
        policyRule: "Damaged Goods Policy: 48-hour reporting limit",
        orderStatus,
        isWithinWindow: false,
        damageClaimValid: false,
      };
    }

    if (!criteria.hasPhotos) {
      return {
        orderId: order.id,
        eligible: false,
        reason: "Damaged product claims require photographic evidence for warehouse inspection.",
        policyRule: "Damaged Goods Policy: Photographic evidence mandatory",
        orderStatus,
        isWithinWindow: true,
        damageClaimValid: false,
      };
    }

    return {
      orderId: order.id,
      eligible: true,
      reason: `Damaged product claim accepted within ${DAMAGE_REPORT_WINDOW_HOURS} hours with photographic proof. Replacement or 100% refund authorized.`,
      policyRule: "Damaged Goods Policy: Authorized with photos within 48h",
      orderStatus,
      isWithinWindow: true,
      damageClaimValid: true,
    };
  }

  // Rule 3: Standard Return Window (within 7 days)
  const daysSinceDelivery =
    criteria.daysSinceDelivery !== undefined
      ? criteria.daysSinceDelivery
      : (order.daysSinceDelivery ?? 0);

  if (daysSinceDelivery > RETURN_WINDOW_DAYS) {
    return {
      orderId: order.id,
      eligible: false,
      reason: `Return window expired. Returns are permitted strictly within ${RETURN_WINDOW_DAYS} days of delivery. This order was delivered ${daysSinceDelivery} days ago.`,
      policyRule: `Return Window: ${RETURN_WINDOW_DAYS} calendar days from delivery`,
      orderStatus,
      isWithinWindow: false,
    };
  }

  // Rule 4: Product condition - must be unopened, unused, original packaging
  if (criteria.isOpened) {
    return {
      orderId: order.id,
      eligible: false,
      reason: "Product has been opened. Returns are permitted only if the product is unopened, unused, and in its original packaging.",
      policyRule: "Product Condition: Unopened and sealed packaging",
      orderStatus,
      isWithinWindow: true,
    };
  }

  if (criteria.isUsed) {
    return {
      orderId: order.id,
      eligible: false,
      reason: "Product has been used. Returns are permitted only if the product is unopened, unused, and in its original packaging.",
      policyRule: "Product Condition: Unused",
      orderStatus,
      isWithinWindow: true,
    };
  }

  if (criteria.isOriginalPackaging === false) {
    return {
      orderId: order.id,
      eligible: false,
      reason: "Product is missing its original packaging. Original packaging is required for return verification.",
      policyRule: "Product Condition: Original packaging intact",
      orderStatus,
      isWithinWindow: true,
    };
  }

  // Passed all criteria
  return {
    orderId: order.id,
    eligible: true,
    reason: `Order ${order.id} is fully eligible for return: delivered within ${RETURN_WINDOW_DAYS} days, unopened, unused, and in original packaging.`,
    policyRule: "Return Permitted: Meets 7-day unopened/unused criteria",
    orderStatus,
    isWithinWindow: true,
  };
}

/**
 * 3. CANCELLATION POLICY:
 * - Only orders with status 'Processing' can be cancelled.
 * - 'Shipped', 'Out for Delivery', and 'Delivered' orders cannot be cancelled.
 */
export function evaluateCancellationEligibility(
  order: Order
): { canCancel: boolean; policyCode: CancellationPolicyCode; reason: string } {
  if (order.status === "Cancelled") {
    return {
      canCancel: false,
      policyCode: "ALREADY_CANCELLED",
      reason: `Order ${order.id} is already cancelled.`,
    };
  }

  if (order.status === "Out for Delivery") {
    return {
      canCancel: false,
      policyCode: "CANNOT_CANCEL_OUT_FOR_DELIVERY",
      reason: `Order ${order.id} cannot be cancelled because it is currently Out for Delivery with ${order.courier || "the courier"}${order.trackingId ? ` (Tracking ID: ${order.trackingId})` : ""}. Only orders with status 'Processing' can be cancelled.`,
    };
  }

  if (order.status === "Delivered") {
    return {
      canCancel: false,
      policyCode: "CANNOT_CANCEL_DELIVERED",
      reason: `Order ${order.id} cannot be cancelled because it has already been Delivered. Customers may check return eligibility instead.`,
    };
  }

  if (order.status === "Shipped") {
    return {
      canCancel: false,
      policyCode: "CANNOT_CANCEL_SHIPPED",
      reason: `Order ${order.id} cannot be cancelled because it has already Shipped. Only orders with status 'Processing' can be cancelled.`,
    };
  }

  if (order.status === "Processing") {
    return {
      canCancel: true,
      policyCode: "CANCELLED_SUCCESS",
      reason: `Order ${order.id} is in 'Processing' status and is eligible for immediate cancellation.`,
    };
  }

  return {
    canCancel: false,
    policyCode: "CANNOT_CANCEL_SHIPPED",
    reason: `Order ${order.id} with status '${order.status}' cannot be cancelled.`,
  };
}

/**
 * 4. COD (CASH ON DELIVERY) POLICY:
 * - Cash or UPI is accepted for eligible COD orders up to ₹2,500.
 */
export const COD_MAX_LIMIT = 2500;

export function checkCodEligibility(amount: number): CodPolicyResult {
  const isEligible = amount <= COD_MAX_LIMIT;
  return {
    amount,
    isEligible,
    maxCodLimit: COD_MAX_LIMIT,
    paymentMethods: ["Cash", "UPI"],
    summary: isEligible
      ? `Order of ₹${amount} qualifies for Cash on Delivery. Cash or UPI is accepted upon delivery up to ₹${COD_MAX_LIMIT}.`
      : `Order of ₹${amount} exceeds the ₹${COD_MAX_LIMIT} limit for Cash on Delivery. Prepaid payment is required.`,
  };
}

// Complete policy reference object
export const AURA_POLICIES: Record<PolicyCategory, PolicyRule> = {
  shipping: {
    category: "shipping",
    title: "Shipping Policy",
    summary: "Free shipping on orders above ₹499; ₹50 fee applies for orders below ₹499.",
    keyPoints: [
      "Orders above ₹499: Complimentary Free Shipping.",
      "Orders below ₹499: Standard shipping fee of ₹50.",
      "Track deliveries via courier partners (BlueDart, Delhivery).",
    ],
    strictRules: [
      "Always quote ₹50 shipping fee for orders strictly below ₹499.",
      "Free shipping threshold is non-negotiable at ₹499.",
    ],
  },
  return: {
    category: "return",
    title: "7-Day Return Policy",
    summary:
      "Returns permitted within 7 days for unopened, unused products in original packaging. Damaged products must be reported within 48 hours with photos.",
    keyPoints: [
      "7-Day Window: Returns accepted within 7 calendar days of delivery.",
      "Product Condition: Must be completely unopened, unused, and in original packaging.",
      "Damaged Items: Must be reported within 48 hours of delivery accompanied by photographic proof.",
      "14-Day Exclusion: An order delivered 14 days ago is strictly ineligible for return.",
    ],
    strictRules: [
      "Never accept returns on orders delivered more than 7 days ago unless a verified 48h damage report exists.",
      "Never accept returns on opened or used products for change-of-mind.",
      "Photographs are mandatory for any damaged item claim.",
    ],
  },
  cancellation: {
    category: "cancellation",
    title: "Order Cancellation Policy",
    summary:
      "Only orders with status 'Processing' can be cancelled. Shipped, Out for Delivery, and Delivered orders cannot be cancelled.",
    keyPoints: [
      "Processing: Eligible for immediate cancellation and 100% refund.",
      "Out for Delivery: Cannot be cancelled mid-route.",
      "Delivered: Cannot be cancelled; check return eligibility instead.",
      "Shipped: In transit with courier; cannot be cancelled.",
    ],
    strictRules: [
      "Only status 'Processing' permits cancellation.",
      "Reject cancellation attempts on 'Out for Delivery', 'Shipped', or 'Delivered' orders with explicit policy reasons.",
    ],
  },
  cod: {
    category: "cod",
    title: "Cash on Delivery (COD) Policy",
    summary:
      "Cash or UPI is accepted for eligible COD orders up to ₹2,500.",
    keyPoints: [
      "Eligible threshold: Orders up to ₹2,500.",
      "Payment modes at doorstep: Cash or UPI accepted.",
      "Orders exceeding ₹2,500 must be prepaid.",
    ],
    strictRules: [
      "Enforce maximum ₹2,500 ceiling on COD orders.",
      "Confirm delivery personnel can accept both Cash and UPI.",
    ],
  },
  general: {
    category: "general",
    title: "General Customer Support Guidelines",
    summary: "Aura Skincare customer support rules: truthful, grounded, and polite.",
    keyPoints: [
      "Never invent, hallucinate, or assume order details.",
      "Never promise unauthorized refunds or policy exemptions.",
      "Do not expose unnecessary customer private information.",
    ],
    strictRules: [
      "Strictly ground all status statements in the database.",
      "Protect customer PII.",
    ],
  },
};

export function getPolicySummary(category?: PolicyCategory): string {
  if (category && AURA_POLICIES[category]) {
    const p = AURA_POLICIES[category];
    return `### ${p.title}\n${p.summary}\n\n**Key Points:**\n${p.keyPoints.map((k) => `- ${k}`).join("\n")}`;
  }
  return Object.values(AURA_POLICIES)
    .map(
      (p) =>
        `### ${p.title}\n${p.summary}\n\n**Key Points:**\n${p.keyPoints.map((k) => `- ${k}`).join("\n")}`
    )
    .join("\n\n---\n\n");
}
