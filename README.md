# Aura Skincare AI Voice Agent — Aria
### DataStraw Technical Hiring Assessment

> **Aria** is an enterprise-grade AI customer support voice agent built for **Aura Skincare**, combining real-time speech processing, Google Gemini function calling, policy-enforced order operations, and validated post-call analytics.

---

## 1. System Architecture & Flow

```
[ Customer Microphone ]
          │
          ▼  (Web Speech API / SpeechRecognition)
[ Speech-to-Text (STT) ] ── (Real-time Interim Transcript Preview)
          │
          ▼  (Final Utterance + Chat History)
[ Next.js API Route: /api/chat ]
          │
          ├──> [ Google Gemini 3.5 Flash (Server-Side) ]
          │          │
          │          ▼ (Function Calling Tools)
          │     ┌──────────────────────────────────────────────┐
          │     │ • get_order_details(order_id)                │
          │     │ • cancel_order(order_id)                     │
          │     │ • check_return_eligibility(order_id)         │
          │     └──────────────────────────────────────────────┘
          │          │
          │          ▼
          │     [ Mock Order Database & Policy Engine ]
          │     (Strict validation, canonical ID normalization)
          │
          ▼  (Agent Response Text)
[ Text-to-Speech (TTS) ] ──> [ Browser Audio Playback ]
          │  (OpenAI TTS / Web Speech API Synthesis fallback)
          ▼
[ End-Call Trigger ]
          │
          ▼  (Snapshot Transcript with Prompt-Injection Guard)
[ Next.js API Route: /api/summary ]
          │
          ├──> [ Gemini QA Extractor / Deterministic Fallback ]
          │          │
          │          ▼
          │     [ Zod Schema Validation (CallSummarySchema) ]
          │
          ▼
[ Post-Call UI: Summary Cards, JSON Viewer, Chronological Transcript ]
```

---

## 2. Tech Stack & Provider Choices

* **Framework**: Next.js 16 (App Router with Turbopack).
* **UI & Styling**: React 19, Tailwind CSS 4, Lucide React icons.
* **Language & Validation**: TypeScript 5, Zod (`zod@^4.6.7`) for runtime contract validation.
* **AI Orchestration**: Google Gemini API via official `@google/generative-ai` SDK (server-side function calling).
* **Speech-to-Text (STT)**: Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) supporting English, Hindi, and Hinglish with zero external latency or subscription requirements.
* **Text-to-Speech (TTS)**: Dual-layer engine — modular `/api/voice/speak` (OpenAI `tts-1`) with automated, seamless fallback to browser `window.speechSynthesis`.

---

## 3. Core Capabilities & Business Policies

### A. Order Management & Policies (`src/lib/orders.ts`, `src/lib/policies.ts`)
* **Case-Insensitive ID Normalization**: Tolerates diverse inputs (`ord-101`, `ORD101`, `ord 101`, `101`, `ord_101` $\rightarrow$ canonical `ORD-101`).
* **Sample Orders**:
  * `ORD-101`: Priya Sharma | Vitamin C Serum 30ml | ₹699 | Status: *Out for Delivery* (BlueDart BD-982103, 6 PM today)
  * `ORD-102`: Rahul Verma | Hydrating Sunscreen SPF50 | ₹499 | Status: *Delivered* (Delhivery, delivered 14 days ago)
  * `ORD-103`: Ananya Patel | Green Tea Face Wash + Toner | ₹850 | Status: *Processing* (placed 3 hours ago)
* **Cancellation Policy Rules**:
  * `Processing` orders: Permitted $\rightarrow$ updates status to `Cancelled` and initiates refund.
  * `Out for Delivery` orders (e.g. `ORD-101`): Strictly **prohibited** $\rightarrow$ informs customer of courier transit.
  * `Delivered` orders (e.g. `ORD-102`): Strictly **prohibited** $\rightarrow$ redirects to return policy.
* **Return Policy Rules**:
  * Allowed within **7 days** of delivery for unopened products.
  * Allowed within **48 hours** for damaged items with photographic verification.
  * Orders older than 7 days (e.g. `ORD-102` delivered 14 days ago) are strictly **rejected**.
* **Shipping & COD Rules**:
  * Free shipping threshold: Orders $\ge$ ₹499 (otherwise ₹50 shipping fee).
  * Cash on Delivery (COD): Permitted up to ₹2,500 with UPI or Cash at doorstep.

### B. Post-Call Summary Engine (`src/app/api/summary/route.ts`, `src/lib/summary.ts`)
* **Required Assessment Schema**:
  ```typescript
  {
    customer_intent: "ORDER_TRACKING" | "CANCELLATION" | "RETURN" | "POLICY_QUERY" | "OUT_OF_SCOPE" | "OTHER",
    order_id: string | null, // Canonical ORD-NNN or null if not discussed
    resolution_status: "RESOLVED" | "UNRESOLVED" | "ESCALATED",
    call_summary: string // Concise 1-2 sentence factual summary
  }
  ```
* **Prompt Injection Defense**: Transcripts are enclosed in fenced data blocks within the Gemini prompt, preventing transcript text from breaking instruction context.
* **Zero-Hallucination Order ID**: `order_id` is strictly `null` when no order number was identified in the call.
* **Deterministic Fallback**: If `GEMINI_API_KEY` is absent or the API fails, a keyword-based rule engine guarantees 100% availability with full schema conformance.
* **Schema Validation**: Every response is validated using Zod prior to returning to the client.

### C. Voice State & UI (`src/app/page.tsx`, `src/lib/useVoiceAgent.ts`)
* **State Flow**: `IDLE` $\rightarrow$ `LISTENING` $\rightarrow$ `PROCESSING` $\rightarrow$ `SPEAKING` $\rightarrow$ `IDLE`.
* **Idempotency Guard**: Rapid or repeated clicks on "End Call" are debounced via ref locking, preventing duplicate API invocations.
* **Transcript Preservation**: Takes a snapshot of final messages before transitioning state; transcripts are never lost.
* **Summary Cards & JSON Inspector**: Displays structured cards for Intent, Order ID, and Resolution Status, alongside a copyable JSON payload and a "Retry Summary" action on failure.

---

## 4. API Documentation

### `GET /api/orders`
* **Query Params**:
  * `orderId` (optional): Looks up specific order (e.g. `?orderId=ord-101`).
  * `action=reset` (optional): Resets in-memory database to original state.
* **Response**: Returns list of all orders or single sanitized order details.

### `POST /api/orders/cancel`
* **Request**: `{ "orderId": "ORD-103", "reason": "Customer request" }`
* **Response (Success - 200)**: `{ "success": true, "policyCode": "CANCELLED_SUCCESS", "newStatus": "Cancelled", "message": "..." }`
* **Response (Policy Rejected - 422)**: `{ "success": false, "policyCode": "CANNOT_CANCEL_OUT_FOR_DELIVERY", "message": "..." }`

### `POST /api/orders/return-eligibility`
* **Request**: `{ "orderId": "ORD-102", "isOpened": false }`
* **Response (200)**: `{ "success": true, "result": { "eligible": false, "reason": "Return window expired. ...", "orderStatus": "Delivered" } }`

### `POST /api/chat`
* **Request**: `{ "message": "Where is my order ORD-101?", "history": [...] }`
* **Response (Live Gemini - 200)**: `{ "success": true, "reply": "...", "toolCalls": [...], "model": "gemini-3.5-flash" }`
* **Response (Standby - 200)**: `{ "success": false, "isConfigured": false, "errorCode": "MISSING_GEMINI_API_KEY", "reply": "..." }`

### `POST /api/summary`
* **Request**: `{ "messages": [{ "role": "user", "content": "..." }], "callId": "CALL-123" }`
* **Response (200)**: `{ "success": true, "summary": { "customer_intent": "ORDER_TRACKING", "order_id": "ORD-101", "resolution_status": "RESOLVED", "call_summary": "..." }, "usedFallback": false }`

---

## 5. Environment Variables

Create `.env.local` in the project root:

```env
# Google Gemini API Key (Required for live Gemini AI chat & tool calling)
# Obtain at: https://aistudio.google.com/
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Preferred Gemini Model (Defaults to gemini-3.5-flash)
GEMINI_MODEL=gemini-3.5-flash

# Optional: OpenAI API Key (Only if using OpenAI TTS instead of browser Web Speech)
OPENAI_API_KEY=
```

> **Security Note**: All API keys reside exclusively on the server (`src/app/api/*`). No secret keys are ever exposed in client bundles, public environment variables, or error responses. Real `.env*.local` files are excluded by `.gitignore`.

---

## 6. Local Setup & Testing

### Installation & Run
```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite
npm test

# 3. Type check & Lint
npx tsc --noEmit
npm run lint

# 4. Production build
npm run build

# 5. Start development server
npm run dev
```

### Verified Test Results (100% Pass Rate)

```bash
npm run test:orders    # Orders database, normalization, cancellation & return policies (32 assertions passed)
npm run test:gemini    # Gemini tool calling, schemas, domain boundary guardrails (9 scenarios passed)
npm run test:summary   # 10 post-call summary scenarios, fallbacks & idempotency (10 scenarios passed)
```

**10 Summary Scenarios Covered**:
1. Successful Order-Tracking: Tracking `ORD-101` $\rightarrow$ `ORDER_TRACKING`, `ORD-101`, `RESOLVED`.
2. Successful Cancellation: Cancelling `ORD-103` $\rightarrow$ `CANCELLATION`, `ORD-103`, `RESOLVED`.
3. Rejected Cancellation: Rejecting `ORD-101` cancellation $\rightarrow$ `CANCELLATION`, `ORD-101`, `UNRESOLVED`.
4. Policy-Rejected Return: Return for `ORD-102` (14 days ago) $\rightarrow$ `RETURN`, `ORD-102`, `UNRESOLVED`.
5. Domain Boundary / Out of Scope: Flight booking $\rightarrow$ `OUT_OF_SCOPE`, `order_id: null`.
6. Empty Conversation: Immediate disconnect $\rightarrow$ `OTHER`, `order_id: null`, `UNRESOLVED` without crashing.
7. Deterministic Fallback: Graceful execution when Gemini API key is missing.
8. Malformed JSON Protection: Zod schema rejects malformed payload and activates fallback.
9. Missing Order ID: General inquiry leaves `order_id: null`.
10. Idempotency Guard: Repeated "End Call" clicks trigger exactly one summary request.

---

## 7. Vercel Deployment Procedure

1. **Push Workspace to GitHub / GitLab**:
   Ensure `.env.local` is **NOT** committed (verified ignored by `.gitignore`).
2. **Import Project into Vercel Dashboard**:
   * Framework Preset: **Next.js**
   * Root Directory: `./`
   * Build Command: `npm run build`
   * Output Directory: `.next`
3. **Configure Environment Variables in Vercel**:
   Add the following in **Settings $\rightarrow$ Environment Variables**:
   * `GEMINI_API_KEY`: Your Google AI Studio API key (`AIza...`).
   * `GEMINI_MODEL`: `gemini-3.5-flash` (optional, default).
   * `OPENAI_API_KEY`: Optional; leave blank to use browser Speech Synthesis.
4. **Deploy**:
   Click **Deploy**. All API routes deploy automatically as Vercel Serverless Functions.

---

## 8. Known Limitations

1. **Browser Speech Recognition**: Web Speech API is supported natively in Chromium-based browsers (Chrome, Edge). For Firefox and Safari in production, integrate a server-side WebSocket STT provider (e.g. Deepgram or Whisper).
2. **In-Memory Order State**: Current mock orders and call summaries reside in server memory. For enterprise production, bind to PostgreSQL / Prisma with Redis for distributed call state locks.
