"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Package,
  RotateCcw,
  Ban,
  Truck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Search,
  MessageSquare,
  Send,
  Sparkles,
  Bot,
  User,
  Wrench,
  Mic,
  MicOff,
  Volume2,
  StopCircle,
  PhoneOff,
  Phone,
  FileText,
  Copy,
  Check,
  TriangleAlert,
} from "lucide-react";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import type { CallSummary } from "@/lib/types";

// ─── Local interfaces ──────────────────────────────────────────────────────────

interface SafeOrder {
  orderId: string;
  customer: string;
  products: string;
  amount: number;
  currency: string;
  status: string;
  courier?: string;
  trackingId?: string;
  expectedDelivery?: string;
  deliveredAt?: string;
  orderedAt?: string;
}

interface ApiResponseLog {
  endpoint: string;
  method: string;
  status: number;
  data: unknown;
  timestamp: string;
}

interface CancelApiResponse {
  success?: boolean;
  ok?: boolean;
  status?: number;
  policyCode?: string;
  orderId?: string;
  previousStatus?: string;
  newStatus?: string;
  message?: string;
  error?: string;
}

interface ReturnApiResponse {
  success?: boolean;
  ok?: boolean;
  status?: number;
  result?: {
    orderId: string;
    eligible: boolean;
    reason: string;
    policyRule?: string;
    orderStatus?: string;
    isWithinWindow?: boolean;
  };
  error?: string;
}

interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
  timestamp: string;
  /** true only while interim speech is being captured – never persisted */
  isInterim?: boolean;
}

type CallPhase = "idle" | "active" | "ending" | "ended";

interface PostCallState {
  summary: CallSummary | null;
  error: string | null;
  callId: string;
  usedFallback: boolean;
  transcript: ChatMessageItem[];
  isLoading: boolean;
}

// ─── Intent / status labels & colours ────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  ORDER_TRACKING: "Order Tracking",
  CANCELLATION: "Cancellation",
  RETURN: "Return / Refund",
  POLICY_QUERY: "Policy Query",
  OUT_OF_SCOPE: "Out of Scope",
  OTHER: "General Inquiry",
};

const RESOLUTION_STYLES: Record<string, string> = {
  RESOLVED: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  UNRESOLVED: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  ESCALATED: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Order DB state
  const [orders, setOrders] = useState<SafeOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [searchId, setSearchId] = useState("ord-101");
  const [lookupResult, setLookupResult] = useState<SafeOrder | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // ── Chat / transcript state
  const messageCounterRef = useRef(1);
  const WELCOME_MSG: ChatMessageItem = {
    id: "welcome-1",
    role: "assistant",
    content: "Hello! I'm Aria, your Aura Skincare customer concierge. I can assist you with real-time order tracking, cancellations, and return policy inquiries. How can I assist you today?",
    timestamp: "Today",
  };
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([WELCOME_MSG]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isGeminiConfigured, setIsGeminiConfigured] = useState<boolean | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ── Call session state
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const callStartTimeRef = useRef<Date | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [postCall, setPostCall] = useState<PostCallState | null>(null);
  // Prevent duplicate End Call submissions
  const endCallInProgressRef = useRef(false);

  // ── Cancellation state
  const [cancelId, setCancelId] = useState("ORD-103");
  const [cancelReason, setCancelReason] = useState("Customer requested cancellation");
  const [cancelResponse, setCancelResponse] = useState<CancelApiResponse | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // ── Return eligibility state
  const [returnId, setReturnId] = useState("ORD-102");
  const [isOpened, setIsOpened] = useState(false);
  const [isDamaged, setIsDamaged] = useState(false);
  const [hasPhotos, setHasPhotos] = useState(false);
  const [returnResponse, setReturnResponse] = useState<ReturnApiResponse | null>(null);
  const [isCheckingReturn, setIsCheckingReturn] = useState(false);

  // ── Shipping & COD calculator
  const [calcAmount, setCalcAmount] = useState(499);

  // ── API inspection log
  const [apiLog, setApiLog] = useState<ApiResponseLog | null>(null);

  // ── Copy-to-clipboard state for JSON viewer
  const [jsonCopied, setJsonCopied] = useState(false);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const logApi = useCallback(
    (endpoint: string, method: string, status: number, data: unknown) => {
      setApiLog({ endpoint, method, status, data, timestamp: new Date().toLocaleTimeString() });
    },
    []
  );

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (data.success && data.orders) {
        setOrders(data.orders);
        logApi("/api/orders", "GET", res.status, data);
      }
    } catch (err) {
      console.error("Failed to load orders:", err);
    } finally {
      setLoadingOrders(false);
    }
  }, [logApi]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Call duration ticker
  useEffect(() => {
    if (callPhase !== "active") return;
    const t = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDuration(
          Math.floor((Date.now() - callStartTimeRef.current.getTime()) / 1000)
        );
      }
    }, 1000);
    return () => clearInterval(t);
  }, [callPhase]);

  useEffect(() => {
    let active = true;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((d) => { if (active && d.success && d.orders) setOrders(d.orders); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ─── Voice agent ──────────────────────────────────────────────────────────────

  const voice = useVoiceAgent({
    history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    onTranscript: (text) => {
      messageCounterRef.current += 1;
      setChatMessages((prev) => [
        // Remove any dangling interim messages
        ...prev.filter((m) => !m.isInterim),
        {
          id: `user-voice-${messageCounterRef.current}`,
          role: "user",
          content: text,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    },
    onReply: (text, toolCalls) => {
      messageCounterRef.current += 1;
      setChatMessages((prev) => [
        ...prev,
        {
          id: `aria-voice-${messageCounterRef.current}`,
          role: "assistant",
          content: text,
          toolCalls,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      fetchOrders();
    },
    onError: (msg) => {
      setVoiceError(msg);
      setTimeout(() => setVoiceError(null), 5000);
    },
  });

  // ─── Call session handlers ────────────────────────────────────────────────────

  const handleStartCall = useCallback(() => {
    if (callPhase !== "idle") return;
    setCallPhase("active");
    callStartTimeRef.current = new Date();
    setCallDuration(0);
    setPostCall(null);
    endCallInProgressRef.current = false;
    // Start listening automatically
    voice.startListening();
  }, [callPhase, voice]);

  const handleEndCall = useCallback(async () => {
    // Idempotency guard — prevent duplicate submissions
    if (callPhase === "ended" || callPhase === "ending") return;
    if (endCallInProgressRef.current) return;
    endCallInProgressRef.current = true;

    setCallPhase("ending");
    voice.stopListening();

    // Capture the transcript snapshot BEFORE any state mutation
    const transcriptSnapshot = chatMessages.filter((m) => !m.isInterim);
    const callId = `CALL-${Date.now()}`;

    // Filter to only meaningful user/assistant turns (skip welcome-only calls)
    const realTurns = transcriptSnapshot.filter(
      (m) => m.id !== "welcome-1"
    );

    if (realTurns.length === 0) {
      // Empty call — provide clean Zod-validated summary for empty call
      const emptySummary: CallSummary = {
        customer_intent: "OTHER",
        order_id: null,
        resolution_status: "UNRESOLVED",
        call_summary: "Customer connected to Aria but disconnected without speaking.",
      };
      setPostCall({
        summary: emptySummary,
        error: null,
        callId,
        usedFallback: true,
        transcript: transcriptSnapshot,
        isLoading: false,
      });
      setCallPhase("ended");
      endCallInProgressRef.current = false;
      return;
    }

    setPostCall({
      summary: null,
      error: null,
      callId,
      usedFallback: false,
      transcript: transcriptSnapshot,
      isLoading: true,
    });
    setCallPhase("ended");

    // Submit transcript to summary endpoint
    try {
      const payload = realTurns.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));

      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, callId }),
      });

      const data = await res.json() as {
        success: boolean;
        summary?: CallSummary;
        error?: string;
        usedFallback?: boolean;
        validationWarning?: string;
      };

      logApi("/api/summary", "POST", res.status, data);

      if (data.success && data.summary) {
        setPostCall((prev) => prev ? {
          ...prev,
          summary: data.summary!,
          usedFallback: data.usedFallback ?? false,
          isLoading: false,
        } : prev);
      } else {
        setPostCall((prev) => prev ? {
          ...prev,
          error: data.error ?? "Summary generation failed. Please retry.",
          isLoading: false,
        } : prev);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setPostCall((prev) => prev ? {
        ...prev,
        error: `Failed to reach summary endpoint: ${msg}`,
        isLoading: false,
      } : prev);
    } finally {
      endCallInProgressRef.current = false;
    }
  }, [callPhase, voice, chatMessages, logApi]);

  const handleRetrySummary = useCallback(async () => {
    if (!postCall || endCallInProgressRef.current) return;
    endCallInProgressRef.current = true;

    setPostCall((prev) => prev ? { ...prev, summary: null, error: null, isLoading: true } : prev);

    const realTurns = postCall.transcript.filter((m) => m.id !== "welcome-1");
    if (realTurns.length === 0) {
      endCallInProgressRef.current = false;
      return;
    }

    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: realTurns.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
          callId: postCall.callId,
        }),
      });
      const data = await res.json() as {
        success: boolean;
        summary?: CallSummary;
        error?: string;
        usedFallback?: boolean;
      };
      if (data.success && data.summary) {
        setPostCall((prev) => prev ? { ...prev, summary: data.summary!, error: null, usedFallback: data.usedFallback ?? false, isLoading: false } : prev);
      } else {
        setPostCall((prev) => prev ? { ...prev, error: data.error ?? "Retry failed.", isLoading: false } : prev);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setPostCall((prev) => prev ? { ...prev, error: msg, isLoading: false } : prev);
    } finally {
      endCallInProgressRef.current = false;
    }
  }, [postCall]);

  const handleNewCall = useCallback(() => {
    voice.stopListening();
    setCallPhase("idle");
    setCallDuration(0);
    callStartTimeRef.current = null;
    setPostCall(null);
    endCallInProgressRef.current = false;
    messageCounterRef.current += 1;
    setChatMessages([{
      ...WELCOME_MSG,
      id: `welcome-${messageCounterRef.current}`,
      timestamp: "Now",
    }]);
    setChatInput("");
    setChatError(null);
  }, [voice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Text chat handler ────────────────────────────────────────────────────────

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const query = (textToSend !== undefined ? textToSend : chatInput).trim();
    if (!query || isChatLoading) return;

    messageCounterRef.current += 1;
    const userMsg: ChatMessageItem = {
      id: `user-${messageCounterRef.current}`,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsChatLoading(true);
    setChatError(null);

    try {
      const historyPayload = chatMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, history: historyPayload }),
      });
      const data = await res.json();
      logApi("/api/chat", "POST", res.status, data);

      setIsGeminiConfigured(data.isConfigured !== false);

      if (data.reply) {
        messageCounterRef.current += 1;
        setChatMessages((prev) => [
          ...prev,
          {
            id: `aria-${messageCounterRef.current}`,
            role: "assistant",
            content: data.reply,
            toolCalls: data.toolCalls,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }
      if (data.error && (!res.ok || !data.reply)) {
        setChatError(data.error);
      }

      await fetchOrders();
    } catch (err: unknown) {
      setChatError(`Failed to reach /api/chat: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, isChatLoading, chatMessages, logApi, fetchOrders]);

  // ─── Other handlers ───────────────────────────────────────────────────────────

  const handleResetDatabase = async () => {
    const res = await fetch("/api/orders?action=reset");
    const data = await res.json();
    logApi("/api/orders?action=reset", "GET", res.status, data);
    await fetchOrders();
    setCancelResponse(null);
    setReturnResponse(null);
    setLookupResult(null);
    setLookupError(null);
  };

  const handleLookup = async (idToSearch?: string) => {
    const id = idToSearch ?? searchId;
    if (!id.trim()) return;
    setIsSearching(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch(`/api/orders?orderId=${encodeURIComponent(id)}`);
      const data = await res.json();
      logApi(`/api/orders?orderId=${id}`, "GET", res.status, data);
      if (res.ok && data.success) setLookupResult(data.order);
      else setLookupError(data.error ?? "Order not found.");
    } catch {
      setLookupError("Network error.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleCancelOrder = async (targetId?: string) => {
    const id = targetId ?? cancelId;
    setIsCancelling(true);
    setCancelResponse(null);
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, reason: cancelReason }),
      });
      const data = await res.json();
      logApi("/api/orders/cancel", "POST", res.status, data);
      setCancelResponse({ status: res.status, ok: res.ok, ...data });
      await fetchOrders();
    } catch {
      setCancelResponse({ ok: false, status: 500, message: "Failed to reach cancellation endpoint." });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCheckReturn = async (targetId?: string) => {
    const id = targetId ?? returnId;
    setIsCheckingReturn(true);
    setReturnResponse(null);
    try {
      const res = await fetch("/api/orders/return-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, isOpened, isUsed: false, isOriginalPackaging: true, isDamaged, hoursSinceDelivery: isDamaged ? 24 : undefined, hasPhotos }),
      });
      const data = await res.json();
      logApi("/api/orders/return-eligibility", "POST", res.status, data);
      setReturnResponse({ status: res.status, ok: res.ok, ...data });
    } catch {
      setReturnResponse({ ok: false, status: 500, error: "Failed to reach return eligibility endpoint." });
    } finally {
      setIsCheckingReturn(false);
    }
  };

  const handleCopyJson = useCallback(() => {
    if (!postCall?.summary) return;
    navigator.clipboard.writeText(JSON.stringify(postCall.summary, null, 2)).then(() => {
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 2000);
    });
  }, [postCall]);

  // ─── Status badge helper ──────────────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Processing": return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800";
      case "Out for Delivery": return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800";
      case "Delivered": return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800";
      case "Cancelled": return "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800";
      default: return "bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300";
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100 antialiased font-sans">

      {/* Top Navigation */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 flex items-center justify-center font-serif font-bold text-lg">
              A
            </div>
            <div>
              <span className="font-serif tracking-wider text-lg font-semibold block leading-tight">AURA SKINCARE</span>
              <span className="text-xs text-stone-500 tracking-wider uppercase font-medium">Order & Policy Engine • DataStraw Assessment</span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
              Live Server APIs
            </span>
            <button
              onClick={handleResetDatabase}
              title="Reset mock database to initial seed state"
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-stone-600 dark:text-stone-400" />
              Reset DB
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── Section 0: Aria AI Voice Agent ─────────────────────────────────── */}
        <section className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm overflow-hidden flex flex-col">

          {/* Chat Header */}
          <div className="p-4 sm:p-5 border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 flex items-center justify-center font-bold">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-base font-serif font-semibold tracking-tight">Aria — AI Customer Support Concierge</h2>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                    <Sparkles className="w-3 h-3 mr-1" />
                    Gemini Function Calling
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  Real server-side Google Gemini orchestration executing get_order_details, cancel_order, and check_return_eligibility.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Call timer */}
              {callPhase === "active" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-full border border-rose-200 dark:border-rose-900">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                  {formatDuration(callDuration)}
                </span>
              )}

              {/* Start / End Call buttons */}
              {callPhase === "idle" && (
                <button
                  id="aria-start-call-btn"
                  onClick={handleStartCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Start Call
                </button>
              )}
              {callPhase === "active" && (
                <button
                  id="aria-end-call-btn"
                  onClick={handleEndCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition shadow-sm"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  End Call
                </button>
              )}
              {(callPhase === "ending" || callPhase === "ended") && (
                <button
                  id="aria-new-call-btn"
                  onClick={handleNewCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-stone-800 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 transition shadow-sm"
                >
                  <Phone className="w-3.5 h-3.5" />
                  New Call
                </button>
              )}

              <button
                id="aria-clear-thread-btn"
                onClick={() => {
                  messageCounterRef.current += 1;
                  setChatMessages([{ ...WELCOME_MSG, id: `welcome-${messageCounterRef.current}`, timestamp: "Now" }]);
                }}
                className="px-2.5 py-1 text-xs rounded border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition text-stone-600 dark:text-stone-300"
              >
                Clear Thread
              </button>
            </div>
          </div>

          {/* Gemini unconfigured banner */}
          {isGeminiConfigured === false && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong>GEMINI_API_KEY Not Configured:</strong> Set{" "}
                <code className="bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded font-mono">GEMINI_API_KEY=your_key</code>{" "}
                in <code className="bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded font-mono">.env.local</code>. Mock database and policy testers remain 100% functional.
              </div>
            </div>
          )}

          {/* Quick Scenario Chips */}
          <div className="px-4 py-3 bg-stone-100/50 dark:bg-stone-800/20 border-b border-stone-200 dark:border-stone-800 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-stone-500 font-medium mr-1 flex items-center">
              <MessageSquare className="w-3.5 h-3.5 mr-1" />
              Assessment Scenarios:
            </span>
            {[
              "Where is ORD-101?",
              "Can I return ORD-102? It was delivered 14 days ago.",
              "Cancel ORD-103.",
              "Cancel ORD-101.",
              "Tell me about my order ORD-999.",
              "Book me a flight to Goa.",
            ].map((query) => (
              <button
                key={query}
                onClick={() => handleSendMessage(query)}
                disabled={isChatLoading}
                className="px-2.5 py-1 text-xs rounded-full bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:border-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700 disabled:opacity-50 transition shadow-2xs"
              >
                {query}
              </button>
            ))}
          </div>

          {/* ── Conversation Transcript ──────────────────────────────────────── */}
          <div className="p-4 sm:p-6 space-y-4 max-h-[460px] overflow-y-auto bg-stone-50/30 dark:bg-stone-950/20">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"} ${msg.isInterim ? "opacity-60" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 flex items-center justify-center flex-shrink-0 text-xs font-bold font-serif mt-0.5">
                    A
                  </div>
                )}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 shadow-2xs space-y-2 ${
                    msg.role === "user"
                      ? "bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900 rounded-tr-none"
                      : "bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-stone-200 dark:border-stone-700/80 rounded-tl-none"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] opacity-70 mb-1">
                    <span className="font-semibold uppercase tracking-wider">
                      {msg.role === "user" ? "Customer" : "Aria • Aura Concierge"}
                    </span>
                    <span>{msg.timestamp}{msg.isInterim ? " · speaking…" : ""}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                  {/* Tool call records */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-2.5 pt-2.5 border-t border-stone-200 dark:border-stone-700/80 space-y-2">
                      <span className="text-[11px] font-semibold tracking-wider text-purple-700 dark:text-purple-300 uppercase flex items-center">
                        <Wrench className="w-3 h-3 mr-1" />
                        Server Function Calls Executed ({msg.toolCalls.length})
                      </span>
                      {msg.toolCalls.map((tc, idx) => (
                        <div key={idx} className="p-2.5 rounded bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 text-[11px] font-mono space-y-1">
                          <div className="font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between">
                            <span>{tc.name}</span>
                            <span className="text-[10px] text-purple-600 font-sans font-medium">Validated via Zod</span>
                          </div>
                          <div className="text-stone-600 dark:text-stone-400"><strong>Args:</strong> {JSON.stringify(tc.args)}</div>
                          <div className="text-stone-800 dark:text-stone-200 overflow-x-auto max-h-24"><strong>Result:</strong> {JSON.stringify(tc.result)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-stone-300 dark:bg-stone-700 text-stone-800 dark:text-stone-200 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {isChatLoading && (
              <div className="flex gap-3 justify-start animate-pulse">
                <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 flex items-center justify-center text-xs font-bold font-serif">A</div>
                <div className="p-3.5 bg-white dark:bg-stone-800 rounded-2xl rounded-tl-none border border-stone-200 dark:border-stone-700 text-xs text-stone-500 flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-stone-500" />
                  <span>Aria is thinking & evaluating policies…</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Error banners */}
          {chatError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border-t border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between">
              <span>{chatError}</span>
              <button onClick={() => setChatError(null)} className="underline font-medium">Dismiss</button>
            </div>
          )}
          {voiceError && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><MicOff className="w-3.5 h-3.5" />{voiceError}</span>
              <button onClick={() => setVoiceError(null)} className="underline font-medium">Dismiss</button>
            </div>
          )}

          {/* Interim transcript display */}
          {voice.voiceState === "LISTENING" && voice.interimTranscript && (
            <div className="px-4 py-2 bg-blue-50/80 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 italic flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
              <span className="truncate">&ldquo;{voice.interimTranscript}&rdquo;</span>
            </div>
          )}

          {/* ── Chat Input Footer ──────────────────────────────────────────── */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
            className="p-3 sm:p-4 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex gap-2 items-center"
          >
            {/* Voice mic button */}
            <div className="relative flex-shrink-0">
              {voice.voiceState === "LISTENING" && (
                <>
                  <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" />
                  <span className="absolute inset-[-4px] rounded-full border-2 border-rose-400/50 animate-pulse" />
                </>
              )}
              {voice.voiceState === "SPEAKING" && (
                <span className="absolute inset-[-4px] rounded-full border-2 border-emerald-400/60 animate-pulse" />
              )}
              <button
                type="button"
                id="aria-voice-btn"
                onClick={voice.toggle}
                disabled={isChatLoading || !voice.isSupported || callPhase === "ending"}
                title={
                  !voice.isSupported ? "Speech recognition unavailable — use Chrome or Edge"
                    : callPhase === "idle" ? "Start a call first, then use voice"
                    : voice.voiceState === "IDLE" ? "Start voice conversation with Aria"
                    : voice.voiceState === "LISTENING" ? "Tap to stop listening"
                    : voice.voiceState === "PROCESSING" ? "Aria is thinking…"
                    : voice.voiceState === "SPEAKING" ? "Tap to stop Aria speaking"
                    : "Voice error — click to reset"
                }
                className={[
                  "relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm",
                  !voice.isSupported || callPhase === "idle"
                    ? "bg-stone-200 dark:bg-stone-700 text-stone-400 cursor-not-allowed"
                    : voice.voiceState === "IDLE"
                    ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 border border-stone-300 dark:border-stone-700 hover:border-rose-300"
                    : voice.voiceState === "LISTENING"
                    ? "bg-rose-500 text-white border border-rose-600 shadow-rose-200/50 dark:shadow-rose-900/40 shadow-lg"
                    : voice.voiceState === "PROCESSING"
                    ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800 cursor-wait"
                    : voice.voiceState === "SPEAKING"
                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800"
                    : "bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900",
                ].join(" ")}
              >
                {voice.voiceState === "IDLE" && <Mic className="w-4 h-4" />}
                {voice.voiceState === "LISTENING" && <MicOff className="w-4 h-4" />}
                {voice.voiceState === "PROCESSING" && <RefreshCw className="w-4 h-4 animate-spin" />}
                {voice.voiceState === "SPEAKING" && <StopCircle className="w-4 h-4" />}
                {voice.voiceState === "ERROR" && <MicOff className="w-4 h-4" />}
              </button>
            </div>

            {/* Voice status label or text input */}
            {voice.voiceState !== "IDLE" && voice.voiceState !== "ERROR" ? (
              <div className="flex-1 px-4 py-2.5 text-sm rounded-lg border bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 flex items-center gap-2">
                {voice.voiceState === "LISTENING" && (
                  <><span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span className="text-stone-500 dark:text-stone-400">Listening… speak to Aria</span></>
                )}
                {voice.voiceState === "PROCESSING" && (
                  <><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-stone-500 dark:text-stone-400">Aria is thinking…</span></>
                )}
                {voice.voiceState === "SPEAKING" && (
                  <><Volume2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <span className="text-stone-500 dark:text-stone-400">Aria is speaking — tap mic to interrupt</span></>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Aria about your order, return eligibility, cancellations, or shipping…"
                disabled={isChatLoading}
                className="flex-1 px-4 py-2.5 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 disabled:opacity-50"
              />
            )}

            <button
              type="submit"
              disabled={isChatLoading || !chatInput.trim() || voice.voiceState !== "IDLE"}
              className="px-5 py-2.5 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950 rounded-lg text-sm font-medium hover:bg-stone-800 dark:hover:bg-white disabled:opacity-40 transition flex items-center flex-shrink-0"
            >
              <Send className="w-4 h-4 mr-1.5" />
              Send
            </button>
          </form>

          {/* Voice capability badge */}
          <div className="px-4 py-2 border-t border-stone-100 dark:border-stone-800/60 bg-stone-50/50 dark:bg-stone-900/50 flex items-center justify-between text-[11px] text-stone-400 dark:text-stone-500">
            <span className="flex items-center gap-1.5">
              <Mic className="w-3 h-3" />
              {voice.isSupported
                ? callPhase === "active"
                  ? "Voice mode active — tap the mic and speak naturally to Aria"
                  : "Start a call above to enable voice interaction"
                : "Voice mode unavailable — use Chrome or Edge"}
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${
                voice.voiceState === "IDLE" ? "bg-stone-300" :
                voice.voiceState === "LISTENING" ? "bg-rose-500 animate-ping" :
                voice.voiceState === "PROCESSING" ? "bg-amber-500 animate-pulse" :
                voice.voiceState === "SPEAKING" ? "bg-emerald-500 animate-pulse" :
                "bg-rose-500"
              }`} />
              {voice.voiceState}
            </span>
          </div>
        </section>

        {/* ── Post-Call Summary Panel ─────────────────────────────────────────── */}
        {(callPhase === "ending" || callPhase === "ended") && postCall && (
          <section
            id="post-call-summary"
            className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm overflow-hidden"
          >
            {/* Summary header */}
            <div className="p-4 sm:p-5 border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 flex items-center justify-center">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-base font-serif font-semibold">Post-Call Summary</h2>
                  <p className="text-xs text-stone-500">
                    {postCall.callId} · {postCall.usedFallback ? "Deterministic rule engine + Zod validation" : "Generated by Gemini + Zod validation"}
                  </p>
                </div>
              </div>
              {postCall.usedFallback && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <TriangleAlert className="w-3 h-3" />
                  Deterministic fallback (standby / quota)
                </span>
              )}
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Loading state */}
              {postCall.isLoading && (
                <div className="flex items-center gap-3 text-sm text-stone-500">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                  <span>Generating call summary with Gemini…</span>
                </div>
              )}

              {/* Error state */}
              {postCall.error && !postCall.summary && (
                <div className="rounded-lg p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-rose-900 dark:text-rose-200">Summary Generation Failed</p>
                    <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{postCall.error}</p>
                    <button
                      onClick={handleRetrySummary}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Summary
                    </button>
                  </div>
                </div>
              )}

              {/* Summary cards */}
              {postCall.summary && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Intent */}
                    <div className="rounded-lg p-4 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/60">
                      <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-1">Customer Intent</span>
                      <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                        {INTENT_LABELS[postCall.summary.customer_intent] ?? postCall.summary.customer_intent}
                      </span>
                    </div>
                    {/* Order ID */}
                    <div className="rounded-lg p-4 bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
                      <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Order ID</span>
                      <span className="text-sm font-mono font-medium text-stone-900 dark:text-stone-100">
                        {postCall.summary.order_id ?? <em className="not-italic text-stone-400">None identified</em>}
                      </span>
                    </div>
                    {/* Resolution */}
                    <div className="rounded-lg p-4 bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
                      <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Resolution Status</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${RESOLUTION_STYLES[postCall.summary.resolution_status] ?? ""}`}>
                        {postCall.summary.resolution_status === "RESOLVED" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                        {postCall.summary.resolution_status === "UNRESOLVED" && <AlertCircle className="w-3 h-3 mr-1" />}
                        {postCall.summary.resolution_status === "ESCALATED" && <TriangleAlert className="w-3 h-3 mr-1" />}
                        {postCall.summary.resolution_status}
                      </span>
                    </div>
                  </div>

                  {/* Call summary */}
                  <div className="rounded-lg p-4 bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
                    <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-2">Call Summary</span>
                    <p className="text-sm text-stone-800 dark:text-stone-200 leading-relaxed">{postCall.summary.call_summary}</p>
                  </div>

                  {/* JSON viewer */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-3 h-3" />
                        Structured JSON Output (Zod-validated)
                      </span>
                      <button
                        onClick={handleCopyJson}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition"
                      >
                        {jsonCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {jsonCopied ? "Copied!" : "Copy JSON"}
                      </button>
                    </div>
                    <pre className="rounded-lg bg-stone-900 dark:bg-stone-950 text-stone-100 text-xs p-4 overflow-x-auto font-mono leading-relaxed border border-stone-700">
                      {JSON.stringify(postCall.summary, null, 2)}
                    </pre>
                  </div>
                </>
              )}

              {/* Full transcript */}
              <div>
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-3">
                  Complete Conversation Transcript ({postCall.transcript.filter(m => m.id !== "welcome-1").length} turns)
                </span>
                {postCall.transcript.filter(m => m.id !== "welcome-1").length === 0 ? (
                  <p className="text-sm text-stone-400 italic">No customer turns recorded — call was empty.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 p-3 bg-stone-50/50 dark:bg-stone-900/50">
                    {postCall.transcript.map((msg, i) => (
                      <div key={msg.id} className={`flex gap-2 text-xs ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] px-3 py-2 rounded-xl ${
                          msg.role === "user"
                            ? "bg-stone-800 text-stone-100 rounded-tr-none"
                            : "bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200 rounded-tl-none"
                        }`}>
                          <div className="flex items-center justify-between gap-4 mb-0.5 opacity-60 text-[10px]">
                            <span className="font-semibold uppercase tracking-wider">{msg.role === "user" ? "Customer" : "Aria"}</span>
                            <span>{msg.timestamp}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="mt-1.5 opacity-70 text-[10px] font-mono">
                              🔧 {msg.toolCalls.map(tc => tc.name).join(", ")}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-stone-400 self-end mb-0.5">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Section 1: Live Mock Database Orders ─────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-semibold tracking-tight flex items-center">
              <Package className="w-5 h-5 mr-2 text-stone-600 dark:text-stone-400" />
              Assessment Sample Orders (In-Memory Database)
            </h2>
            <span className="text-xs text-stone-500">{loadingOrders ? "Refreshing…" : "Real-time state from server"}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {orders.map((o) => (
              <div key={o.orderId} className="bg-white dark:bg-stone-900 rounded-xl p-5 border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow transition flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold text-stone-900 dark:text-stone-100">{o.orderId}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusBadge(o.status)}`}>{o.status}</span>
                  </div>
                  <div className="text-base font-medium text-stone-800 dark:text-stone-200">{o.customer}</div>
                  <div className="text-sm text-stone-600 dark:text-stone-400 mt-1 line-clamp-1">{o.products}</div>
                  <div className="text-lg font-semibold text-stone-900 dark:text-stone-100 mt-2 font-mono">₹{o.amount}</div>

                  <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800/80 text-xs text-stone-500 dark:text-stone-400 space-y-1">
                    {o.courier && (
                      <div className="flex items-center justify-between">
                        <span>Courier:</span>
                        <span className="font-medium text-stone-700 dark:text-stone-300">{o.courier} ({o.trackingId})</span>
                      </div>
                    )}
                    {o.expectedDelivery && (
                      <div className="flex items-center justify-between">
                        <span>Expected:</span>
                        <span className="font-medium text-stone-700 dark:text-stone-300">{o.expectedDelivery}</span>
                      </div>
                    )}
                    {o.deliveredAt && (
                      <div className="flex items-center justify-between">
                        <span>Delivered:</span>
                        <span className="font-medium text-stone-700 dark:text-stone-300">{o.deliveredAt}</span>
                      </div>
                    )}
                    {o.orderedAt && (
                      <div className="flex items-center justify-between">
                        <span>Ordered:</span>
                        <span className="font-medium text-stone-700 dark:text-stone-300">{o.orderedAt}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 flex gap-2">
                  <button
                    onClick={() => { setSearchId(o.orderId); handleLookup(o.orderId); }}
                    className="flex-1 py-1.5 px-2 text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded text-stone-800 dark:text-stone-200 transition"
                  >
                    Lookup
                  </button>
                  <button
                    onClick={() => { setCancelId(o.orderId); handleCancelOrder(o.orderId); }}
                    className="flex-1 py-1.5 px-2 text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 rounded border border-rose-200 dark:border-rose-900 transition"
                  >
                    Test Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 2: Order Lookup ───────────────────────────────────────── */}
        <section className="bg-white dark:bg-stone-900 rounded-xl p-6 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-serif font-semibold flex items-center">
                <Search className="w-5 h-5 mr-2 text-stone-600 dark:text-stone-400" />
                Live Order Details Lookup (get_order_details)
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">Tests input normalization (e.g. &apos;ord-101&apos;, &apos;ORD101&apos;, &apos;ORD-101&apos;, &apos;102&apos;), safe PII redaction, and NOT_FOUND error handling.</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-stone-400">Try:</span>
              {["ord-101", "ORD101", "ORD-102", "103", "ORD-999"].map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setSearchId(tag); handleLookup(tag); }}
                  className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 font-mono transition"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 max-w-xl">
            <input
              type="text"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              placeholder="Enter order ID (e.g. ord-101, ORD101, ORD-999)"
              className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 font-mono"
            />
            <button
              onClick={() => handleLookup()}
              disabled={isSearching}
              className="px-4 py-2 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950 text-sm font-medium rounded-lg hover:bg-stone-800 dark:hover:bg-white disabled:opacity-50 transition flex items-center"
            >
              {isSearching ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Search className="w-4 h-4 mr-1.5" />}
              Fetch Order
            </button>
          </div>

          {lookupResult && (
            <div className="rounded-lg p-4 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 mt-3">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-emerald-200/60 dark:border-emerald-800/40">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" />
                  Order Found & Normalized
                </span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-white dark:bg-stone-900 font-bold border border-emerald-200 dark:border-emerald-800">
                  Canonical ID: {lookupResult.orderId}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mt-3">
                <div><span className="text-xs text-stone-500 block">Customer</span><span className="font-medium">{lookupResult.customer}</span></div>
                <div><span className="text-xs text-stone-500 block">Products</span><span className="font-medium">{lookupResult.products}</span></div>
                <div><span className="text-xs text-stone-500 block">Amount</span><span className="font-mono font-bold">₹{lookupResult.amount}</span></div>
                <div><span className="text-xs text-stone-500 block">Status</span><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusBadge(lookupResult.status)}`}>{lookupResult.status}</span></div>
              </div>
              {lookupResult.courier && (
                <div className="mt-3 pt-2 text-xs text-stone-600 dark:text-stone-400 border-t border-emerald-200/40">
                  Tracking: <strong>{lookupResult.courier}</strong> ({lookupResult.trackingId}) • Expected: {lookupResult.expectedDelivery ?? lookupResult.deliveredAt}
                </div>
              )}
            </div>
          )}

          {lookupError && (
            <div className="rounded-lg p-4 bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/60 mt-3 flex items-start space-x-2">
              <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="text-sm font-semibold text-rose-900 dark:text-rose-200 block">Order Not Found (HTTP 404)</strong>
                <p className="text-xs text-rose-800/90 dark:text-rose-300/80 mt-0.5">{lookupError}</p>
              </div>
            </div>
          )}
        </section>

        {/* ── Section 3: Cancellation Tester ───────────────────────────────── */}
        <section className="bg-white dark:bg-stone-900 rounded-xl p-6 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-serif font-semibold flex items-center">
              <Ban className="w-5 h-5 mr-2 text-stone-600 dark:text-stone-400" />
              Order Cancellation API (cancel_order)
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">Tests the cancel_order tool: ORD-103 (Processing → allowed), ORD-101 (Out for Delivery → rejected), ORD-102 (Delivered → rejected).</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400 block mb-1">Order ID</label>
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {["ORD-101", "ORD-102", "ORD-103"].map((id) => (
                  <button key={id} onClick={() => setCancelId(id)} className={`px-2 py-1 text-xs rounded font-mono transition ${cancelId === id ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950" : "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300"}`}>{id}</button>
                ))}
              </div>
              <input type="text" value={cancelId} onChange={(e) => setCancelId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400 block mb-1">Reason</label>
              <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500" />
            </div>
          </div>

          <button
            onClick={() => handleCancelOrder()}
            disabled={isCancelling}
            className="px-4 py-2 bg-rose-600 text-white text-sm font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50 transition flex items-center"
          >
            {isCancelling ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Ban className="w-4 h-4 mr-1.5" />}
            Submit Cancellation Request
          </button>

          {cancelResponse && (
            <div className={`rounded-lg p-4 border mt-3 ${cancelResponse.ok ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800"}`}>
              <div className="flex items-center gap-2 mb-2">
                {cancelResponse.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />}
                <span className="text-sm font-semibold">{cancelResponse.ok ? "Cancellation Successful" : "Cancellation Rejected"}</span>
                <span className="text-xs font-mono opacity-60">HTTP {cancelResponse.status}</span>
              </div>
              <p className="text-xs text-stone-700 dark:text-stone-300">{cancelResponse.message ?? cancelResponse.error}</p>
              {cancelResponse.policyCode && (
                <div className="mt-2 text-[11px] font-mono text-stone-500">
                  Policy Code: <strong>{cancelResponse.policyCode}</strong>
                  {cancelResponse.previousStatus && <> · {cancelResponse.previousStatus} → {cancelResponse.newStatus}</>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Section 4: Return Eligibility Tester ─────────────────────────── */}
        <section className="bg-white dark:bg-stone-900 rounded-xl p-6 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-serif font-semibold flex items-center">
              <RotateCcw className="w-5 h-5 mr-2 text-stone-600 dark:text-stone-400" />
              Return Eligibility Checker (check_return_eligibility)
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">ORD-102 (delivered 14 days ago) — must be rejected. Tests all policy branches including damage claims.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400 block mb-1">Order ID</label>
              <div className="flex gap-1.5 mb-2">
                {["ORD-101", "ORD-102", "ORD-103"].map((id) => (
                  <button key={id} onClick={() => setReturnId(id)} className={`px-2 py-1 text-xs rounded font-mono transition ${returnId === id ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950" : "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300"}`}>{id}</button>
                ))}
              </div>
              <input type="text" value={returnId} onChange={(e) => setReturnId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 font-mono" />
            </div>
            <div className="space-y-3">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400 block">Conditions</label>
              {[
                { label: "Product opened/unsealed", state: isOpened, setter: setIsOpened },
                { label: "Product damaged on arrival", state: isDamaged, setter: setIsDamaged },
                { label: "Has photographic evidence", state: hasPhotos, setter: setHasPhotos },
              ].map(({ label, state, setter }) => (
                <label key={label} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={state} onChange={(e) => setter(e.target.checked)} className="rounded" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={() => handleCheckReturn()}
            disabled={isCheckingReturn}
            className="px-4 py-2 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950 text-sm font-medium rounded-lg hover:bg-stone-800 disabled:opacity-50 transition flex items-center"
          >
            {isCheckingReturn ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <RotateCcw className="w-4 h-4 mr-1.5" />}
            Check Return Eligibility
          </button>

          {returnResponse?.result && (
            <div className={`rounded-lg p-4 border mt-3 ${returnResponse.result.eligible ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800"}`}>
              <div className="flex items-center gap-2 mb-2">
                {returnResponse.result.eligible ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />}
                <span className="text-sm font-semibold">{returnResponse.result.eligible ? "Return Eligible" : "Return Rejected"}</span>
              </div>
              <p className="text-xs text-stone-700 dark:text-stone-300">{returnResponse.result.reason}</p>
              <div className="mt-2 text-[11px] font-mono text-stone-500">
                Policy Rule: {returnResponse.result.policyRule} · Status: {returnResponse.result.orderStatus}
              </div>
            </div>
          )}
        </section>

        {/* ── Section 5: Shipping & COD ─────────────────────────────────────── */}
        <section className="bg-white dark:bg-stone-900 rounded-xl p-6 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
          <h2 className="text-lg font-serif font-semibold flex items-center">
            <Truck className="w-5 h-5 mr-2 text-stone-600 dark:text-stone-400" />
            Shipping & COD Policy Calculator
          </h2>
          <p className="text-xs text-stone-500">Free shipping ≥ ₹499 • COD available ≤ ₹2,500 • Standard delivery 3-5 days</p>

          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400 block mb-1">Order Amount (₹)</label>
              <input
                type="number"
                min={0}
                value={calcAmount}
                onChange={(e) => setCalcAmount(Number(e.target.value))}
                className="w-32 px-3 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 font-mono"
              />
            </div>
            <div className="flex gap-3 flex-wrap pt-4 sm:pt-0">
              <div className={`px-3 py-2 rounded-lg text-xs font-medium border ${calcAmount >= 499 ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"}`}>
                Shipping: {calcAmount >= 499 ? "FREE ✓" : `₹50 fee`}
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs font-medium border ${calcAmount <= 2500 ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"}`}>
                COD: {calcAmount <= 2500 ? "Eligible ✓" : "Prepaid required"}
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 6: API Inspection Log ────────────────────────────────── */}
        {apiLog && (
          <section className="bg-white dark:bg-stone-900 rounded-xl p-5 border border-stone-200 dark:border-stone-800 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 font-mono">API Response Inspector</h2>
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${apiLog.status < 300 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{apiLog.status}</span>
                <span className="font-mono text-stone-500">{apiLog.method} {apiLog.endpoint}</span>
                <span className="text-stone-400">{apiLog.timestamp}</span>
              </div>
            </div>
            <pre className="text-xs bg-stone-50 dark:bg-stone-950 rounded-lg p-3 overflow-auto max-h-48 font-mono text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-800">
              {JSON.stringify(apiLog.data, null, 2)}
            </pre>
          </section>
        )}

      </main>
    </div>
  );
}
