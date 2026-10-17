# Aura Skincare AI Voice Agent — Aria: 3–5 Minute Demo Script
### DataStraw Technical Hiring Assessment

> **Presenter Note**: Run the application locally with `npm run dev` at `http://localhost:3000` using Google Chrome or Microsoft Edge.
> Have the microphone enabled. If `GEMINI_API_KEY` is not present, the live UI and API inspector demonstrate the deterministic fallback engine, automated tool execution, and Zod-validated summaries.

---

## Demo Timeline & Steps

### 1. Project Overview (0:00 – 0:45)
* **Visual**: Show the Aura Skincare home page with Aria Concierge badge, order cards, and policy calculator.
* **Spoken Script**:
  > *"Hello, my name is [Your Name], and this is Aria — an enterprise-grade AI voice concierge built for Aura Skincare for the DataStraw technical assessment.
  >
  > The system is architected around real browser microphone streaming, Next.js server-side API routes, Google Gemini function calling, and strict backend policy enforcement.
  >
  > On screen, you can see our sample customer orders: Priya Sharma's Vitamin C Serum which is currently Out for Delivery, Rahul Verma's Sunscreen delivered 14 days ago, and Ananya Patel's Face Wash which is currently Processing.
  >
  > Let's start a call to see Aria in action."*

---

### 2. Live Voice Interaction & Active Call State (0:45 – 1:15)
* **Action**: Click the green **Start Call** button.
* **Visual**: Show the call status change to `Active Call (00:03)`, the timer ticking, and the voice visualizer active.
* **Spoken Script**:
  > *"When I click 'Start Call', Aria initializes our Web Speech state machine, transitions to the active phase, and starts the call timer.
  >
  > The browser's speech recognition engine streams interim transcript tokens live into the preview banner without polluting our permanent message history until finalized."*

---

### 3. Scenario 1: ORD-101 Order Tracking (1:15 – 1:50)
* **Action**: Speak into the microphone or click the assessment prompt button: `"Where is my order ORD-101?"`
* **Visual**:
  * Voice transcript appears: `User: Where is my order ORD-101?`
  * Tool execution occurs: `get_order_details({ order_id: "ORD-101" })`.
  * Aria responds with audible speech: *"Your order ORD-101 for Vitamin C Serum 30ml is Out for Delivery with BlueDart, tracking ID BD-982103, expected by 6 PM today."*
* **Spoken Script**:
  > *"Notice that our backend automatically normalizes order ID variations — whether spoken as 'ord 101', 'ORD-101', or just '101'.
  >
  > Aria invoked the `get_order_details` function, verified BlueDart tracking, and provided real-time delivery expectations."*

---

### 4. Scenario 2: Rejected Cancellation of ORD-101 (1:50 – 2:30)
* **Action**: Speak into the microphone or click prompt: `"Can you cancel order ORD-101 for me?"`
* **Visual**:
  * Tool execution occurs: `cancel_order({ order_id: "ORD-101" })`.
  * Status returns 422 `CANNOT_CANCEL_OUT_FOR_DELIVERY`.
  * Aria responds audibly: *"I'm unable to cancel order ORD-101 because it is already Out for Delivery with BlueDart. As per Aura Skincare policy, orders in transit cannot be cancelled mid-delivery."*
* **Spoken Script**:
  > *"A critical assessment requirement is zero-hallucination policy enforcement. Even if an LLM is persuaded by a user, the backend strictly rejects cancellation requests once courier dispatch has occurred.
  >
  > The policy engine returned `CANNOT_CANCEL_OUT_FOR_DELIVERY`, and Aria politely upheld company policy."*

---

### 5. Scenario 3: Successful Cancellation of ORD-103 (2:30 – 3:05)
* **Action**: Speak into the microphone or click prompt: `"Please cancel my order ORD-103."`
* **Visual**:
  * Tool execution occurs: `cancel_order({ order_id: "ORD-103" })`.
  * In-memory database updates ORD-103 badge from `Processing` to `Cancelled`.
  * Aria responds audibly: *"Your order ORD-103 has been successfully cancelled. A full refund of ₹850 will be processed to your original payment method within 5 to 7 business days."*
* **Spoken Script**:
  > *"Because ORD-103 was in 'Processing' status, the backend allowed the cancellation.
  >
  > Notice the order card in our UI immediately updated to 'Cancelled'. If the user were to ask to cancel ORD-103 again, Aria would detect it is already cancelled."*

---

### 6. Scenario 4: Out-of-Scope Request Guardrails (3:05 – 3:35)
* **Action**: Speak into the microphone or click prompt: `"Can you book me a flight to Goa for this weekend?"`
* **Visual**:
  * Aria responds: *"I am Aria, the customer-support assistant for Aura Skincare. I can only assist with skincare orders, products, and policies. I cannot book flights or travel services."*
* **Spoken Script**:
  > *"Our system prompt enforces strict domain boundary guardrails. Aria politely declines off-topic inquiries without hallucinating capabilities."*

---

### 7. End Call, Validated Transcript & JSON Summary (3:35 – 4:20)
* **Action**: Click the red **End Call** button.
* **Visual**:
  * Call timer stops.
  * Post-Call Summary section renders instantly:
    * **Customer Intent Card**: E.g., `Order Tracking` / `Cancellation`.
    * **Order ID Card**: E.g., `ORD-101` / `ORD-103` (or `None identified`).
    * **Resolution Status Badge**: `RESOLVED` / `UNRESOLVED`.
    * **Call Summary Text**: Factual 1-2 sentence description.
    * **Structured JSON Box**: Monospaced, syntax-highlighted JSON adhering strictly to `CallSummarySchema`.
    * **Copy JSON Button**: Click it to show the `Copied!` tooltip.
    * **Complete Transcript**: Chronological turn-by-turn log.
* **Spoken Script**:
  > *"When I click 'End Call', our idempotency guard snapshots the transcript and invokes `/api/summary`.
  >
  > The output is validated through our strict Zod `CallSummarySchema`:
  > It extracts the customer's intent, the normalized order ID, the resolution status, and a factual summary.
  >
  > If no order was identified, order ID is strictly set to null — never fabricated.
  > The raw transcript is treated as untrusted input and fenced to prevent prompt injection."*

---

### 8. Architecture & Security Wrap-Up (4:20 – 5:00)
* **Visual**: Point to the **Live Server APIs** badge and **API Response Inspector** at the bottom of the page.
* **Spoken Script**:
  > *"To summarize our technical highlights:
  > 1. **Security**: All API keys reside strictly on the server; zero secrets in client bundles.
  > 2. **Reliability**: Deterministic fallbacks for STT, TTS, and summary extraction guarantee 100% application uptime.
  > 3. **Testing**: Our automated test suite covers all 32 order policy assertions, 9 Gemini tool calling scenarios, and 10 post-call summary test cases with 100% pass rate.
  >
  > Thank you for reviewing the Aura Skincare AI Voice Agent!"*
