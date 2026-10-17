import { NextRequest, NextResponse } from "next/server";
import { cancelOrder } from "@/lib/orders";
import { CancelOrderRequestSchema } from "@/lib/types";

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
          error: "Invalid request payload. Expected JSON body with 'orderId'.",
        },
        { status: 400 }
      );
    }

    const parsed = CancelOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "VALIDATION_ERROR",
          error: parsed.error.issues[0]?.message || "Invalid cancellation request.",
        },
        { status: 400 }
      );
    }

    const { orderId, reason } = parsed.data;
    const result = cancelOrder(orderId, reason);

    if (result.policyCode === "NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          policyCode: result.policyCode,
          orderId: result.orderId,
          message: result.message,
        },
        { status: 404 }
      );
    }

    if (!result.success) {
      // Cancellation rejected due to business policy
      return NextResponse.json(
        {
          success: false,
          policyCode: result.policyCode,
          orderId: result.orderId,
          previousStatus: result.previousStatus,
          message: result.message,
        },
        { status: 422 }
      );
    }

    // Cancellation succeeded
    return NextResponse.json(
      {
        success: true,
        policyCode: result.policyCode,
        orderId: result.orderId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        message: result.message,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        errorCode: "INTERNAL_ERROR",
        message: "An internal server error occurred while processing the cancellation.",
      },
      { status: 500 }
    );
  }
}
