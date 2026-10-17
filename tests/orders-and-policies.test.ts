import {
  normalizeOrderId,
  get_order_details,
  cancelOrder,
  checkOrderReturnEligibility,
  resetOrdersDatabase,
  getAllOrders,
} from "../src/lib/orders";
import {
  calculateShippingFee,
  checkCodEligibility,
  evaluateCancellationEligibility,
  evaluateReturnEligibility,
} from "../src/lib/policies";
import { CancelOrderRequestSchema, ReturnEligibilityRequestSchema } from "../src/lib/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runTests() {
  console.log("\n========================================================");
  console.log("  AURA SKINCARE: ORDERS & POLICIES TEST SUITE (DataStraw)");
  console.log("========================================================\n");

  resetOrdersDatabase();

  // 1. Case-insensitive Order ID Normalization
  console.log("--- Group 1: Case-Insensitive Order ID Normalization ---");
  assert(normalizeOrderId("ord-101") === "ORD-101", "Normalizes 'ord-101' -> 'ORD-101'");
  assert(normalizeOrderId("ORD101") === "ORD-101", "Normalizes 'ORD101' -> 'ORD-101'");
  assert(normalizeOrderId("ORD-101") === "ORD-101", "Normalizes canonical 'ORD-101' -> 'ORD-101'");
  assert(normalizeOrderId("ord 102") === "ORD-102", "Normalizes 'ord 102' -> 'ORD-102'");
  assert(normalizeOrderId("103") === "ORD-103", "Normalizes bare digits '103' -> 'ORD-103'");
  assert(normalizeOrderId("ord_103") === "ORD-103", "Normalizes underscore 'ord_103' -> 'ORD-103'");

  // 2. Existing and Missing Orders
  console.log("\n--- Group 2: Existing & Missing Orders ---");
  const allInitialOrders = getAllOrders();
  assert(allInitialOrders.length === 3, "getAllOrders() returns all 3 sample orders");

  const ord101 = get_order_details("ord-101");
  assert(ord101.found === true, "Finds ORD-101 (Priya Sharma)");
  assert(evaluateCancellationEligibility(ord101.rawOrder!).canCancel === false, "Direct policy evaluation marks ORD-101 ineligible for cancellation");
  assert(ord101.order?.customer === "Priya Sharma", "Correct customer name: Priya Sharma");
  assert(ord101.order?.products === "Vitamin C Serum 30ml", "Correct product: Vitamin C Serum 30ml");
  assert(ord101.order?.amount === 699, "Correct amount: ₹699");
  assert(ord101.order?.status === "Out for Delivery", "Correct status: Out for Delivery");
  assert(ord101.order?.courier === "BlueDart", "Correct courier: BlueDart");
  assert(ord101.order?.trackingId === "BD-982103", "Correct tracking ID: BD-982103");
  assert(ord101.order?.expectedDelivery === "6 PM today", "Correct expected delivery: 6 PM today");

  const ord102 = get_order_details("ORD102");
  assert(ord102.found === true, "Finds ORD-102 (Rahul Verma)");
  assert(ord102.order?.status === "Delivered", "ORD-102 status is Delivered");
  assert(ord102.order?.deliveredAt === "14 days ago", "ORD-102 delivered 14 days ago");
  assert(ord102.order?.courier === "Delhivery", "ORD-102 courier is Delhivery");

  const ord103 = get_order_details("ORD-103");
  assert(ord103.found === true, "Finds ORD-103 (Ananya Patel)");
  assert(ord103.order?.status === "Processing", "ORD-103 status is Processing");
  assert(ord103.order?.amount === 850, "ORD-103 amount is ₹850");

  const missingOrder = get_order_details("ORD-999");
  assert(missingOrder.found === false, "Handles unknown order ORD-999 cleanly");
  assert(missingOrder.errorCode === "NOT_FOUND", "Returns errorCode 'NOT_FOUND'");
  assert(typeof missingOrder.error === "string", "Returns clear error explanation");

  const emptyOrder = get_order_details("");
  assert(emptyOrder.found === false, "Rejects empty order ID string");
  assert(emptyOrder.errorCode === "INVALID_ID", "Returns errorCode 'INVALID_ID'");

  // 3. Shipping Policy Thresholds
  console.log("\n--- Group 3: Shipping Policy Thresholds ---");
  const shippingAbove = calculateShippingFee(699);
  assert(shippingAbove.isFreeShipping === true, "Order of ₹699 qualifies for free shipping");
  assert(shippingAbove.shippingFee === 0, "Order of ₹699 has ₹0 shipping fee");

  const shippingAtThreshold = calculateShippingFee(499);
  assert(shippingAtThreshold.isFreeShipping === true, "Order of ₹499 qualifies for free shipping");
  assert(shippingAtThreshold.shippingFee === 0, "Order of ₹499 has ₹0 shipping fee");

  const shippingBelow = calculateShippingFee(350);
  assert(shippingBelow.isFreeShipping === false, "Order of ₹350 does NOT qualify for free shipping");
  assert(shippingBelow.shippingFee === 50, "Order of ₹350 incurs standard ₹50 shipping fee");

  // 4. COD Policy Limits
  console.log("\n--- Group 4: Cash on Delivery (COD) Policy ---");
  const codEligible = checkCodEligibility(850);
  assert(codEligible.isEligible === true, "Order of ₹850 is eligible for COD");
  assert(codEligible.paymentMethods.includes("UPI"), "COD accepts UPI upon delivery");
  assert(codEligible.paymentMethods.includes("Cash"), "COD accepts Cash upon delivery");

  const codThreshold = checkCodEligibility(2500);
  assert(codThreshold.isEligible === true, "Order of ₹2,500 exactly meets COD limit");

  const codExceeded = checkCodEligibility(2501);
  assert(codExceeded.isEligible === false, "Order of ₹2,501 exceeds COD limit (requires prepaid)");

  // 5. Return Eligibility Policy
  console.log("\n--- Group 5: Return Eligibility Policy ---");
  // Test ORD-102 (Delivered 14 days ago) -> MUST NOT be marked return-eligible!
  const ord102Return = checkOrderReturnEligibility("ORD-102", {
    isOpened: false,
    isUsed: false,
    isOriginalPackaging: true,
  });
  assert(ord102Return.eligible === false, "ORD-102 delivered 14 days ago is REJECTED for return");
  assert(
    ord102Return.reason.includes("Return window expired") ||
      ord102Return.reason.includes("within 7 days"),
    "Rejection specifies 7-day window expiration"
  );

  // Test hypothetical fresh delivered order within 7 days, unopened
  const freshEligibleReturn = evaluateReturnEligibility(
    {
      id: "ORD-TEST-FRESH",
      customer: "Test User",
      products: "Aura Serum",
      amount: 699,
      currency: "₹",
      status: "Delivered",
      daysSinceDelivery: 3,
    },
    { isOpened: false, isUsed: false, isOriginalPackaging: true }
  );
  assert(freshEligibleReturn.eligible === true, "Unopened order delivered 3 days ago is eligible for return");

  // Test opened product within 7 days -> MUST BE REJECTED
  const openedReturn = evaluateReturnEligibility(
    {
      id: "ORD-TEST-OPENED",
      customer: "Test User",
      products: "Aura Serum",
      amount: 699,
      currency: "₹",
      status: "Delivered",
      daysSinceDelivery: 3,
    },
    { isOpened: true, isUsed: false, isOriginalPackaging: true }
  );
  assert(openedReturn.eligible === false, "Opened product within 7 days is REJECTED for return");
  assert(openedReturn.reason.includes("opened"), "Rejection reason mentions opened condition");

  // Test damaged product reported within 48h with photos -> ELIGIBLE
  const damagedEligible = evaluateReturnEligibility(
    {
      id: "ORD-TEST-DAMAGED",
      customer: "Test User",
      products: "Aura Serum",
      amount: 699,
      currency: "₹",
      status: "Delivered",
      daysSinceDelivery: 1,
    },
    { isDamaged: true, hoursSinceDelivery: 24, hasPhotos: true }
  );
  assert(damagedEligible.eligible === true, "Damaged product with photos within 24 hours is approved");

  // Test damaged product reported after 48h -> REJECTED
  const damagedLate = evaluateReturnEligibility(
    {
      id: "ORD-TEST-DAMAGED-LATE",
      customer: "Test User",
      products: "Aura Serum",
      amount: 699,
      currency: "₹",
      status: "Delivered",
      daysSinceDelivery: 4,
    },
    { isDamaged: true, hoursSinceDelivery: 72, hasPhotos: true }
  );
  assert(damagedLate.eligible === false, "Damaged product reported after 72 hours (> 48h) is REJECTED");

  // Test non-delivered order return attempt -> REJECTED
  const nonDeliveredReturn = checkOrderReturnEligibility("ORD-101");
  assert(nonDeliveredReturn.eligible === false, "Out for Delivery order ORD-101 cannot be returned");

  // 6. Cancellation Policy: Processing vs Out for Delivery vs Delivered
  console.log("\n--- Group 6: Controlled Cancellation Operations ---");
  // Test rejecting cancellation for ORD-101 (Out for Delivery)
  const cancel101 = cancelOrder("ORD-101", "Changed mind");
  assert(cancel101.success === false, "Strictly rejects cancellation of Out for Delivery order ORD-101");
  assert(
    cancel101.policyCode === "CANNOT_CANCEL_OUT_FOR_DELIVERY",
    "Returns policyCode 'CANNOT_CANCEL_OUT_FOR_DELIVERY'"
  );
  assert(cancel101.message.includes("BlueDart"), "Reason mentions courier name (BlueDart)");

  // Verify ORD-101 status was NOT modified
  const verify101 = get_order_details("ORD-101");
  assert(verify101.order?.status === "Out for Delivery", "ORD-101 status remains 'Out for Delivery'");

  // Test rejecting cancellation for ORD-102 (Delivered)
  const cancel102 = cancelOrder("ORD-102", "Don't want it anymore");
  assert(cancel102.success === false, "Strictly rejects cancellation of Delivered order ORD-102");
  assert(
    cancel102.policyCode === "CANNOT_CANCEL_DELIVERED",
    "Returns policyCode 'CANNOT_CANCEL_DELIVERED'"
  );

  // Test successful cancellation for ORD-103 (Processing)
  const cancel103 = cancelOrder("ORD-103", "Placed duplicate order by mistake");
  assert(cancel103.success === true, "Successfully cancels Processing order ORD-103");
  assert(cancel103.policyCode === "CANCELLED_SUCCESS", "Returns policyCode 'CANCELLED_SUCCESS'");
  assert(cancel103.previousStatus === "Processing", "Previous status was 'Processing'");
  assert(cancel103.newStatus === "Cancelled", "New status is 'Cancelled'");

  // Verify in-memory database was actually updated
  const verify103 = get_order_details("ORD-103");
  assert(verify103.order?.status === "Cancelled", "In-memory database reflects status 'Cancelled' for ORD-103");

  // Test attempting to cancel already cancelled order
  const cancel103Again = cancelOrder("ORD-103");
  assert(cancel103Again.success === false, "Prevents duplicate cancellation of already cancelled order");
  assert(cancel103Again.policyCode === "ALREADY_CANCELLED", "Identifies 'ALREADY_CANCELLED'");

  // 7. Zod Schema Validation & Input Sanitization
  console.log("\n--- Group 7: Zod Schemas & Input Validation ---");
  const validCancelParsed = CancelOrderRequestSchema.safeParse({ orderId: "ORD-103", reason: "Valid reason" });
  assert(validCancelParsed.success === true, "Valid cancel request parses successfully");

  const invalidCancelParsed = CancelOrderRequestSchema.safeParse({ orderId: "" });
  assert(invalidCancelParsed.success === false, "Zod catches empty orderId in cancellation schema");

  const validReturnParsed = ReturnEligibilityRequestSchema.safeParse({
    orderId: "ORD-102",
    isOpened: false,
    isUsed: false,
    isOriginalPackaging: true,
  });
  assert(validReturnParsed.success === true, "Valid return eligibility request parses successfully");

  // Reset database after test execution
  resetOrdersDatabase();
  const resetCheck = get_order_details("ORD-103");
  assert(resetCheck.order?.status === "Processing", "resetOrdersDatabase() successfully resets ORD-103 to 'Processing'");

  console.log("\n========================================================");
  console.log("  ALL TESTS PASSED WITH 100% SUCCESS!");
  console.log("========================================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
