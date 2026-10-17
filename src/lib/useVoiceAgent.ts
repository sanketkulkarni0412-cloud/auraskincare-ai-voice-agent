/**
 * useVoiceAgent — Modular voice-agent hook for Aura Skincare / Aria
 *
 * Architecture:
 *   Browser Microphone
 *     → Web Speech API SpeechRecognition (STT, primary, no key required)
 *     → /api/chat  (Gemini function-calling, server-side)
 *     → Web Speech API SpeechSynthesis (TTS, primary, no key required)
 *       ↳ /api/voice/speak OpenAI TTS (premium if OPENAI_API_KEY is set)
 *
 * State machine:
 *   IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
 */

import { useRef, useState, useCallback, useEffect, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export type VoiceState =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "ERROR";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface VoiceAgentOptions {
  /** Called when the agent receives a final transcript from STT */
  onTranscript?: (text: string) => void;
  /** Called when the LLM returns a reply */
  onReply?: (text: string, toolCalls?: ToolCallRecord[]) => void;
  /** Called on any error */
  onError?: (message: string) => void;
  /** Conversation history slice to include in each /api/chat request */
  history?: Array<{ role: string; content: string }>;
}

// Minimal Web Speech API type shims — avoids requiring @types/dom-speech-recognition
// and works across Chrome, Edge, and Safari where these types differ.
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultEntry {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItem;
  item(index: number): SpeechRecognitionResultItem;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResultEntry;
  item(index: number): SpeechRecognitionResultEntry;
}
interface SpeechRecognitionEventShim {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventShim {
  error: string;
  message?: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventShim) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventShim) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Speak text via browser SpeechSynthesis. Resolves when utterance ends.
 */
function speakWithBrowserTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.toLowerCase().includes("female") ||
          v.name.toLowerCase().includes("samantha") ||
          v.name.toLowerCase().includes("zira") ||
          v.name.toLowerCase().includes("aria") ||
          v.name.toLowerCase().includes("google uk english female"))
    );
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.lang = "en-IN";
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Try OpenAI TTS via /api/voice/speak; fall back to browser SpeechSynthesis.
 */
async function speakText(text: string): Promise<void> {
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "nova" }),
    });

    if (!res.ok) {
      await speakWithBrowserTTS(text);
      return;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("audio")) {
      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      });
      return;
    }

    // Server returned JSON — check if it requested a fallback
    const json = (await res.json()) as { fallback?: boolean };
    if (json.fallback) {
      await speakWithBrowserTTS(text);
    }
  } catch {
    await speakWithBrowserTTS(text);
  }
}

export function useVoiceAgent(options: VoiceAgentOptions = {}) {
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [interimTranscript, setInterimTranscript] = useState<string>("");

  const isSupported = useSyncExternalStore(
    emptySubscribe,
    () => getSpeechRecognitionClass() !== null,
    () => true
  );

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldStopRef = useRef<boolean>(false);
  const processingRef = useRef<boolean>(false);
  // Keep a stable ref to options to avoid stale closures
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const processTranscript = useCallback(async (text: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setVoiceState("PROCESSING");
    setInterimTranscript("");

    const { onTranscript: ot, onReply: or_, onError: oe, history: h } = optionsRef.current;
    if (ot) ot(text);

    try {
      const historyPayload = (h ?? []).slice(-6);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyPayload }),
      });

      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        toolCalls?: ToolCallRecord[];
      };

      if (data.reply) {
        if (or_) or_(data.reply, data.toolCalls);
        setVoiceState("SPEAKING");
        await speakText(data.reply);
      } else if (data.error) {
        if (oe) oe(data.error);
        setVoiceState("ERROR");
        setTimeout(() => setVoiceState("IDLE"), 3000);
        processingRef.current = false;
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      const { onError: oe2 } = optionsRef.current;
      if (oe2) oe2(msg);
      setVoiceState("ERROR");
      setTimeout(() => setVoiceState("IDLE"), 3000);
      processingRef.current = false;
      return;
    }

    processingRef.current = false;
    if (!shouldStopRef.current) setVoiceState("IDLE");
  }, []); // stable — reads options via ref

  const startListening = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      const { onError: oe } = optionsRef.current;
      if (oe) oe("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (processingRef.current) return;

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    shouldStopRef.current = false;
    setInterimTranscript("");
    setVoiceState("LISTENING");

    const recognition = new SpeechRecognitionClass();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEventShim) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript;
      setInterimTranscript(text);
      if (result.isFinal && !shouldStopRef.current) {
        recognition.stop();
        if (text.trim()) {
          processTranscript(text.trim());
        } else {
          setVoiceState("IDLE");
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventShim) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        setVoiceState("IDLE");
      } else {
        const { onError: oe } = optionsRef.current;
        if (oe) oe(`Microphone error: ${event.error}`);
        setVoiceState("ERROR");
        setTimeout(() => setVoiceState("IDLE"), 3000);
      }
    };

    recognition.onend = () => {
      if (!processingRef.current && !shouldStopRef.current) {
        setVoiceState("IDLE");
      }
    };

    try {
      recognition.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start microphone";
      const { onError: oe } = optionsRef.current;
      if (oe) oe(msg);
      setVoiceState("IDLE");
    }
  }, [processTranscript]);

  const stopListening = useCallback(() => {
    shouldStopRef.current = true;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    processingRef.current = false;
    setVoiceState("IDLE");
    setInterimTranscript("");
  }, []);

  const toggle = useCallback(() => {
    if (voiceState === "IDLE" || voiceState === "ERROR") {
      startListening();
    } else if (voiceState === "LISTENING") {
      stopListening();
    } else if (voiceState === "SPEAKING") {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      processingRef.current = false;
      setVoiceState("IDLE");
    }
  }, [voiceState, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldStopRef.current = true;
      processingRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    voiceState,
    interimTranscript,
    isSupported,
    startListening,
    stopListening,
    toggle,
  };
}
