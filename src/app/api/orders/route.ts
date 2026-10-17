import { NextRequest, NextResponse } from "next/server";
import {
  getAllOrders,
  get_order_details,
  toSafeOrderDetails,
  resetOrdersDatabase,
} from "@/lib/orders";
import { OrderLookupQuerySchema } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderIdParam = searchParams.get("orderId") || searchParams.get("id");
    const action = searchParams.get("action");

    // Reset database action
    if (action === "reset") {
      resetOrdersDatabase();
      return NextResponse.json({
        success: true,
        message: "Order database reset to original sample orders.",
      });
    }

    // Lookup specific order if orderId provided
    if (orderIdParam) {
      const parsed = OrderLookupQuerySchema.safeParse({ orderId: orderIdParam });
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            errorCode: "VALIDATION_ERROR",
            error: parsed.error.issues[0]?.message || "Invalid order ID format.",
          },
          { status: 400 }
        );
      }

      const result = get_order_details(parsed.data.orderId);

      if (!result.found) {
        return NextResponse.json(
          {
            success: false,
            errorCode: result.errorCode || "NOT_FOUND",
            normalizedId: result.normalizedId,
            error: result.error,
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        order: result.order,
      });
    }

    // Return list of all orders (safe view)
    const orders = getAllOrders().map(toSafeOrderDetails);
    return NextResponse.json({
      success: true,
      orders,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        errorCode: "INTERNAL_ERROR",
        error: "Unable to process order request. Please try again.",
      },
      { status: 500 }
    );
  }
}
