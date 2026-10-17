import { NextRequest, NextResponse } from "next/server";
import { checkOrderReturnEligibility } from "@/lib/orders";
import { ReturnEligibilityRequestSchema } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          errorCode: "INVALID_JSON",
          error: "Invalid request payload. Expected JSON body.",
        },
        { status: 400 }
      );
    }

    const parsed = ReturnEligibilityRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "VALIDATION_ERROR",
          error: parsed.error.issues[0]?.message || "Invalid return eligibility request.",
        },
        { status: 400 }
      );
    }

    const {
      orderId,
      daysSinceDelivery,
      isOpened,
      isUsed,
      isOriginalPackaging,
      isDamaged,
      hoursSinceDelivery,
      hasPhotos,
    } = parsed.data;

    const evaluation = checkOrderReturnEligibility(orderId, {
      daysSinceDelivery,
      isOpened,
      isUsed,
      isOriginalPackaging,
      isDamaged,
      hoursSinceDelivery,
      hasPhotos,
    });

    if (!evaluation.found) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "NOT_FOUND",
          orderId,
          error: evaluation.error || `Order '${orderId}' was not found.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      result: {
        orderId: evaluation.orderId,
        eligible: evaluation.eligible,
        reason: evaluation.reason,
        policyRule: evaluation.policyRule,
        orderStatus: evaluation.orderStatus,
        isWithinWindow: evaluation.isWithinWindow,
        damageClaimValid: evaluation.damageClaimValid,
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        errorCode: "INTERNAL_ERROR",
        error: "Unable to evaluate return eligibility at this time.",
      },
      { status: 500 }
    );
  }
}
