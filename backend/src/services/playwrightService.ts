import { chromium, Browser, BrowserContext, Page, Request, Response } from 'playwright';
import { InteractiveElement, NetworkLogEntry, TestScenarioConfig, TestResult, SecurityObservation } from '../types';

export interface ActiveSession {
  id: string;
  targetUrl: string;
  authorized: boolean;
  createdAt: Date;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  elements: InteractiveElement[];
  networkLogs: NetworkLogEntry[];
  testHistory: TestResult[];
  wsBroadcast?: (data: any) => void;
}

export class PlaywrightService {
  private sessions = new Map<string, ActiveSession>();

  // Sensitive data redaction helper
  public redactSensitiveData(data: any): any {
    if (!data) return data;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return JSON.stringify(this.redactSensitiveData(parsed));
      } catch {
        return data;
      }
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item));
    }
    if (typeof data === 'object') {
      const redacted: Record<string, any> = {};
      const sensitiveKeys = ['password', 'pass', 'pwd', 'token', 'authorization', 'secret', 'key', 'credential', 'auth', 'cookie'];
      for (const [k, v] of Object.entries(data)) {
        if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
          redacted[k] = '[REDACTED_FOR_SECURITY]';
        } else if (typeof v === 'object') {
          redacted[k] = this.redactSensitiveData(v);
        } else {
          redacted[k] = v;
        }
      }
      return redacted;
    }
    return data;
  }

  // Redact sensitive headers
  public redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {};
    const sensitive = ['authorization', 'cookie', 'set-cookie', 'x-auth-token', 'proxy-authorization'];
    for (const [k, v] of Object.entries(headers)) {
      if (sensitive.includes(k.toLowerCase())) {
        redacted[k] = '[REDACTED_FOR_SECURITY]';
      } else {
        redacted[k] = v;
      }
    }
    return redacted;
  }

  // Start new browser testing session
  public async startSession(
    sessionId: string,
    targetUrl: string,
    authorized: boolean,
    wsBroadcast?: (data: any) => void
  ): Promise<{ elements: InteractiveElement[]; screenshot: string }> {
    if (!authorized) {
      throw new Error('Explicit authorization confirmation is strictly required to initialize a security testing session.');
    }

    // Launch Chromium
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Securitier-AuditAgent/1.0',
    });

    const page = await context.newPage();

    const session: ActiveSession = {
      id: sessionId,
      targetUrl,
      authorized,
      createdAt: new Date(),
      browser,
      context,
      page,
      elements: [],
      networkLogs: [],
      testHistory: [],
      wsBroadcast,
    };

    // Attach Network Monitor
    const requestTimes = new Map<string, number>();

    page.on('request', (req: Request) => {
      const reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      requestTimes.set(req.url(), Date.now());

      let payload = undefined;
      try {
        const postData = req.postData();
        if (postData) {
          payload = this.redactSensitiveData(postData);
        }
      } catch {
        payload = '[BINARY_OR_UNREADABLE]';
      }

      const logEntry: NetworkLogEntry = {
        id: reqId,
        timestamp: new Date().toISOString(),
        url: req.url(),
        method: req.method(),
        status: 0,
        durationMs: 0,
        requestHeaders: this.redactHeaders(req.headers()),
        requestPayload: payload,
        responseHeaders: {},
        cookiesMetadata: [],
      };

      session.networkLogs.unshift(logEntry);
      if (session.networkLogs.length > 100) session.networkLogs.pop();

      wsBroadcast?.({
        type: 'NETWORK_REQUEST',
        data: logEntry,
      });
    });

    page.on('response', async (res: Response) => {
      const startTime = requestTimes.get(res.url()) || Date.now();
      const durationMs = Date.now() - startTime;
      const status = res.status();

      let bodySnippet = '';
      try {
        const text = await res.text();
        const redacted = this.redactSensitiveData(text);
        bodySnippet = typeof redacted === 'string' ? redacted.slice(0, 500) : JSON.stringify(redacted).slice(0, 500);
      } catch {
        bodySnippet = '[BODY_UNAVAILABLE]';
      }

      // Collect cookies metadata without raw sensitive values
      let cookiesMetadata: NetworkLogEntry['cookiesMetadata'] = [];
      try {
        const rawCookies = await context.cookies([targetUrl]);
        cookiesMetadata = rawCookies.map((c) => ({
          name: c.name,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        }));
      } catch {
        cookiesMetadata = [];
      }

      // Match with active log
      const existing = session.networkLogs.find((l) => l.url === res.url() && l.status === 0);
      if (existing) {
        existing.status = status;
        existing.durationMs = durationMs;
        existing.responseHeaders = this.redactHeaders(res.headers());
        existing.responseBodySnippet = bodySnippet;
        existing.cookiesMetadata = cookiesMetadata;

        wsBroadcast?.({
          type: 'NETWORK_RESPONSE',
          data: existing,
        });
      }
    });

    // Navigate to target
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait a brief moment for dynamic scripts to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // If network doesn't go fully idle within 5s, DOM is already ready
    }

    this.sessions.set(sessionId, session);

    // Inspect DOM
    const elements = await this.inspectDOM(sessionId);
    const screenshot = await this.captureScreenshot(sessionId);

    return { elements, screenshot };
  }

  // Inspect page DOM for form controls
  public async inspectDOM(sessionId: string): Promise<InteractiveElement[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const elementsData = await session.page.evaluate(() => {
      const items: any[] = [];
      const formControls = document.querySelectorAll('input, button, select, textarea, form');

      // Track per-tag counters so nth-of-type(n) is accurate
      const tagCounters = {} as Record<string, number>;
      let refCounter = 1;

      formControls.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();

        // Skip hidden elements that have zero dimensions
        if (rect.width === 0 && rect.height === 0) return;

        // Advance per-tag counter (counts this tag's occurrences in DOM order)
        tagCounters[tag] = (tagCounters[tag] || 0) + 1;
        const tagIndex = tagCounters[tag];

        let type = undefined;
        let placeholder = undefined;
        let name = el.getAttribute('name') || undefined;
        let id = el.getAttribute('id') || undefined;
        let label = undefined;
        let buttonText = undefined;

        if (el instanceof HTMLInputElement) {
          type = el.type;
          placeholder = el.placeholder || undefined;

          // Check for linked label
          if (id) {
            const lbl = document.querySelector(`label[for="${id}"]`);
            if (lbl) label = lbl.textContent?.trim();
          }
          if (!label && el.closest('label')) {
            label = el.closest('label')?.textContent?.trim();
          }
          if (!label) {
            label = el.getAttribute('aria-label') || undefined;
          }
        } else if (el instanceof HTMLButtonElement) {
          type = el.type || 'submit';
          buttonText = el.innerText?.trim() || el.textContent?.trim() || undefined;
          label = buttonText || el.getAttribute('aria-label') || undefined;
        }

        // Generate a robust CSS selector — priority order:
        //   id > name > placeholder > button text (:has-text) > accurate nth-of-type
        let selector = '';
        if (id) {
          // CSS-escape the id so special chars (dots, colons, spaces) don't break the selector
          const safeId = id.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
          selector = '#' + safeId;
        } else if (name) {
          selector = tag + '[name="' + name.replace(/["\\]/g, '\\$&') + '"]';
        } else if (placeholder) {
          selector = tag + '[placeholder="' + placeholder.replace(/["\\]/g, '\\$&') + '"]';
        } else if (tag === 'button' && buttonText) {
          // Playwright :has-text() works across reloads without positional fragility
          selector = 'button:has-text("' + buttonText.replace(/["\\]/g, '\\$&') + '")';
        } else {
          // Accurate nth-of-type: tagIndex counts only this tag, not all form controls
          selector = tag + ':nth-of-type(' + tagIndex + ')';
        }

        items.push({
          refId: `el-${refCounter++}`,
          tag,
          type,
          placeholder,
          name,
          id,
          label,
          selector,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      });

      return items;
    });

    session.elements = elementsData;
    return elementsData;
  }

  // Capture Screenshot as Base64 data URL
  public async captureScreenshot(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const buffer = await session.page.screenshot({ type: 'jpeg', quality: 80 });
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  // Execute Controlled Security Test Scenario
  public async executeTest(sessionId: string, config: TestScenarioConfig): Promise<TestResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const startTime = Date.now();
    const initialUrl = session.page.url();
    const initialCookies = await session.context.cookies([session.targetUrl]);
    const observations: SecurityObservation[] = [];
    const priorRequestsCount = session.networkLogs.length;

    session.wsBroadcast?.({
      type: 'TEST_PROGRESS',
      message: `Executing controlled test: ${config.scenario}`,
    });

    try {
      if (config.scenario === 'rate_limiting_probe') {
        // Safe, controlled rate-limiting probe (3 to 5 rapid attempts)
        const iterations = Math.min(Math.max(config.rateLimitIterations || 3, 2), 5);
        let rateLimitTriggered = false;
        let lastStatus = 200;

        for (let i = 1; i <= iterations; i++) {
          // Always reload the target URL before each probe so the form is in a clean state
          // (previous submission may have redirected or changed page DOM)
          await session.page.goto(session.targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          try {
            await session.page.waitForLoadState('networkidle', { timeout: 5000 });
          } catch {
            // Page is ready enough — continue
          }

          await this.fillAndSubmit(
            session.page,
            config.usernameSelector,
            config.passwordSelector,
            config.submitSelector,
            `probe_test_user_${i}@example-test.local`,
            `TestPass#${i}`
          );

          const delay = config.requestDelayMs ?? 300;
          await session.page.waitForTimeout(delay);

          // Check network logs for HTTP 429
          const recentLogs = session.networkLogs.slice(0, 3);
          const has429 = recentLogs.some((l) => l.status === 429);
          if (has429) {
            rateLimitTriggered = true;
            lastStatus = 429;
            break;
          }
        }

        if (rateLimitTriggered) {
          observations.push({
            type: 'success',
            title: 'Rate Limiting Active',
            description: 'The server successfully enforced rate limiting (HTTP 429 Too Many Requests) upon rapid submission attempts.',
          });
        } else {
          observations.push({
            type: 'warning',
            title: 'Rate Limiting Not Observed in Controlled Window',
            description: `${iterations} rapid submission attempts were executed without a 429 or noticeable challenge. Ensure backend enforces IP or account-level rate limiting.`,
            recommendation: 'Implement exponential backoff or CAPTCHA enforcement on repeated authentication failures.',
          });
        }

        const durationMs = Date.now() - startTime;
        const result: TestResult = {
          id: `test-${Date.now()}`,
          scenario: config.scenario,
          timestamp: new Date().toISOString(),
          status: rateLimitTriggered ? 'passed' : 'warning',
          durationMs,
          httpStatus: lastStatus,
          networkRequestsCount: session.networkLogs.length - priorRequestsCount,
          observations,
          urlAfterAction: session.page.url(),
          redirectOccurred: session.page.url() !== initialUrl,
          cookiesChanged: false,
        };

        session.testHistory.unshift(result);
        return result;
      }

      // Normal scenario execution
      let testUser = config.usernameValue || '';
      let testPass = config.passwordValue || '';

      switch (config.scenario) {
        case 'empty_credentials':
          testUser = '';
          testPass = '';
          break;
        case 'invalid_email_format':
          testUser = 'not-an-email-at-all';
          testPass = 'TestPass123!';
          break;
        case 'invalid_username':
          testUser = `audit_unregistered_${Date.now()}@testdomain.invalid`;
          testPass = 'StandardWrongPassword123!';
          break;
        case 'invalid_password':
          testUser = config.usernameValue || 'known_test_account@example.com';
          testPass = 'IncorrectTestPassword999#';
          break;
        case 'boundary_testing':
          testUser = 'A'.repeat(255) + '@domain.com';
          testPass = 'B'.repeat(128);
          break;
        case 'valid_login':
          // Authorized user provided explicit credentials; optionally generate a random password via Playwright
          testUser = config.usernameValue || '';
          if (config.useRandomPassword) {
            testPass = this.generateRandomPassword();
          } else {
            testPass = config.passwordValue || '';
          }
          break;
      }

      // Always navigate back to the target URL before filling — real-world pages
      // often redirect after submission (e.g. /login?error=...) which leaves the
      // DOM in a dirty state even when the URL looks the same.
      await session.page.goto(session.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      try {
        await session.page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // Page is ready enough — continue
      }

      await this.fillAndSubmit(
        session.page,
        config.usernameSelector,
        config.passwordSelector,
        config.submitSelector,
        testUser,
        testPass
      );

      // Wait for network response or navigation
      await session.page.waitForTimeout(1500);

      const finalUrl = session.page.url();
      const redirectOccurred = finalUrl !== initialUrl;
      const finalCookies = await session.context.cookies([session.targetUrl]);
      const cookiesChanged = finalCookies.length !== initialCookies.length;

      // Inspect visible page text for error or success cues
      const pageText = await session.page.evaluate(() => document.body.innerText.toLowerCase());

      const hasGenericError = pageText.includes('invalid credentials') || pageText.includes('incorrect username or password');
      const hasSpecificUserError = pageText.includes('user does not exist') || pageText.includes('email not registered');
      const hasLockoutWarning = pageText.includes('locked') || pageText.includes('too many attempts');

      if (config.scenario === 'invalid_username' && hasSpecificUserError) {
        observations.push({
          type: 'weakness',
          title: 'Potential Username Enumeration',
          description: 'The application explicitly indicated that the user does not exist. This permits adversaries to harvest registered email addresses.',
          recommendation: 'Use generic error messages such as "Invalid email or password" for all authentication failures.',
        });
      } else if (config.scenario === 'invalid_username' && hasGenericError) {
        observations.push({
          type: 'success',
          title: 'Protected Against Username Enumeration',
          description: 'The server provided a generic authentication error message, concealing whether the username exists.',
        });
      }

      if (hasLockoutWarning) {
        observations.push({
          type: 'info',
          title: 'Lockout / Restriction Notice Detected',
          description: 'The application displayed an account lockout or attempt limitation message.',
        });
      }

      // Check cookie security flags
      const insecureCookies = finalCookies.filter((c) => !c.secure || !c.httpOnly);
      if (insecureCookies.length > 0) {
        observations.push({
          type: 'warning',
          title: 'Insecure Cookie Flags Detected',
          description: `${insecureCookies.length} session/application cookies lack HttpOnly or Secure flags.`,
          recommendation: 'Ensure all authentication cookies set HttpOnly, Secure, and SameSite=Lax/Strict.',
        });
      } else if (finalCookies.length > 0) {
        observations.push({
          type: 'success',
          title: 'Cookie Security Flags Verified',
          description: 'All observed cookies enforce HttpOnly and Secure protection.',
        });
      }

      // Determine result status
      let status: 'passed' | 'failed' | 'warning' = 'passed';
      if (observations.some((o) => o.type === 'weakness')) {
        status = 'failed';
      } else if (observations.some((o) => o.type === 'warning')) {
        status = 'warning';
      }

      const durationMs = Date.now() - startTime;
      const latestReq = session.networkLogs[0];

      const testResult: TestResult = {
        id: `test-${Date.now()}`,
        scenario: config.scenario,
        timestamp: new Date().toISOString(),
        status,
        durationMs,
        httpStatus: latestReq ? latestReq.status : 200,
        networkRequestsCount: session.networkLogs.length - priorRequestsCount,
        serverMessage: latestReq?.responseBodySnippet?.slice(0, 150),
        observations,
        urlAfterAction: finalUrl,
        redirectOccurred,
        cookiesChanged,
      };

      session.testHistory.unshift(testResult);
      return testResult;
    } catch (err: any) {
      const errorResult: TestResult = {
        id: `test-${Date.now()}`,
        scenario: config.scenario,
        timestamp: new Date().toISOString(),
        status: 'warning',
        durationMs: Date.now() - startTime,
        httpStatus: 0,
        networkRequestsCount: 0,
        observations: [
          {
            type: 'warning',
            title: 'Action Timeout or Element Interaction Interrupted',
            description: err?.message || 'Element interaction timed out or element was not interactable.',
          },
        ],
        urlAfterAction: session.page.url(),
        redirectOccurred: false,
        cookiesChanged: false,
      };
      session.testHistory.unshift(errorResult);
      return errorResult;
    }
  }

  // Generate a cryptographically strong random password on the server side
  private generateRandomPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const symbols = '!@#$%^&*()-_=+[]{}|;:,.<>?';
    const all = upper + lower + digits + symbols;
    const { randomBytes } = require('crypto');
    const buf: Buffer = randomBytes(16);
    // Guarantee at least one character from each class
    const pick = (charset: string, byte: number) => charset[byte % charset.length];
    const required = [
      pick(upper, buf[0]),
      pick(lower, buf[1]),
      pick(digits, buf[2]),
      pick(symbols, buf[3]),
    ];
    const rest = Array.from(buf.slice(4), (b: number) => pick(all, b));
    const combined = [...required, ...rest];
    // Fisher-Yates shuffle using the random bytes
    for (let i = combined.length - 1; i > 0; i--) {
      const j = buf[i % buf.length] % (i + 1);
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    return combined.join('');
  }

  // Safe element fill and submit helper
  private async fillAndSubmit(
    page: Page,
    userSel: string,
    passSel: string,
    submitSel: string,
    username: string,
    pass: string
  ) {
    if (userSel) {
      const loc = page.locator(userSel).first();
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      await loc.fill(username);
    }
    if (passSel) {
      const loc = page.locator(passSel).first();
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      await loc.fill(pass);
    }
    if (submitSel) {
      const loc = page.locator(submitSel).first();
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      await loc.click();
      // Wait for the network request to complete before the caller checks logs
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // Form submitted — page may still be processing
      }
    }
  }

  // Generate Report
  public generateReport(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const total = session.testHistory.length;
    const passed = session.testHistory.filter((t) => t.status === 'passed').length;
    const failed = session.testHistory.filter((t) => t.status === 'failed').length;
    const warning = session.testHistory.filter((t) => t.status === 'warning').length;

    const allObservations: SecurityObservation[] = [];
    session.testHistory.forEach((t) => allObservations.push(...t.observations));

    return {
      sessionId,
      targetUrl: session.targetUrl,
      testedAt: new Date().toISOString(),
      totalTests: total,
      passedCount: passed,
      failedCount: failed,
      warningCount: warning,
      findings: allObservations,
      testResults: session.testHistory,
      auditSummary: {
        rateLimitingEnforced: allObservations.some((o) => o.title.includes('Rate Limiting Active')),
        usernameEnumerationRisk: allObservations.some((o) => o.title.includes('Potential Username Enumeration'))
          ? 'high'
          : 'low',
        sessionCookieFlagsSecured: !allObservations.some((o) => o.title.includes('Insecure Cookie Flags')),
        credentialRedactionActive: true,
      },
    };
  }

  // Terminate session
  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.browser.close();
      } catch {
        // browser may already be closed
      }
      this.sessions.delete(sessionId);
    }
  }

  public getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }
}

export const playwrightService = new PlaywrightService();
