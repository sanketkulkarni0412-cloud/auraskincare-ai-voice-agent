import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice = "nova" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text string is required for speech synthesis" },
        { status: 400 }
      );
    }

    const activeKey = process.env.OPENAI_API_KEY;

    // If no OpenAI key is configured, tell client to fall back to browser Web Speech API
    if (!activeKey || !activeKey.startsWith("sk-")) {
      return NextResponse.json({
        fallback: true,
        reason: "No OpenAI API key configured. Browser SpeechSynthesis will be utilized.",
      });
    }

    // Call OpenAI TTS API
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${activeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: voice, // 'nova' is warm, conversational, and ideal for Aria
        response_format: "mp3",
        speed: 1.05,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn("OpenAI TTS returned error, falling back to client speech:", errText);
      return NextResponse.json({
        fallback: true,
        reason: `OpenAI TTS error: ${response.status}`,
      });
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "TTS error";
    console.error("TTS endpoint exception:", err);
    return NextResponse.json({ fallback: true, error: msg });
  }
}
