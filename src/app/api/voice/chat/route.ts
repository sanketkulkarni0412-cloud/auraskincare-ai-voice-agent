import { NextRequest, NextResponse } from "next/server";
import { processAgentConversation } from "@/lib/agent";
import { ChatMessage } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages } = body as {
      messages: ChatMessage[];
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Invalid payload: 'messages' array required" },
        { status: 400 }
      );
    }

    const response = await processAgentConversation(messages);
    return NextResponse.json({
      success: true,
      message: response.message,
      toolCalls: response.toolCallsExecuted,
      orderIdReferenced: response.orderIdReferenced,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error in voice agent processing";
    console.error("Agent chat route error:", err);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        message: "I apologize, but I encountered a momentary connection issue. Please try repeating your request.",
      },
      { status: 500 }
    );
  }
}
