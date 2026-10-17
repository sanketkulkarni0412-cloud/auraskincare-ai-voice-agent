import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runGeminiChat } from "@/lib/gemini";
import { parseGeminiError, logGeminiDiagnostic } from "@/lib/gemini-errors";

// Zod validation for chat request payload
const ChatRequestSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(1000, "Message is too long (maximum 1,000 characters allowed)"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(2000, "History message content exceeds maximum length"),
      })
    )
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  try {
    // Check request payload size limit (max 50KB)
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 50000) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "PAYLOAD_TOO_LARGE",
          error: "Request body size exceeds the 50KB limit.",
        },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          errorCode: "INVALID_JSON",
          error: "Invalid JSON in request body.",
        },
        { status: 400 }
      );
    }

    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "VALIDATION_ERROR",
          error: parsed.error.issues[0]?.message || "Invalid chat request format.",
        },
        { status: 400 }
      );
    }

    const { message, history } = parsed.data;

    // Check if GEMINI_API_KEY is configured on the server
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          isConfigured: false,
          errorCode: "MISSING_GEMINI_API_KEY",
          error:
            "GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your .env.local file.",
          reply:
            "Aria is currently in standby because GEMINI_API_KEY is not configured on the server. Please add your GEMINI_API_KEY in .env.local to activate live Gemini AI customer support.",
          toolCalls: [],
        },
        { status: 200 }
      );
    }

    // Call Gemini with real function calling
    const result = await runGeminiChat(message, history, apiKey);

    return NextResponse.json({
      success: true,
      isConfigured: true,
      reply: result.reply,
      toolCalls: result.toolCalls,
      model: result.model,
      isLiveGemini: true,
    });
  } catch (err: unknown) {
    const classified = parseGeminiError(err);
    logGeminiDiagnostic(classified, "api/chat");

    const responseHeaders: Record<string, string> = {
      "Cache-Control": "no-store",
    };
    if (classified.retryAfterSeconds !== undefined) {
      responseHeaders["Retry-After"] = String(classified.retryAfterSeconds);
    }

    return NextResponse.json(
      {
        success: false,
        errorCode: classified.errorCode,
        upstreamStatus: classified.upstreamStatus,
        error: classified.sanitizedMessage,
        reply: classified.userReply,
        toolCalls: [],
      },
      {
        status: classified.httpStatus,
        headers: responseHeaders,
      }
    );
  }
}
