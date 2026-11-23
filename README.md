# Securitier - Web Security Testing Agent

An automated browser security testing agent built with **Playwright (Chromium)**, **Express (TypeScript)**, and **React + Tailwind CSS**.

Securitier provides developers and security auditors with a controlled workbench to inspect web forms, evaluate authentication workflows, test for username enumeration, assess rate-limiting enforcement, and monitor network requests with strict credential redaction.

---

## Key Features

1. **Session Initialization & Authorization Gate**
   - Requires explicit ownership/authorization declaration before launching Playwright.
   - Built-in local demo target (`http://localhost:5000/demo-login`) with rate limiting and secure session cookies for safe offline evaluation.
   - Live browser viewport screenshot capture and DOM inspection.

2. **Interactive DOM Inspector & Element Mapping**
   - Automatically extracts interactive elements (`<input>`, `<button>`, etc.) with unique reference IDs (`el-1`, `el-2`, etc.), tags, and CSS selectors.
   - One-click mapping for Username/Email, Password, and Submit button fields.

3. **Controlled Security Test Suites (No Unrestricted Brute-Force)**
   - **Rate Limiting & Lockout Check**: Controlled sequence of 3-5 rapid requests to detect HTTP 429 status code or challenge prompts.
   - **Username Enumeration Test**: Evaluates whether invalid usernames receive distinguishable vs. generic error messages.
   - **Invalid Password Check**: Analyzes authentication failure response formatting and timing.
   - **Empty Field Validation**: Checks client-side and server-side mandatory field handling.
   - **Malformed Format & Boundary Testing**: Evaluates regex validation and boundary inputs.
   - **Authorized Account Verification**: Evaluates session establishment and cookie security attributes (`HttpOnly`, `Secure`, `SameSite`).

4. **Network & API Monitor with Redaction**
   - Captures all outgoing requests and server responses triggered by browser actions.
   - **Strict Redaction**: Automatically redacts passwords, tokens, auth headers, and raw session cookie values.
   - Real-time event streaming over WebSocket (`ws://localhost:5000/ws`).

5. **Security Reporting & Audit Findings**
   - Summary cards: Total tests, passed, warnings, and weaknesses identified.
   - Detailed findings with remediation guidance.
   - Export reports in **JSON** or **Markdown** format.

---

## Getting Started

### 1. Start the Backend

```bash
cd backend
npm run dev
```

- Server: `http://localhost:5000`
- WebSocket: `ws://localhost:5000/ws`
- Built-in Demo Target: `http://localhost:5000/demo-login`

### 2. Start the Frontend

```bash
cd frontend
npm run dev
```

- Frontend UI: `http://localhost:5173`

---

## Safe Testing Instructions

1. Open the UI at `http://localhost:5173`.
2. Check the **Authorization Declaration** checkbox.
3. Use the built-in demo target `http://localhost:5000/demo-login` (or enter your own authorized application URL).
4. Click **Launch Playwright Session**.
5. In the **DOM & Elements** tab, click **Email/User**, **Password**, and **Submit** on the respective form elements.
6. Switch to **Security Test Suites**, select a test scenario (e.g. *Rate-Limiting & Lockout Check* or *Username Enumeration Test*), and click **Execute Selected Test**.
7. Observe live traffic in the **Network API Monitor** and download the audit report from the **Audit Report** tab.
