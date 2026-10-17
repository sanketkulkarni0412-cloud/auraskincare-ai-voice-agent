import { getOrderById, cancelOrder, returnOrder } from "./orders";
import { AURA_POLICIES } from "./policies";

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_order_details",
      description:
        "Fetch real-time details of a customer's order by order ID (e.g., 'AUR-1001'). Always use this tool when the customer mentions an order ID, asks about status, shipping, items, tracking, or wants to make changes.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description:
              "The unique order identifier, usually in format 'AUR-XXXX' (e.g. 'AUR-1001', '1001', or 'aur-1002').",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_order",
      description:
        "Request cancellation and full refund for an order. Can ONLY succeed if the order status is PENDING or PROCESSING. Shipped or delivered orders cannot be cancelled.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to cancel (e.g., 'AUR-1001').",
          },
          reason: {
            type: "string",
            description: "The customer's reason for cancellation (e.g. 'Accidental purchase', 'Found alternative', 'Changed mind').",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_return",
      description:
        "Initiate a return for a delivered order. Allowed only within 14 days of delivery. Products MUST be unopened and sealed, unless they arrived defective or damaged.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID to return (e.g., 'AUR-1003').",
          },
          reason: {
            type: "string",
            description: "The reason for returning the product.",
          },
          is_opened: {
            type: "boolean",
            description:
              "Whether the product packaging or safety seal has been opened or broken by the customer. Skincare products that are opened cannot be returned unless defective.",
          },
          is_defective: {
            type: "boolean",
            description:
              "Whether the item arrived defective, damaged, or incorrect from warehouse.",
          },
        },
        required: ["order_id", "reason", "is_opened"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_policy",
      description:
        "Retrieve official Aura Skincare customer policies regarding cancellation, returns, shipping, Cash on Delivery (COD), or general guidelines.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["cancellation", "return", "shipping", "cod", "general"],
            description: "The category of policy the customer is inquiring about.",
          },
        },
        required: ["category"],
      },
    },
  },
];

/**
 * Execute tool calls and return structured results
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{
  success: boolean;
  result: Record<string, unknown>;
  voicePromptSummary: string;
}> {
  try {
    switch (toolName) {
      case "get_order_details": {
        const orderId = String(args.order_id || "");
        const res = getOrderById(orderId);

        if (!res.found || !res.order) {
          return {
            success: false,
            result: {
              found: false,
              order_id: orderId,
              normalized_id: res.normalizedId,
              message: res.error,
            },
            voicePromptSummary: `Order ${orderId} was not found in our database. Politely inform the customer, ask them to verify the order number on their confirmation email, and mention that test orders are AUR-1001 through AUR-1006.`,
          };
        }

        const order = res.order;

        return {
          success: true,
          result: {
            found: true,
            order,
          },
          voicePromptSummary: `Order ${order.orderId} found for ${order.customer}. Status: ${order.status}. Products: ${order.products}. Total: ${order.currency}${order.amount}. ${
            order.status === "Out for Delivery"
              ? `Out for delivery with ${order.courier}, tracking ID ${order.trackingId}. Expected delivery: ${order.expectedDelivery}. Cannot be cancelled mid-route.`
              : order.status === "Delivered"
              ? `Delivered ${order.deliveredAt}.`
              : order.status === "Processing"
              ? `Currently in warehouse processing. Ordered ${order.orderedAt || "recently"}. Eligible for cancellation.`
              : `Status: ${order.status}.`
          }`,
        };
      }

      case "cancel_order": {
        const orderId = String(args.order_id || "");
        const reason = String(args.reason || "Customer requested cancellation via voice concierge");
        const res = cancelOrder(orderId, reason);

        return {
          success: res.success,
          result: {
            ...res,
          },
          voicePromptSummary: res.success
            ? `Successfully cancelled Order ${orderId}. Full refund will be credited back within 3 to 5 business days.`
            : `Could not cancel Order ${orderId}. Policy reason: ${res.message}.`,
        };
      }

      case "request_return": {
        const orderId = String(args.order_id || "");
        const reason = String(args.reason || "Customer return request");
        const isOpened = Boolean(args.is_opened);
        const isDefective = Boolean(args.is_defective);

        const res = returnOrder(orderId, reason, isOpened, isDefective);

        return {
          success: res.success,
          result: {
            ...res,
          },
          voicePromptSummary: res.success
            ? `Return authorized for Order ${orderId}. Reason: ${res.message}.`
            : `Return rejected for Order ${orderId}. Reason: ${res.message}.`,
        };
      }

      case "lookup_policy": {
        const rawCat = typeof args.category === "string" ? args.category : "general";
        const category = (rawCat in AURA_POLICIES ? rawCat : "general") as keyof typeof AURA_POLICIES;
        const policy = AURA_POLICIES[category];

        return {
          success: true,
          result: {
            policy,
          },
          voicePromptSummary: `Official policy on ${category}: ${policy.summary}. Key points: ${policy.keyPoints.join("; ")}`,
        };
      }

      default:
        return {
          success: false,
          result: { error: `Unknown tool: ${toolName}` },
          voicePromptSummary: `Tool ${toolName} not supported.`,
        };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      result: { error: errorMsg },
      voicePromptSummary: `An unexpected error occurred while executing ${toolName}: ${errorMsg}`,
    };
  }
}
