import { AGENT_TOOLS, executeAgentTool } from "./tools";
import { ChatMessage, ToolCallRecord } from "./types";
import { normalizeOrderId } from "./orders";

export const ARIA_SYSTEM_PROMPT = `You are Aria, the premier AI Voice Concierge for Aura Skincare — a luxury, botanical-science skincare brand.

YOUR ROLE & PERSONA:
- Warm, articulate, elegant, and reassuring.
- You are speaking out loud over a live phone or voice call.
- Keep responses concise, direct, and voice-friendly (typically 1 to 3 conversational sentences).
- Do NOT use markdown asterisks (*), markdown bullet points (-), hashtags (#), or emojis in your spoken responses because they will be read literally by text-to-speech synthesizers.
- Spell out order numbers clearly when speaking (e.g., "A-U-R 1 0 0 1").

OFFICIAL POLICIES & GUARDRAILS (STRICT):
1. Cancellation: Orders can ONLY be cancelled while in PENDING or PROCESSING status. If an order has SHIPPED or is DELIVERED, it CANNOT be cancelled mid-transit under any circumstances. The customer must wait for delivery and initiate an unopened return within 14 days.
2. Returns: Must be initiated within 14 calendar days of delivery. Skincare products MUST be unopened and sealed with original packaging intact for cosmetic hygiene and safety. Opened/used products cannot be returned unless they arrived damaged or defective. A $5.99 return shipping fee is deducted for change-of-mind; free return shipping applies only if damaged or defective.
3. Shipping: Standard shipping is 3-5 business days (free over $50, else $4.99). Express shipping is 1-2 business days ($12.99).
4. Cash on Delivery (COD): Customer must provide exact cash upon delivery. Cancellations allowed only before dispatch.
5. NEVER invent, hallucinate, or guess order numbers, items, tracking IDs, or delivery dates. Always call 'get_order_details' to check real status.
6. NEVER promise unauthorized refunds or policy exemptions. If a customer demands a refund for a shipped order or an opened product, empathetically hold the company policy line.
7. Unclear speech: If you cannot understand the user or the audio is muffled, kindly ask them to repeat the question or provide their order number.
`;

export interface AgentResponse {
  message: string;
  toolCallsExecuted: ToolCallRecord[];
  orderIdReferenced?: string;
}

/**
 * Handle agent completion using OpenAI if API key exists,
 * or fallback to high-fidelity deterministic engine if no key is configured.
 */
export async function processAgentConversation(
  messages: ChatMessage[],
  apiKey?: string
): Promise<AgentResponse> {
  const activeKey = apiKey || process.env.OPENAI_API_KEY;

  if (activeKey && activeKey.startsWith("sk-")) {
    try {
      return await processOpenAIConversation(messages, activeKey);
    } catch (err) {
      console.warn("OpenAI API call failed, falling back to local agent:", err);
      // Fallback to local agent seamlessly
      return processDeterministicAgent(messages);
    }
  }

  // Zero-config local intelligent agent
  return processDeterministicAgent(messages);
}

/**
 * Real OpenAI GPT-4o-mini / GPT-4o execution with tool calling
 */
async function processOpenAIConversation(
  messages: ChatMessage[],
  apiKey: string
): Promise<AgentResponse> {
  const formattedMessages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: unknown[];
  }> = [
    { role: "system", content: ARIA_SYSTEM_PROMPT },
    ...messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  ];

  const toolsExecuted: ToolCallRecord[] = [];
  let orderIdReferenced: string | undefined;

  // First call to OpenAI to determine if tool calling is required
  const initialRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: formattedMessages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 250,
    }),
  });

  if (!initialRes.ok) {
    const errorText = await initialRes.text();
    throw new Error(`OpenAI HTTP ${initialRes.status}: ${errorText}`);
  }

  const initialData = await initialRes.json();
  const choice = initialData.choices?.[0];
  const responseMessage = choice?.message;

  if (!responseMessage) {
    throw new Error("No response message received from OpenAI.");
  }

  // Check if LLM requested tool calls
  if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
    formattedMessages.push(responseMessage);

    for (const toolCall of responseMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        toolArgs = {};
      }

      if (toolArgs.order_id) {
        orderIdReferenced = String(toolArgs.order_id);
      }

      const execution = await executeAgentTool(toolName, toolArgs);

      const record: ToolCallRecord = {
        id: toolCall.id,
        name: toolName,
        arguments: toolArgs,
        result: execution.result,
        timestamp: new Date().toISOString(),
      };
      toolsExecuted.push(record);

      formattedMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(execution.result),
      });
    }

    // Second call to OpenAI with tool outputs to generate the final voice response
    const finalRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: formattedMessages,
        temperature: 0.4,
        max_tokens: 250,
      }),
    });

    if (!finalRes.ok) {
      const errText = await finalRes.text();
      throw new Error(`OpenAI final call error ${finalRes.status}: ${errText}`);
    }

    const finalData = await finalRes.json();
    const finalContent =
      finalData.choices?.[0]?.message?.content ||
      "I've processed your request. Is there anything else I can assist you with?";

    return {
      message: cleanVoiceText(finalContent),
      toolCallsExecuted: toolsExecuted,
      orderIdReferenced,
    };
  }

  return {
    message: cleanVoiceText(responseMessage.content || ""),
    toolCallsExecuted: [],
  };
}

/**
 * Intelligent deterministic agent that executes real tools,
 * inspects order state, enforces company policy, and produces
 * human-quality natural voice responses without external API keys.
 */
function processDeterministicAgent(messages: ChatMessage[]): Promise<AgentResponse> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const query = (lastUserMsg?.content || "").trim().toLowerCase();
  const toolsExecuted: ToolCallRecord[] = [];

  // Pattern match order IDs like ORD-101, 101, ord102
  const orderMatch = query.match(/(?:ord[- ]?)?(\d{2,})/i);
  let detectedOrderId: string | null = null;
  if (orderMatch) {
    detectedOrderId = normalizeOrderId(orderMatch[0]);
  }

  // Helper to record tool
  const runTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<ReturnType<typeof executeAgentTool>> => {
    const exec = await executeAgentTool(name, args);
    toolsExecuted.push({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      arguments: args,
      result: exec.result,
      timestamp: new Date().toISOString(),
    });
    return exec;
  };

  return new Promise((resolve) => {
    (async () => {
      // 1. Cancellation Intent
      if (
        query.includes("cancel") ||
        query.includes("stop order") ||
        query.includes("abort")
      ) {
        if (!detectedOrderId) {
          resolve({
            message:
              "I would be glad to help you cancel your order. Could you please provide your order ID? For example, AUR 1 0 0 1.",
            toolCallsExecuted: [],
          });
          return;
        }

        // Check details first
        const detailExec = await runTool("get_order_details", {
          order_id: detectedOrderId,
        });

        if (!detailExec.success || !detailExec.result.found) {
          resolve({
            message: `I looked for order ${detectedOrderId}, but it doesn't appear in our system. Could you please double-check your order number from your confirmation email?`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }

        // Execute cancellation
        const cancelExec = await runTool("cancel_order", {
          order_id: detectedOrderId,
          reason: "Customer requested cancellation via voice concierge",
        });

        if (cancelExec.success) {
          resolve({
            message: `I've successfully cancelled order ${detectedOrderId} for you. A full refund has been issued to your original payment method and will appear in three to five business days.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        } else {
          // Cancellation failed due to policy (e.g. SHIPPED or DELIVERED)
          const policyMsg = String(cancelExec.result.message || "");
          if (cancelExec.result.policyReason === "INELIGIBLE_ALREADY_SHIPPED") {
            resolve({
              message: `I checked order ${detectedOrderId}, but it has already shipped with FedEx and is in transit. Because it has left our warehouse, we cannot cancel it mid-transit. Once it arrives, you are welcome to initiate an unopened return within fourteen days.`,
              toolCallsExecuted: toolsExecuted,
              orderIdReferenced: detectedOrderId,
            });
            return;
          }
          resolve({
            message: `I'm unable to cancel order ${detectedOrderId}. ${policyMsg}`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }
      }

      // 2. Return / Refund Intent
      if (
        query.includes("return") ||
        query.includes("refund") ||
        query.includes("send back")
      ) {
        if (!detectedOrderId) {
          resolve({
            message:
              "I can assist you with our 14-day return policy. Could you please share your order ID, and let me know if the product packaging is still sealed?",
            toolCallsExecuted: [],
          });
          return;
        }

        // Fetch details
        const detailExec = await runTool("get_order_details", {
          order_id: detectedOrderId,
        });

        if (!detailExec.success || !detailExec.result.found) {
          resolve({
            message: `I wasn't able to locate order ${detectedOrderId} in our database. Please verify your order number and I'll be happy to check again.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }

        const isOpened =
          query.includes("opened") ||
          query.includes("unsealed") ||
          query.includes("used") ||
          query.includes("tried");
        const isDefective =
          query.includes("defective") ||
          query.includes("damaged") ||
          query.includes("broken") ||
          query.includes("spilled");

        // Attempt return
        const returnExec = await runTool("request_return", {
          order_id: detectedOrderId,
          reason: "Customer return request via voice concierge",
          is_opened: isOpened,
          is_defective: isDefective,
        });

        if (returnExec.success) {
          resolve({
            message: `I have authorized the return for order ${detectedOrderId}. A prepaid return shipping label has been emailed to you. Your refund will be processed once inspected at our facility.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        } else {
          if (returnExec.result.policyReason === "RETURN_WINDOW_EXPIRED") {
            resolve({
              message: `I'm sorry, but order ${detectedOrderId} was delivered over fourteen days ago. Under our company policy, returns can only be accepted within fourteen days of delivery.`,
              toolCallsExecuted: toolsExecuted,
              orderIdReferenced: detectedOrderId,
            });
            return;
          }
          if (returnExec.result.policyReason === "OPENED_HYGIENE_VIOLATION") {
            resolve({
              message: `Because skincare products cannot be resold for cosmetic hygiene and safety reasons once opened, we cannot accept returns on opened items unless they arrived damaged or defective.`,
              toolCallsExecuted: toolsExecuted,
              orderIdReferenced: detectedOrderId,
            });
            return;
          }
          if (returnExec.result.policyReason === "NOT_DELIVERED") {
            resolve({
              message: `Order ${detectedOrderId} cannot be returned yet because it has not been delivered. Once you receive the package, you can initiate a return if it remains unopened.`,
              toolCallsExecuted: toolsExecuted,
              orderIdReferenced: detectedOrderId,
            });
            return;
          }
          resolve({
            message: `I'm sorry, but we cannot authorize a return for order ${detectedOrderId}. ${returnExec.result.message}`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }
      }

      // 3. Order Status / Tracking Query
      if (
        detectedOrderId ||
        query.includes("where is my order") ||
        query.includes("status") ||
        query.includes("tracking") ||
        query.includes("track")
      ) {
        if (!detectedOrderId) {
          resolve({
            message:
              "I would be happy to track your shipment. Please provide your order ID, such as AUR 1 0 0 1.",
            toolCallsExecuted: [],
          });
          return;
        }

        const detailExec = await runTool("get_order_details", {
          order_id: detectedOrderId,
        });

        if (!detailExec.success || !detailExec.result.found) {
          resolve({
            message: `I could not find order ${detectedOrderId} in our records. Please double-check the order number from your confirmation email.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }

        const o = detailExec.result.order as Record<string, unknown>;
        const status = String(o.status || "");

        if (status.toLowerCase().includes("out for delivery")) {
          resolve({
            message: `Order ${detectedOrderId} is currently out for delivery with ${o.courier || "the courier"}, tracking ID ${o.trackingId || ""}. Expected delivery is ${o.expectedDelivery || "today"}.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }
        if (status.toLowerCase().includes("processing")) {
          resolve({
            message: `Order ${detectedOrderId} is currently in processing. It contains ${o.products}. Since it has not been dispatched yet, it is eligible for cancellation if needed.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }
        if (status.toLowerCase().includes("delivered")) {
          resolve({
            message: `Order ${detectedOrderId} was delivered ${o.deliveredAt || "to your address"}. Please let me know if you need assistance with return eligibility or product usage.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }
        if (status.toLowerCase().includes("cancelled")) {
          resolve({
            message: `Order ${detectedOrderId} has been cancelled and refund processing has been initiated.`,
            toolCallsExecuted: toolsExecuted,
            orderIdReferenced: detectedOrderId,
          });
          return;
        }

        resolve({
          message: `Order ${detectedOrderId} is currently ${status}. Total is $${Number(o.total).toFixed(2)}. Is there anything specific you would like to know about it?`,
          toolCallsExecuted: toolsExecuted,
          orderIdReferenced: detectedOrderId,
        });
        return;
      }

      // 4. Policy Queries (Shipping, Cancellation, Return, COD)
      if (query.includes("policy") || query.includes("how long") || query.includes("how much") || query.includes("shipping")) {
        let cat: "cancellation" | "return" | "shipping" | "cod" = "shipping";
        if (query.includes("cancel")) cat = "cancellation";
        else if (query.includes("return") || query.includes("refund")) cat = "return";
        else if (query.includes("cod") || query.includes("cash")) cat = "cod";

        await runTool("lookup_policy", { category: cat });

        if (cat === "shipping") {
          resolve({
            message:
              "We offer complimentary standard shipping on all orders over fifty dollars, which typically delivers in three to five business days. Express shipping is also available for twelve ninety-nine and delivers in one to two business days.",
            toolCallsExecuted: toolsExecuted,
          });
          return;
        }
        if (cat === "cancellation") {
          resolve({
            message:
              "Orders can be cancelled anytime while they are in pending or processing status before dispatch. Once an order has shipped, it cannot be intercepted mid-transit.",
            toolCallsExecuted: toolsExecuted,
          });
          return;
        }
        if (cat === "return") {
          resolve({
            message:
              "We gladly accept returns within fourteen days of delivery for unopened, sealed products in their original packaging. Opened items cannot be returned due to cosmetic hygiene rules.",
            toolCallsExecuted: toolsExecuted,
          });
          return;
        }
        if (cat === "cod") {
          resolve({
            message:
              "Cash on delivery is available in select areas. Couriers do not carry loose change, so please have the exact cash payment ready upon delivery.",
            toolCallsExecuted: toolsExecuted,
          });
          return;
        }
      }

      // 5. Greetings / General inquiry
      if (
        query.includes("hello") ||
        query.includes("hi") ||
        query.includes("hey") ||
        query.includes("good morning") ||
        query.includes("good afternoon")
      ) {
        resolve({
          message:
            "Hello! I am Aria, your Aura Skincare concierge. I can help you track orders, review policies, or process eligible cancellations and returns. How may I assist you today?",
          toolCallsExecuted: [],
        });
        return;
      }

      // 6. Default Fallback / Clarification
      resolve({
        message:
          "I want to make sure I assist you properly. If you are inquiring about an order, could you please mention your order ID like AUR 1 0 0 1, or let me know if you have a question regarding shipping, cancellations, or returns?",
        toolCallsExecuted: [],
      });
    })();
  });
}

/**
 * Remove markdown symbols that sound poor on TTS
 */
function cleanVoiceText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^#+\s+/gm, "")
    .replace(/^-\s+/gm, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
