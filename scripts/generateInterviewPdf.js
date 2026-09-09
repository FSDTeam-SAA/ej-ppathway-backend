import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN = 42;
const FOOTER_HEIGHT = 35;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

const pdfSafeText = (value) => String(value ?? '')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/[\u0980-\u09FF]/g, '') // strip any accidental raw bengali characters from standard fonts to avoid pdf-lib crash
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, ' ');

const splitLongWord = (word, maxWidth, font, size) => {
  const chunks = [];
  let chunk = '';
  for (const char of word) {
    const next = `${chunk}${char}`;
    if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};

const wrapText = (value, maxWidth, font, size) => {
  const paragraphs = pdfSafeText(value).replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const rawWord of paragraph.trim().split(/\s+/)) {
      const words = font.widthOfTextAtSize(rawWord, size) > maxWidth
        ? splitLongWord(rawWord, maxWidth, font, size)
        : [rawWord];
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
};

export async function generateInterviewPdf(outputPath) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldOblique = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);

  // Color Palette
  const primaryBrand = rgb(0.06, 0.35, 0.48); // Deep Teal / Slate
  const secondaryAccent = rgb(0.12, 0.53, 0.67); // Bright Cyan Teal
  const darkInk = rgb(0.12, 0.14, 0.18); // Dark Charcoal Text
  const bodyInk = rgb(0.22, 0.25, 0.30); // Body Text
  const mutedInk = rgb(0.45, 0.48, 0.54); // Subtle Gray
  const lightBg = rgb(0.94, 0.96, 0.98); // Light Accent Box
  const cardBorder = rgb(0.82, 0.86, 0.91); // Card Border
  const highlightGold = rgb(0.82, 0.55, 0.12); // Gold Badge
  const qBadgeBg = rgb(0.90, 0.95, 0.98); // Question Pill Background

  let page;
  let y;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (height) => {
    if (y - height < CONTENT_BOTTOM) {
      addPage();
    }
  };

  // Draw Header Banner on First Page
  addPage();

  // Draw Cover / Top Header
  page.drawRectangle({
    x: MARGIN,
    y: y - 75,
    width: contentWidth,
    height: 75,
    color: primaryBrand,
    borderRadius: 6
  });

  page.drawText('PROPHETIC PATHWAY (EJ-PATHWAY)', {
    x: MARGIN + 16,
    y: y - 28,
    size: 16,
    font: bold,
    color: rgb(1, 1, 1)
  });

  page.drawText('Complete Full-Stack Technical Interview Master Guide & Q&A', {
    x: MARGIN + 16,
    y: y - 48,
    size: 11,
    font: regular,
    color: rgb(0.88, 0.95, 0.98)
  });

  page.drawText('Mobile (Flutter) | Backend (Node/Express/Mongo) | Real-time (LiveKit/Socket.io) | Admin (Next.js)', {
    x: MARGIN + 16,
    y: y - 64,
    size: 8.5,
    font: oblique,
    color: rgb(0.78, 0.88, 0.92)
  });

  y -= 95;

  // Metadata Card
  page.drawRectangle({
    x: MARGIN,
    y: y - 44,
    width: contentWidth,
    height: 44,
    color: lightBg,
    borderColor: cardBorder,
    borderWidth: 1,
    borderRadius: 4
  });

  page.drawText('Candidate / Project: Md. Sozib Hossain | Prophetic Pathway Ecosystem', {
    x: MARGIN + 12,
    y: y - 17,
    size: 9.5,
    font: bold,
    color: primaryBrand
  });

  page.drawText('Tech Stack: Flutter, Riverpod, Dio, LiveKit WebRTC, Node.js, Express, MongoDB, Stripe, RevenueCat, Next.js 16', {
    x: MARGIN + 12,
    y: y - 33,
    size: 8.5,
    font: regular,
    color: bodyInk
  });

  y -= 60;

  // Helper function to render a Section Header
  const drawSectionHeader = (title, sub) => {
    ensureSpace(50);
    y -= 10;
    page.drawRectangle({
      x: MARGIN,
      y: y - 24,
      width: contentWidth,
      height: 24,
      color: rgb(0.92, 0.95, 0.98),
      borderColor: secondaryAccent,
      borderWidth: 0.8,
      borderRadius: 3
    });

    page.drawText(pdfSafeText(title.toUpperCase()), {
      x: MARGIN + 10,
      y: y - 16,
      size: 10.5,
      font: bold,
      color: primaryBrand
    });

    y -= 34;
    if (sub) {
      page.drawText(pdfSafeText(sub), {
        x: MARGIN + 2,
        y: y,
        size: 8.5,
        font: oblique,
        color: mutedInk
      });
      y -= 14;
    }
  };

  // Helper function to render a Question and Answer Box
  const drawQA = ({ qNumber, question, banglaSummary, englishAnswer, keyPoints = [], codeSnippet = null }) => {
    // Calculate required space approximately
    const qLines = wrapText(`Q${qNumber}: ${question}`, contentWidth - 16, bold, 10);
    const bLines = banglaSummary ? wrapText(`Bangla Context: ${banglaSummary}`, contentWidth - 16, oblique, 8.5) : [];
    const aLines = wrapText(englishAnswer, contentWidth - 16, regular, 9);
    
    let estimatedHeight = (qLines.length * 13) + (bLines.length * 11) + (aLines.length * 12) + 25;
    if (keyPoints.length > 0) estimatedHeight += keyPoints.length * 13 + 10;
    if (codeSnippet) estimatedHeight += 45;

    ensureSpace(Math.min(estimatedHeight, 140));

    // Question Box Header
    page.drawRectangle({
      x: MARGIN,
      y: y - (qLines.length * 13 + 8),
      width: contentWidth,
      height: qLines.length * 13 + 8,
      color: qBadgeBg,
      borderColor: cardBorder,
      borderWidth: 0.6,
      borderRadius: 3
    });

    let qY = y - 12;
    for (const ql of qLines) {
      page.drawText(ql, {
        x: MARGIN + 8,
        y: qY,
        size: 9.5,
        font: bold,
        color: primaryBrand
      });
      qY -= 13;
    }
    y -= (qLines.length * 13 + 14);

    // Bangla Concept / Hint
    if (bLines.length > 0) {
      for (const bl of bLines) {
        ensureSpace(12);
        page.drawText(bl, {
          x: MARGIN + 8,
          y: y,
          size: 8.5,
          font: oblique,
          color: highlightGold
        });
        y -= 11;
      }
      y -= 4;
    }

    // Answer Body
    for (const al of aLines) {
      ensureSpace(13);
      page.drawText(al, {
        x: MARGIN + 8,
        y: y,
        size: 9,
        font: regular,
        color: darkInk
      });
      y -= 12;
    }

    // Key Takeaways / Bullet points
    if (keyPoints.length > 0) {
      y -= 4;
      for (const kp of keyPoints) {
        const kpLines = wrapText(`* ${kp}`, contentWidth - 24, regular, 8.5);
        for (const kpl of kpLines) {
          ensureSpace(12);
          page.drawText(kpl, {
            x: MARGIN + 14,
            y: y,
            size: 8.5,
            font: regular,
            color: bodyInk
          });
          y -= 11.5;
        }
      }
    }

    // Code Snippet Box (if any)
    if (codeSnippet) {
      y -= 4;
      const snippetLines = wrapText(codeSnippet, contentWidth - 30, regular, 8);
      const boxHeight = snippetLines.length * 10.5 + 10;
      ensureSpace(boxHeight + 5);

      page.drawRectangle({
        x: MARGIN + 8,
        y: y - boxHeight,
        width: contentWidth - 16,
        height: boxHeight,
        color: rgb(0.15, 0.18, 0.22),
        borderRadius: 3
      });

      let codeY = y - 10;
      for (const cl of snippetLines) {
        page.drawText(cl, {
          x: MARGIN + 16,
          y: codeY,
          size: 7.5,
          font: regular,
          color: rgb(0.85, 0.95, 0.90)
        });
        codeY -= 10.5;
      }
      y -= (boxHeight + 8);
    }

    // Divider after QA
    y -= 8;
    ensureSpace(10);
    page.drawLine({
      start: { x: MARGIN + 10, y },
      end: { x: PAGE_WIDTH - MARGIN - 10, y },
      thickness: 0.5,
      color: rgb(0.88, 0.90, 0.94)
    });
    y -= 12;
  };

  // ==========================================
  // SECTION 1: ARCHITECTURE & SYSTEM OVERVIEW
  // ==========================================
  drawSectionHeader('Module 1: Project Architecture & System Overview', 'Core ecosystem design, micro-repositories, and inter-system communications');

  drawQA({
    qNumber: 1,
    question: 'Can you give a comprehensive 2-minute overview of the Prophetic Pathway (EJ-Pathway) platform?',
    banglaSummary: 'Interviewer jodi project summarize korte bole: Eita ekta full-stack Spiritual & Advisory consultation platform jekhane seeker ebong advisor-der moddhe real-time video/audio calling, chat, dynamic pricing, IAP tipping, multi-currency payouts ebong admin control exist kore.',
    englishAnswer: 'Prophetic Pathway is a multi-tier spiritual advisory and consultation platform engineered to connect clients (seekers) with verified spiritual advisors worldwide. The ecosystem consists of 5 modular systems: a cross-platform mobile client in Flutter, a robust Node.js/Express/MongoDB backend API, real-time LiveKit WebRTC media servers, Socket.io bi-directional messaging, two Next.js dashboards (Admin & Advisor), and a public marketing website.',
    keyPoints: [
      'Flutter App: Client-facing mobile application for booking, live WebRTC video/audio sessions, 1-on-1 chat, and RevenueCat tipping.',
      'Backend API: Layered RESTful micro-service with MongoDB, JWT RBAC, Stripe checkouts, PayPal/Hyperwallet payouts, and job queues.',
      'Admin Dashboard: Next.js 16 + React 19 CRM for advisor verification, dispute management, CMS editing, and platform financials.',
      'Advisor Dashboard: Web portal for advisors to conduct LiveKit video sessions, set hourly pricing, and withdraw earnings.',
      'Public Portal: SEO-friendly Next.js web application for browsing verified advisors, reviews, and booking appointments.'
    ]
  });

  drawQA({
    qNumber: 2,
    question: 'What architectural patterns were chosen for this project and why?',
    banglaSummary: 'Architecture pattern er proshno: Flutter-e Clean Architecture (Feature-First) ebong Backend-e Layered Architecture (Controller-Service-Model with Validators and Middlewares) follow kora hoyse.',
    englishAnswer: 'On the mobile side (Flutter), we strictly adhered to Feature-First Clean Architecture. The codebase is organized into distinct feature modules (auth, advisors, sessions, wallet, support_chat) with core infrastructure (network, storage, router, providers) separated. On the backend (Node.js), we implemented a Layered MVC/Service pattern separating Routing, Request Validation (Zod), Controller orchestration, Business Logic Services, and Data Access (Mongoose models).',
    keyPoints: [
      'Separation of Concerns: Business logic is decoupled from UI widgets in Flutter and HTTP transport in Express.',
      'Scalability: Adding new features (e.g., automated chat transcripts or new payout gateways) does not impact existing services.',
      'Testability & Maintainability: High cohesion and loose coupling allow isolated unit and integration testing.'
    ]
  });

  // ==========================================
  // SECTION 2: FLUTTER & MOBILE ENGINEERING
  // ==========================================
  drawSectionHeader('Module 2: Flutter & Mobile Client Engineering', 'State management, Riverpod 3, Dio interceptors, GoRouter, and storage');

  drawQA({
    qNumber: 3,
    question: 'Why did you select Riverpod 3 for state management over Bloc or Provider?',
    banglaSummary: 'Riverpod keno use kora hoyse: Riverpod compile-time safe, Context-free, automatic disposal provide kore ebong asynchronous state (AsyncValue) handle kora khub shohoj.',
    englishAnswer: 'Flutter Riverpod 3 was chosen because it overcomes the architectural limitations of Provider by eliminating reliance on BuildContext for dependency injection and state access. It offers compile-time safety, seamless asynchronous state handling with AsyncValue (data, loading, error states), auto-disposing cached providers when screens unmount to prevent memory leaks, and simplified mockability for test suites.',
    keyPoints: [
      'Global declarations without context dependencies enable clean service layer integration.',
      'Auto-dispose mechanism guarantees automatic memory cleanup when routes are popped.',
      'Family and AsyncNotifier providers handle parameterized queries and optimistic UI updates efficiently.'
    ],
    codeSnippet: 'final advisorDetailsProvider = FutureProvider.autoDispose.family<Advisor, String>((ref, id) async {\n  final repository = ref.watch(advisorRepositoryProvider);\n  return repository.getAdvisorById(id);\n});'
  });

  drawQA({
    qNumber: 4,
    question: 'How did you configure Dio HTTP Client, Token Refresh, and Network Interceptors?',
    banglaSummary: 'Dio client configuration: Dio interceptor diye automatic Bearer JWT token inject kora hoy, secure storage theke token fetch kore ebong standardized error response map kore.',
    englishAnswer: 'We engineered a centralized Dio singleton managed via Riverpod (`apiClientProvider`). The client uses custom Interceptors that intercept every outgoing request to inject the `Authorization: Bearer <token>` header retrieved securely from `flutter_secure_storage`. On response errors, it intercepts 401 Unauthorized codes to trigger session expiry broadcasts, logs formatted debug traces via `DebugLog`, and normalizes backend error responses into domain-level AppException models.',
    keyPoints: [
      'BaseOptions: Strict connectTimeout and receiveTimeout (15s) configured for resilient mobile networking.',
      'Secure Token Storage: Sensitive auth tokens stored in platform-encrypted hardware storage (Keychain on iOS, EncryptedSharedPreferences on Android).',
      'Unified Error Mapping: Converts DioException (socket timeouts, 4xx/5xx status) into user-friendly localized messages.'
    ]
  });

  drawQA({
    qNumber: 5,
    question: 'How does GoRouter handle deep linking, navigation guards, and role-based redirects?',
    banglaSummary: 'GoRouter navigation guard: GoRouter er `redirect` callback e auth provider watch kore unauthenticated user ke login screen-e pathano hoy ebong onboarding check kora hoy.',
    englishAnswer: 'GoRouter (v17.x) serves as the declarative routing solution. We implemented a top-level `redirect` guard that monitors both authentication status and onboarding flags from Riverpod providers. If an unauthenticated user attempts to access protected routes (e.g. `/sessions`, `/wallet`), GoRouter automatically intercepts and routes them to `/login` while preserving the intended destination query param.',
    keyPoints: [
      'Declarative Route Tree: Type-safe route paths and nested shell routes for persistent bottom navigation bars.',
      'Deep Linking: Configured intent filters in AndroidManifest.xml and Info.plist for seamless URL launching.',
      'Transition Animations: Custom page transitions for smooth modal sheets and screen transitions.'
    ]
  });

  // ==========================================
  // SECTION 3: REAL-TIME & WEBRTC (LIVEKIT & SOCKET.IO)
  // ==========================================
  drawSectionHeader('Module 3: Real-Time Communication & WebRTC Infrastructure', 'LiveKit SFU video/audio calling, Socket.io chat, and Egress recording');

  drawQA({
    qNumber: 6,
    question: 'Why did you use both LiveKit and Socket.io? What are their distinct responsibilities?',
    banglaSummary: 'LiveKit vs Socket.io: LiveKit holo WebRTC SFU engine ja real-time video/audio streaming and recording handle kore. Socket.io holo lightweight bi-directional websocket engine ja live chat, presence, typing status ebong notification handle kore.',
    englishAnswer: 'We separated media streaming from signaling and text messaging based on architectural requirements. Socket.io is optimized for lightweight, low-overhead JSON payloads (1-on-1 chat messages, typing indicators, user online/offline presence, read receipts, and live notification pushes). LiveKit is a dedicated WebRTC Selective Forwarding Unit (SFU) designed for ultra-low latency (<200ms), multi-participant HD video/audio routing, adaptive bitrate switching (simulcast), and server-side Egress recording.',
    keyPoints: [
      'Socket.io: Chat messages, typing status, unread counts, booking status updates, instant push sync.',
      'LiveKit WebRTC: 1-on-1 spiritual consultation audio/video calls, mute/unmute, camera flip, room disconnect detection.',
      'Cost & Resource Efficiency: WebRTC SFU traffic is reserved strictly for active live calls, preventing media server overload.'
    ]
  });

  drawQA({
    qNumber: 7,
    question: 'Explain how the LiveKit Room token generation and connection lifecycle works.',
    banglaSummary: 'LiveKit token flow: Backend e `livekit-server-sdk` diye Room name, User Identity ebong VideoGrant sign kore JWT token banano hoy. Client sei token diye LiveKit server e connect hoy.',
    englishAnswer: '1. When a consultation session begins, the client requests a LiveKit token from the backend (`POST /api/v1/sessions/:id/livekit-token`).\n2. The backend validates the user identity, checks that the session is in an active state, and uses `livekit-server-sdk` AccessToken to sign a cryptographically secure JWT with specific `VideoGrant` permissions (roomJoin: true, roomName: sessionCode, canPublish: true, canSubscribe: true).\n3. The Flutter client initializes `LiveKitClient.connect(url, token)`.\n4. The client subscribes to remote audio/video tracks, manages local media streams with `permission_handler`, and listens to connection state changes.',
    keyPoints: [
      'Security: Clients never possess LiveKit API secrets; tokens are short-lived and tied to individual session IDs.',
      'Reconnection Handling: Built-in exponential backoff reconnection handles mobile network transitions (4G to Wi-Fi).'
    ]
  });

  drawQA({
    qNumber: 8,
    question: 'How is session recording (Egress) and Chat Transcript PDF export implemented?',
    banglaSummary: 'Session Recording & PDF Export: LiveKit Egress service audio/video record kore S3/GCS e pathay ebong webhook er maddhome URL save kore. Chat history export er jonno backend e `pdf-lib` diye dynamically PDF generate kora hoy.',
    englishAnswer: 'For video/audio sessions, the backend triggers LiveKit Egress recordings upon session start. When the recording concludes, LiveKit posts a webhook to `/api/v1/webhooks/livekit`, triggering `recording.service.js` to attach the encrypted recording URL to the Session record. For text chat sessions, `chatTranscriptPdf.service.js` uses `pdf-lib` to dynamically generate branded, paginated, and formatted PDF transcripts containing timestamps, sender identities, messages, and attachments for user download.',
    keyPoints: [
      'Webhook Raw Body Preservation: LiveKit webhook verification requires raw payload headers mounted before body parsers.',
      'Pdf-lib Custom Layout: Computes dynamic word-wrapping, page overflow calculation, and footers with page numbers.'
    ]
  });

  // ==========================================
  // SECTION 4: BACKEND, DATABASE & APIS
  // ==========================================
  drawSectionHeader('Module 4: Node.js, Express & MongoDB Backend Engineering', 'Layered architecture, Mongoose schemas, Zod validation, and concurrency');

  drawQA({
    qNumber: 9,
    question: 'How is Authentication & Role-Based Access Control (RBAC) structured on the backend?',
    banglaSummary: 'Backend Auth & RBAC: JWT token (cookie ebong bearer header) support kore. `requireAuth` middleware token verify kore user attach kore, ebong `requireRole("admin", "advisor")` diye route guard kora hoy.',
    englishAnswer: 'Authentication utilizes stateless JSON Web Tokens (JWT). The `requireAuth` middleware extracts the token from either the HTTP-only cookie or the `Authorization: Bearer` header, verifies the signature, and attaches the active `req.user` payload. Role-based authorization is enforced via higher-order middleware `requireRole(...roles)` which restricts access to admin or advisor endpoints (e.g. `/api/v1/admin/*`, `/api/v1/advisor/*`).',
    keyPoints: [
      'Password Security: Passwords salted and hashed with `bcryptjs` (salt rounds = 10).',
      'Rate Limiting: Sensitive routes (login, register, forgot-password) guarded by `express-rate-limit` (100 req / 15 mins).',
      'Token Expiry: Short-lived access tokens with secure refresh mechanisms.'
    ]
  });

  drawQA({
    qNumber: 10,
    question: 'Why and how did you implement Zod for request validation?',
    banglaSummary: 'Zod validation keno: Runtime type-safety ebong strict schema validation er jonno. Controller e jaoar agei request body/query validate hoye standardized error return kore.',
    englishAnswer: 'Zod provides declarative, TypeScript-compatible runtime schema validation. Instead of manual validation checks inside controller methods, we created reusable validation middleware `validate(schema)` that inspects `req.body`, `req.params`, and `req.query`. If validation fails, it formats the Zod error issues into clean key-value error maps and immediately responds with HTTP 400 Bad Request, preventing invalid data from reaching the database layer.',
    keyPoints: [
      'Schema Consistency: Centralized schemas in `/validators` ensure mobile and web inputs conform to exact data contracts.',
      'Type Coercion: Automatically parses numbers, ISO date strings, and boolean flags safely.'
    ],
    codeSnippet: 'export const createSessionSchema = z.object({\n  advisorId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Advisor ID"),\n  scheduledFor: z.string().datetime(),\n  durationMinutes: z.number().min(15).max(120)\n});'
  });

  drawQA({
    qNumber: 11,
    question: 'How did you solve the concurrency problem of double-booking consultation slots?',
    banglaSummary: 'Double-booking concurrency solve: `SessionSlotLock` model ebong MongoDB Unique Compound Index `(advisorId, slotTime)` ebong TTL (Time-To-Live) index use kore temporary lock create kora hoy.',
    englishAnswer: 'To prevent race conditions where two clients attempt to book the exact same advisor time slot simultaneously, we implemented a distributed locking strategy using a dedicated `SessionSlotLock` collection. We applied a unique compound index on `{ advisorId: 1, slotTime: 1 }` with an automatic TTL (Time-To-Live) expiration of 10 minutes. When checkout begins, a lock is acquired atomically. If a duplicate insert occurs, MongoDB throws an `E11000 duplicate key` error, cleanly rejecting the second attempt.',
    keyPoints: [
      'Atomic Reservation: Guarantees that only one user holds the reservation during payment completion.',
      'Automatic Expiry: If the user abandons payment, the TTL index automatically purges the lock, releasing the slot.'
    ]
  });

  drawQA({
    qNumber: 12,
    question: 'How are asynchronous background tasks and scheduled reminders handled without Redis?',
    banglaSummary: 'Background Jobs & Queues: `jobQueue.service.js` er maddhome custom in-memory queue ebong MongoDB `Job` collection diye scheduled session reminders, auto-completion ebong status cleanup handle kora hoy.',
    englishAnswer: 'We engineered a lightweight, robust in-memory job processing engine (`jobQueue.service.js`) with MongoDB persistence (`job.model.js`). The engine periodically scans for scheduled tasks (such as sending upcoming session email/push notifications 15 minutes prior, automatically completing expired sessions, and retrying failed payouts). Each job maintains state (pending, processing, completed, failed) with exponential retry backoff intervals.',
    keyPoints: [
      'Health Monitoring: Real-time job queue status is exposed at the `/api/v1/health` endpoint for uptime monitoring.',
      'Graceful Shutdown: Process signals (SIGINT/SIGTERM) allow running jobs to complete before server termination.'
    ]
  });

  // ==========================================
  // SECTION 5: PAYMENTS, IN-APP PURCHASES & WALLET
  // ==========================================
  drawSectionHeader('Module 5: Payment Gateways, RevenueCat IAP & Advisor Payouts', 'Stripe checkout, Mobile In-App Purchases, Multi-currency wallet, and PayPal');

  drawQA({
    qNumber: 13,
    question: 'Explain the In-App Purchase (RevenueCat) integration and why you encountered Billing errors in development.',
    banglaSummary: 'RevenueCat IAP ebong Emulator issue: Mobile e tipping feature er jonno RevenueCat SDK use kora hoyse. Android Emulator e Google Play Services/Store login na thakle `BILLING_UNAVAILABLE` error ashe, ja real device e ba Google Play enabled AVD te login kore test korte hoy.',
    englishAnswer: 'For mobile micro-transactions (tipping advisors with tip_5, tip_10, etc.), we integrated RevenueCat (`purchases_flutter`). When testing on Android Emulators lacking Google Play Services or without an active Google Play Store account, Google BillingClient returns `BILLING_UNAVAILABLE` / `PurchaseNotAllowedError`. In production, RevenueCat validates the cryptographic receipt with Google Play/Apple App Store and dispatches a secure server-to-server webhook to our backend (`iapTip.service.js`) to credit the advisor wallet balance.',
    keyPoints: [
      'Idempotent Processing: Webhooks verify transaction identifiers to prevent duplicate wallet credits.',
      'Graceful Degradation: The Flutter UI catches PlatformExceptions and displays friendly fallback notices.'
    ]
  });

  drawQA({
    qNumber: 14,
    question: 'How does the Advisor Wallet, Commission Split, and Multi-Currency Payout flow work?',
    banglaSummary: 'Wallet & Payout workflow: Client payment korle platform commission kete baki balance advisor wallet e `pending` ba `available` balance hishebe jog hoy. Advisor PayPal ba Hyperwallet er maddhome bank withdrawal request pathay.',
    englishAnswer: '1. Booking Payment: Client pays via Stripe or IAP in their local currency.\n2. Commission Deduction: Backend retrieves the platform commission percentage from `PlatformSetting` and calculates advisor earnings.\n3. Escrow & Credit: Funds are credited to the Advisor `Wallet` in an escrow state until session completion.\n4. Payout Execution: Advisors request withdrawal via PayPal or Hyperwallet. Admin audits and approves payouts through the Admin Dashboard, which executes the batch payout API and writes an immutable audit record in `Transaction` history.',
    keyPoints: [
      'Dynamic Currency Catalog: `currencyCatalog.service.js` handles real-time FX conversion across 30+ international currencies.',
      'Immutable Ledger: Every credit, debit, refund, and fee is recorded in the transaction ledger for accounting compliance.'
    ]
  });

  // ==========================================
  // SECTION 6: NEXT.JS ADMIN & ADVISOR DASHBOARDS
  // ==========================================
  drawSectionHeader('Module 6: Next.js 16 Admin & Advisor Web Dashboards', 'React 19, Tailwind CSS v4, Tiptap/Quill CMS, and Real-Time Portals');

  drawQA({
    qNumber: 15,
    question: 'What modern React 19 and Next.js 16 features were utilized in the Admin and Advisor dashboards?',
    banglaSummary: 'Next.js 16 & React 19 features: Next.js App Router, Server Components for fast data fetching, React 19 Hooks (`useActionState`, `useOptimistic`), Tailwind CSS v4 for zero-runtime styling, ebong Tiptap rich-text editor for CMS.',
    englishAnswer: 'Both web dashboards leverage the Next.js 16 App Router with React 19. We utilized React Server Components (RSC) to perform server-side data fetching and authentication verification before streaming HTML to the client, drastically reducing initial JS payload sizes. Client components handle rich interactivity such as real-time chart visualizers, live socket feeds, and the Tiptap/Quill WYSIWYG rich-text content editors for managing platform CMS, blogs, and FAQ items.',
    keyPoints: [
      'Tailwind CSS v4: Modern, high-performance styling engine with CSS variables and zero-config PostCSS plugin.',
      'Advisor Web Calling: The Advisor Dashboard embeds `livekit-client` directly in the browser for web-based video consultations.'
    ]
  });

  // ==========================================
  // SECTION 7: SCENARIO-BASED & PROBLEM SOLVING
  // ==========================================
  drawSectionHeader('Module 7: Real-World Scenario & Debugging Challenges', 'Concrete technical obstacles encountered during development and their solutions');

  drawQA({
    qNumber: 16,
    question: 'Describe a critical backend challenge you resolved regarding Webhook Signature Verification.',
    banglaSummary: 'Webhook raw body issue: Express.js er `express.json()` middleware body parse kore object baniye fele, jar fole Stripe ba LiveKit er HMAC cryptographic signature verify kora jeto na. Solution: Webhook route ke `express.json()` er age raw body hishebe mount kora hoyse.',
    englishAnswer: 'A critical issue arose during Stripe and LiveKit webhook integrations: cryptographic signature verification failed repeatedly. This occurred because global `express.json()` parsed incoming request streams into JavaScript objects, altering whitespace and encoding. To solve this, we restructured `app.js` to mount `/api/v1/webhooks` before `express.json()` with `express.raw({ type: "application/json" })`, ensuring pristine byte-for-byte HMAC SHA-256 signature verification.',
    keyPoints: [
      'Security Guarantee: Prevents unauthorized attackers from faking payment completion webhooks.',
      'Clean Routing: Webhook handlers reside in modular controllers without polluting global application middleware.'
    ]
  });

  drawQA({
    qNumber: 17,
    question: 'How did you handle memory leaks and unreleased resources in the Flutter mobile application?',
    banglaSummary: 'Flutter Memory Leak solution: `W/System: A resource failed to call release` warning ashto jokhon Camera, Audio, StreamSubscription ba Controllers `dispose()` kora hoto na. Solution: Stateful widget er `dispose()` method e shob controller close kora ebong Riverpod autoDispose use kora.',
    englishAnswer: 'During high-frequency screen transitions, Android system logs showed `W/System: A resource failed to call release`. We conducted memory profiling and identified unreleased `VideoPlayerController`, `ChewieController`, `StreamSubscription` instances in chat screens, and active camera feeds from LiveKit. We resolved this by strictly implementing `dispose()` lifecycle overrides across all StatefulWidgets, canceling socket listeners upon view teardown, and converting long-lived providers to `autoDispose`.',
    keyPoints: [
      'Flutter DevTools: Verified zero memory leaks using the memory allocation and widget rebuild inspector.',
      'Robust Teardown: Guaranteed that network sockets and media hardware are released instantly when sessions end.'
    ]
  });

  // ==========================================
  // SECTION 8: INTERVIEW PITCH & BEHAVIORAL
  // ==========================================
  drawSectionHeader('Module 8: Candidate Pitch & Project Presentation Strategy', 'How to deliver an impactful response when asked about this project in an interview');

  drawQA({
    qNumber: 18,
    question: 'How should you answer: "What was your exact role and contribution in this project?"',
    banglaSummary: 'Interview e nijer role bolte: Ami full-stack architecture design koresi, Flutter app er core state management (Riverpod), LiveKit WebRTC video integration, Node.js backend API, Stripe & IAP payment webhooks, ebong Next.js Admin dashboard build koresi.',
    englishAnswer: 'As the lead full-stack developer on the Prophetic Pathway platform, I was responsible for end-to-end architecture and implementation across the entire product lifecycle. My primary contributions included:\n1. Designing the Flutter client architecture using Riverpod 3, Dio, and GoRouter.\n2. Implementing ultra-low latency WebRTC video/audio consultation rooms using LiveKit SFU.\n3. Building the Node.js/Express backend with MongoDB schemas, Zod validation, and JWT RBAC.\n4. Integrating multi-channel monetizations: Stripe Checkout, In-App Purchases (RevenueCat), and PayPal payout gateways.\n5. Developing the Next.js 16 + React 19 Admin & Advisor web dashboards for platform management.',
    keyPoints: [
      'Demonstrates full-stack ownership across Mobile, Backend, Real-Time Media, and Web.',
      'Highlights experience with complex financial transactions, media streaming, and production deployment.'
    ]
  });

  // Add Final Page Numbering & Footer
  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    const footerText = `Prophetic Pathway (EJ-Pathway) - Interview Preparation Guide | Page ${index + 1} of ${pages.length}`;
    const width = regular.widthOfTextAtSize(footerText, 8);

    pdfPage.drawLine({
      start: { x: MARGIN, y: MARGIN },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN },
      thickness: 0.5,
      color: cardBorder
    });

    pdfPage.drawText(footerText, {
      x: (PAGE_WIDTH - width) / 2,
      y: MARGIN - 16,
      size: 8,
      font: regular,
      color: mutedInk
    });
  });

  pdf.setTitle('Prophetic Pathway - Full-Stack Interview Questions & Answers');
  pdf.setAuthor('Md. Sozib Hossain');
  pdf.setSubject('Full-Stack Technical Interview Master Guide');
  pdf.setCreator('Prophetic Pathway Engineering');
  pdf.setCreationDate(new Date());

  const pdfBytes = await pdf.save();
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`[PDF Generator] Successfully generated PDF at: ${outputPath} (${pdfBytes.length} bytes, ${pages.length} pages)`);
}

// If executed directly
const targetFile = process.argv[2] || path.resolve(__dirname, '../../EJ_Pathway_Interview_Questions_and_Answers.pdf');
generateInterviewPdf(targetFile).catch(err => {
  console.error('[PDF Generator Error]:', err);
  process.exit(1);
});
