import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as Blob | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file blob is required" },
        { status: 400 }
      );
    }

    const activeKey = process.env.OPENAI_API_KEY;

    if (!activeKey || !activeKey.startsWith("sk-")) {
      return NextResponse.json(
        {
          fallback: true,
          error: "No OpenAI API key configured on server. Client Web Speech Recognition is used.",
        },
        { status: 200 }
      );
    }

    // Call OpenAI Whisper API
    const whisperFormData = new FormData();
    whisperFormData.append("file", audioFile, "audio.webm");
    whisperFormData.append("model", "whisper-1");
    whisperFormData.append("language", "en");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeKey}`,
        },
        body: whisperFormData,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { fallback: true, error: `Whisper API error: ${errText}` },
        { status: 200 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      text: data.text || "",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Transcription failed";
    console.error("Transcribe API error:", err);
    return NextResponse.json({ fallback: true, error: msg }, { status: 500 });
  }
}
