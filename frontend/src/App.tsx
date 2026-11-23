import { useState, useEffect, useRef } from 'react'
import { InteractiveElement, NetworkLogEntry, TestScenarioType, TestResult, SecurityReport } from './types'

const API_BASE = 'http://localhost:5000/api'
const WS_BASE = 'ws://localhost:5000/ws'

export default function App() {
  // Session State
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [targetUrl, setTargetUrl] = useState('http://localhost:5000/demo-login')
  const [authorized, setAuthorized] = useState(false)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [elements, setElements] = useState<InteractiveElement[]>([])

  // Element Selectors Mapping
  const [usernameSelector, setUsernameSelector] = useState('')
  const [passwordSelector, setPasswordSelector] = useState('')
  const [submitSelector, setSubmitSelector] = useState('')

  // Testing State
  const [selectedScenario, setSelectedScenario] = useState<TestScenarioType>('rate_limiting_probe')
  const [customUsername, setCustomUsername] = useState('')
  const [customPassword, setCustomPassword] = useState('')
  const [rateLimitIterations, setRateLimitIterations] = useState(4)
  const [requestDelayMs, setRequestDelayMs] = useState(300)
  const [isTesting, setIsTesting] = useState(false)
  const [testResults, setTestResults] = useState<TestResult[]>([])

  // Network & Logs
  const [networkLogs, setNetworkLogs] = useState<NetworkLogEntry[]>([])
  const [selectedNetworkLog, setSelectedNetworkLog] = useState<NetworkLogEntry | null>(null)

  // Report & Navigation Tabs
  const [activeTab, setActiveTab] = useState<'dom' | 'tests' | 'network' | 'report'>('dom')
  const [report, setReport] = useState<SecurityReport | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Connect WebSocket
    const ws = new WebSocket(WS_BASE)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'NETWORK_REQUEST') {
          setNetworkLogs((prev) => [message.data, ...prev.slice(0, 99)])
        } else if (message.type === 'NETWORK_RESPONSE') {
          setNetworkLogs((prev) =>
            prev.map((log) => (log.id === message.data.id || (log.url === message.data.url && log.status === 0) ? message.data : log))
          )
        } else if (message.type === 'TEST_COMPLETED') {
          setTestResults((prev) => [message.data, ...prev])
        }
      } catch (e) {
        console.error('Error parsing WS message', e)
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  // Start Testing Session
  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUrl.trim() || !authorized) return

    try {
      setIsStartingSession(true)
      const res = await fetch(`${API_BASE}/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, authorized }),
      })

      const data = await res.json()
      if (res.ok) {
        setSessionId(data.sessionId)
        setElements(data.elements || [])
        setScreenshot(data.screenshot || null)
        setActiveTab('dom')

        // Auto-detect common fields
        const emailEl = data.elements.find((el: InteractiveElement) =>
          el.type === 'email' || el.name?.includes('email') || el.id?.includes('email')
        )
        const userEl = data.elements.find((el: InteractiveElement) =>
          el.name?.includes('user') || el.id?.includes('user') || el.type === 'text'
        )
        const passEl = data.elements.find((el: InteractiveElement) =>
          el.type === 'password' || el.name?.includes('pass') || el.id?.includes('pass')
        )
        const submitEl = data.elements.find((el: InteractiveElement) =>
          el.type === 'submit' || el.tag === 'button'
        )

        if (emailEl) setUsernameSelector(emailEl.selector)
        else if (userEl) setUsernameSelector(userEl.selector)

        if (passEl) setPasswordSelector(passEl.selector)
        if (submitEl) setSubmitSelector(submitEl.selector)
      } else {
        alert(data.message || data.error || 'Failed to start session')
      }
    } catch (err: any) {
      alert(`Connection failed: ${err.message}`)
    } finally {
      setIsStartingSession(false)
    }
  }

  // Terminate Session
  const handleTerminateSession = async () => {
    if (!sessionId) return
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' })
      setSessionId(null)
      setElements([])
      setScreenshot(null)
      setTestResults([])
      setNetworkLogs([])
      setReport(null)
    } catch (err) {
      console.error(err)
    }
  }

  // Refresh DOM inspection
  const handleRefreshDOM = async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/inspect`)
      const data = await res.json()
      if (res.ok) {
        setElements(data.elements)
        setScreenshot(data.screenshot)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Execute Security Test
  const handleRunTest = async () => {
    if (!sessionId || !usernameSelector || !passwordSelector || !submitSelector) {
      alert('Please assign Username/Email, Password, and Submit button selectors first in the DOM tab.')
      return
    }

    try {
      setIsTesting(true)
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: selectedScenario,
          usernameSelector,
          passwordSelector,
          submitSelector,
          usernameValue: customUsername,
          passwordValue: customPassword,
          requestDelayMs,
          rateLimitIterations,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setTestResults((prev) => [data.result, ...prev.filter((r) => r.id !== data.result.id)])
        if (data.screenshot) setScreenshot(data.screenshot)
        setActiveTab('tests')
      } else {
        alert(data.message || data.error || 'Test failed')
      }
    } catch (err: any) {
      alert(`Test error: ${err.message}`)
    } finally {
      setIsTesting(false)
    }
  }

  // Fetch Report
  const handleFetchReport = async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/report`)
      const data = await res.json()
      if (res.ok) {
        setReport(data.report)
        setActiveTab('report')
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Export report as JSON file
  const handleExportJSON = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `securitier-audit-report-${sessionId}.json`
    a.click()
  }

  // Export report as Markdown file
  const handleExportMarkdown = () => {
    if (!report) return
    const md = `# Securitier Web Security Audit Report
Target URL: ${report.targetUrl}
Session ID: ${report.sessionId}
Audit Timestamp: ${report.testedAt}

## Executive Summary
- Total Tests Executed: ${report.totalTests}
- Passed: ${report.passedCount}
- Warnings: ${report.warningCount}
- Weaknesses Identified: ${report.failedCount}

## Security Posture
- Rate Limiting Enforced: ${report.auditSummary.rateLimitingEnforced}
- Username Enumeration Risk: ${report.auditSummary.usernameEnumerationRisk.toUpperCase()}
- Session Cookie Security Flags: ${report.auditSummary.sessionCookieFlagsSecured ? 'SECURED' : 'NEEDS ATTENTION'}
- Sensitive Credential Redaction: ACTIVE

## Key Findings & Observations
${report.findings
  .map(
    (f, idx) => `### ${idx + 1}. [${f.type.toUpperCase()}] ${f.title}
${f.description}
${f.recommendation ? `*Recommendation:* ${f.recommendation}\n` : ''}`
  )
  .join('\n')}

## Test Execution History
${report.testResults
  .map(
    (r) => `- **${r.scenario}** | Status: ${r.status} | Duration: ${r.durationMs}ms | HTTP Status: ${r.httpStatus || 200}`
  )
  .join('\n')}
`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `securitier-audit-report-${sessionId}.md`
    a.click()
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center font-bold text-slate-950 shadow-md shadow-sky-500/20">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-wide">Securitier</h1>
              <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded font-mono uppercase">
                Playwright Agent
              </span>
            </div>
            <p className="text-xs text-slate-400">Defensive Web Security & Form Authentication Auditor</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-400 hidden sm:inline">{wsConnected ? 'WebSocket Live' : 'Offline'}</span>
          </div>

          {sessionId && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefreshDOM}
                className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
              >
                Re-inspect DOM
              </button>
              <button
                onClick={handleTerminateSession}
                className="px-3 py-1.5 text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-md transition"
              >
                Close Session
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      {!sessionId ? (
        /* Initialization Screen */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <span>Controlled Authentication Audit</span>
              </div>
              <h2 className="text-2xl font-bold text-white">Initialize Security Testing Session</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Configure Playwright to inspect authentication endpoints, evaluate rate-limiting behavior, detect
                username enumeration, and monitor API transactions with sensitive credential redaction.
              </p>
            </div>

            <form onSubmit={handleStartSession} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Target Website URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    required
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://example.com/login"
                    className="flex-1 px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500 transition font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setTargetUrl('http://localhost:5000/demo-login')}
                    className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                  >
                    Use Built-in Demo
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Tip: The built-in target tests rate-limiting, error responses, and session cookies locally on port 5000.
                </p>
              </div>

              {/* Authorization Confirmation Gate */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-amber-500/20 space-y-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="authCheck"
                    checked={authorized}
                    onChange={(e) => setAuthorized(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-700 text-sky-600 focus:ring-sky-500 cursor-pointer"
                  />
                  <label htmlFor="authCheck" className="text-xs text-slate-300 leading-normal cursor-pointer">
                    <strong className="text-amber-400">Authorization Declaration:</strong> I confirm that I own this application
                    or have explicit, authorized permission to perform security testing against this target.
                  </label>
                </div>
                <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
                  🛡️ <strong>Safety Guarantee:</strong> All password inputs and authentication tokens are automatically redacted
                  from logs. Uncontrolled brute-force attacks are disabled.
                </div>
              </div>

              <button
                type="submit"
                disabled={isStartingSession || !authorized || !targetUrl.trim()}
                className="w-full py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-lg text-sm transition shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isStartingSession ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Launching Playwright Browser & Inspecting DOM...
                  </>
                ) : (
                  'Launch Playwright Session'
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Active Session Workspace */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sub Navigation Bar */}
          <div className="border-b border-slate-800 bg-slate-900 px-6 py-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('dom')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                  activeTab === 'dom'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                DOM & Elements ({elements.length})
              </button>
              <button
                onClick={() => setActiveTab('tests')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                  activeTab === 'tests'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Security Test Suites ({testResults.length})
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                  activeTab === 'network'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Network API Monitor ({networkLogs.length})
              </button>
              <button
                onClick={() => {
                  handleFetchReport()
                  setActiveTab('report')
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                  activeTab === 'report'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Audit Report
              </button>
            </div>

            <div className="text-xs text-slate-400 truncate max-w-sm font-mono">
              <span className="text-slate-500">Target:</span> {targetUrl}
            </div>
          </div>

          {/* Main Tab Panels */}
          <div className="flex-1 overflow-auto p-6">
            {/* TAB 1: DOM Elements & Interactive Browser Viewport */}
            {activeTab === 'dom' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Element Inspector List */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-1">Discovered Interactive Elements</h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Map the target form elements using reference IDs. These selectors are used by the test runner.
                    </p>

                    {/* Quick Selected Mappings */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">
                          Username / Email Field:
                        </span>
                        <span className={usernameSelector ? 'text-sky-400' : 'text-slate-600 italic'}>
                          {usernameSelector || 'Not selected'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">
                          Password Field:
                        </span>
                        <span className={passwordSelector ? 'text-sky-400' : 'text-slate-600 italic'}>
                          {passwordSelector || 'Not selected'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">
                          Submit Button:
                        </span>
                        <span className={submitSelector ? 'text-emerald-400' : 'text-slate-600 italic'}>
                          {submitSelector || 'Not selected'}
                        </span>
                      </div>
                    </div>

                    {/* Elements Table */}
                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                      {elements.map((el) => {
                        const isUsername = usernameSelector === el.selector
                        const isPassword = passwordSelector === el.selector
                        const isSubmit = submitSelector === el.selector

                        return (
                          <div
                            key={el.refId}
                            className={`p-3 rounded-lg border transition ${
                              isUsername || isPassword || isSubmit
                                ? 'bg-sky-950/20 border-sky-500/40'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">
                                    {el.refId}
                                  </span>
                                  <span className="text-xs font-bold text-slate-200">
                                    &lt;{el.tag} {el.type ? `type="${el.type}"` : ''}&gt;
                                  </span>
                                  {el.label && (
                                    <span className="text-xs text-slate-400 italic">"{el.label}"</span>
                                  )}
                                </div>
                                <p className="text-xs font-mono text-slate-500 truncate max-w-md">
                                  Selector: <span className="text-slate-300">{el.selector}</span>
                                </p>
                                {(el.name || el.id || el.placeholder) && (
                                  <div className="flex gap-2 text-[10px] text-slate-400">
                                    {el.id && <span>id: <strong className="text-slate-300">{el.id}</strong></span>}
                                    {el.name && <span>name: <strong className="text-slate-300">{el.name}</strong></span>}
                                    {el.placeholder && <span>placeholder: <strong className="text-slate-300">{el.placeholder}</strong></span>}
                                  </div>
                                )}
                              </div>

                              {/* Mapping Buttons */}
                              <div className="flex items-center gap-1 text-[11px]">
                                <button
                                  onClick={() => setUsernameSelector(el.selector)}
                                  className={`px-2 py-1 rounded transition border ${
                                    isUsername
                                      ? 'bg-sky-500 text-slate-950 font-bold border-sky-400'
                                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                  }`}
                                >
                                  Email/User
                                </button>
                                <button
                                  onClick={() => setPasswordSelector(el.selector)}
                                  className={`px-2 py-1 rounded transition border ${
                                    isPassword
                                      ? 'bg-sky-500 text-slate-950 font-bold border-sky-400'
                                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                  }`}
                                >
                                  Password
                                </button>
                                <button
                                  onClick={() => setSubmitSelector(el.selector)}
                                  className={`px-2 py-1 rounded transition border ${
                                    isSubmit
                                      ? 'bg-emerald-500 text-slate-950 font-bold border-emerald-400'
                                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                  }`}
                                >
                                  Submit
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Live Page Preview Screenshot */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white">Browser Viewport</h3>
                      <span className="text-[10px] text-emerald-400 font-mono">1280x800 Render</span>
                    </div>

                    {screenshot ? (
                      <div className="rounded-lg overflow-hidden border border-slate-800 shadow-inner bg-slate-950">
                        <img
                          src={screenshot}
                          alt="Rendered page in Playwright"
                          className="w-full h-auto object-contain"
                        />
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center bg-slate-950 rounded-lg text-xs text-slate-500">
                        No screenshot captured
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
                      <button
                        onClick={() => setActiveTab('tests')}
                        className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition"
                      >
                        Proceed to Test Suite →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Controlled Security Test Scenarios */}
            {activeTab === 'tests' && (
              <div className="space-y-6 max-w-5xl mx-auto">
                {/* Test Launcher Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <h3 className="text-base font-bold text-white">Authentication Test Suites</h3>
                      <p className="text-xs text-slate-400">
                        Run controlled assertions to evaluate rate-limiting enforcement, lockout triggers, and enumeration risks.
                      </p>
                    </div>

                    <button
                      onClick={handleRunTest}
                      disabled={isTesting || !usernameSelector || !passwordSelector || !submitSelector}
                      className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold rounded-lg text-xs transition shadow-md shadow-sky-500/20 cursor-pointer"
                    >
                      {isTesting ? 'Running Controlled Test...' : 'Execute Selected Test'}
                    </button>
                  </div>

                  {/* Scenarios Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      {
                        id: 'rate_limiting_probe',
                        title: 'Rate-Limiting & Lockout Check',
                        desc: 'Sends 3-5 controlled rapid attempts to observe 429 status code or challenge prompts.',
                      },
                      {
                        id: 'invalid_username',
                        title: 'Username Enumeration Test',
                        desc: 'Tests unregistered user account to verify if server responds with generic or distinguishable errors.',
                      },
                      {
                        id: 'invalid_password',
                        title: 'Invalid Password Error Check',
                        desc: 'Evaluates authentication failure response format, HTTP status, and timing consistency.',
                      },
                      {
                        id: 'empty_credentials',
                        title: 'Empty Field Validation',
                        desc: 'Submits empty inputs to test client-side HTML5 & server-side validation completeness.',
                      },
                      {
                        id: 'invalid_email_format',
                        title: 'Malformed Email Format',
                        desc: 'Injects invalid email string to verify regex and boundary validation.',
                      },
                      {
                        id: 'valid_login',
                        title: 'Verified Test Account Verification',
                        desc: 'Runs authorized test credentials to inspect session cookies, HttpOnly, and Secure flags.',
                      },
                    ].map((s) => (
                      <div
                        key={s.id}
                        onClick={() => setSelectedScenario(s.id as TestScenarioType)}
                        className={`p-3.5 rounded-lg border cursor-pointer transition ${
                          selectedScenario === s.id
                            ? 'bg-sky-950/40 border-sky-500/60 shadow-sm'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-xs font-semibold text-white">{s.title}</h4>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              selectedScenario === s.id ? 'bg-sky-400' : 'bg-slate-700'
                            }`}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{s.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Scenario Parameters */}
                  {selectedScenario === 'valid_login' && (
                    <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-3">
                      <h4 className="text-xs font-semibold text-slate-300">Authorized Test Credentials</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="Test Email / Username (e.g. admin@example.com)"
                          value={customUsername}
                          onChange={(e) => setCustomUsername(e.target.value)}
                          className="px-3 py-2 rounded bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                        <input
                          type="password"
                          placeholder="Test Password (e.g. ValidSecurePass2026!)"
                          value={customPassword}
                          onChange={(e) => setCustomPassword(e.target.value)}
                          className="px-3 py-2 rounded bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}

                  {selectedScenario === 'rate_limiting_probe' && (
                    <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-6 text-xs">
                      <div className="flex items-center gap-2">
                        <label className="text-slate-400">Rapid Probe Attempts (Max 5):</label>
                        <input
                          type="number"
                          min={2}
                          max={5}
                          value={rateLimitIterations}
                          onChange={(e) => setRateLimitIterations(Number(e.target.value))}
                          className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-white text-center font-mono"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-slate-400">Delay between probes (ms):</label>
                        <input
                          type="number"
                          min={100}
                          max={2000}
                          step={100}
                          value={requestDelayMs}
                          onChange={(e) => setRequestDelayMs(Number(e.target.value))}
                          className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-white text-center font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Test Results Feed */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Execution Observations & Findings</h3>
                  {testResults.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 bg-slate-900 border border-slate-800 rounded-xl">
                      No tests executed in this session yet. Select a scenario above and click "Execute Selected Test".
                    </div>
                  ) : (
                    testResults.map((res) => (
                      <div
                        key={res.id}
                        className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                res.status === 'passed'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : res.status === 'failed'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}
                            >
                              {res.status}
                            </span>
                            <span className="text-xs font-bold text-white uppercase tracking-wider">
                              {res.scenario.replace(/_/g, ' ')}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-3">
                            <span>Status: {res.httpStatus || 200}</span>
                            <span>Duration: {res.durationMs}ms</span>
                            <span>{new Date(res.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>

                        {/* Observations List */}
                        <div className="space-y-2">
                          {res.observations.map((obs, idx) => (
                            <div
                              key={idx}
                              className={`p-3 rounded-lg border text-xs space-y-1 ${
                                obs.type === 'weakness'
                                  ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
                                  : obs.type === 'warning'
                                  ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                                  : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                              }`}
                            >
                              <div className="font-semibold">{obs.title}</div>
                              <p className="text-[11px] opacity-90">{obs.description}</p>
                              {obs.recommendation && (
                                <p className="text-[11px] text-slate-300 font-mono mt-1 pt-1 border-t border-slate-800/60">
                                  💡 <strong>Fix:</strong> {obs.recommendation}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Network API Monitor */}
            {activeTab === 'network' && (
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Live Network & API Activity</h3>
                      <p className="text-xs text-slate-400">
                        Monitors HTTP traffic triggered by Playwright actions. Sensitive data & credentials are automatically redacted.
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{networkLogs.length} requests captured</span>
                  </div>

                  <div className="divide-y divide-slate-800 max-h-[550px] overflow-y-auto font-mono text-xs">
                    {networkLogs.length === 0 ? (
                      <div className="p-8 text-center text-slate-500">No network traffic recorded yet.</div>
                    ) : (
                      networkLogs.map((log) => (
                        <div
                          key={log.id}
                          onClick={() => setSelectedNetworkLog(log)}
                          className={`p-3.5 flex items-center justify-between gap-4 cursor-pointer transition ${
                            selectedNetworkLog?.id === log.id ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center gap-3 truncate max-w-xl">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                log.method === 'POST'
                                  ? 'bg-sky-500/20 text-sky-400'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {log.method}
                            </span>
                            <span
                              className={`text-[11px] font-bold ${
                                log.status >= 200 && log.status < 300
                                  ? 'text-emerald-400'
                                  : log.status === 429
                                  ? 'text-amber-400'
                                  : log.status >= 400
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {log.status || '...'}
                            </span>
                            <span className="text-slate-300 truncate">{log.url}</span>
                          </div>

                          <div className="flex items-center gap-4 text-slate-500 text-[11px] shrink-0">
                            <span>{log.durationMs}ms</span>
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Selected Log Detail Drawer */}
                {selectedNetworkLog && (
                  <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div>
                        <h4 className="text-sm font-bold text-white">Inspected Request & Response Details</h4>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedNetworkLog.url}</p>
                      </div>
                      <button
                        onClick={() => setSelectedNetworkLog(null)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                      {/* Request Info */}
                      <div className="space-y-2">
                        <span className="text-slate-400 font-sans font-semibold uppercase text-[10px]">
                          Request Payload (Redacted):
                        </span>
                        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-slate-300">
                          {JSON.stringify(selectedNetworkLog.requestPayload || 'No payload', null, 2)}
                        </pre>

                        <span className="text-slate-400 font-sans font-semibold uppercase text-[10px]">
                          Request Headers:
                        </span>
                        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-slate-300 max-h-36">
                          {JSON.stringify(selectedNetworkLog.requestHeaders, null, 2)}
                        </pre>
                      </div>

                      {/* Response Info */}
                      <div className="space-y-2">
                        <span className="text-slate-400 font-sans font-semibold uppercase text-[10px]">
                          Response Body (Redacted Preview):
                        </span>
                        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-slate-300">
                          {selectedNetworkLog.responseBodySnippet || 'No response body'}
                        </pre>

                        <span className="text-slate-400 font-sans font-semibold uppercase text-[10px]">
                          Cookies Metadata ({selectedNetworkLog.cookiesMetadata?.length || 0}):
                        </span>
                        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto text-slate-300 max-h-36">
                          {selectedNetworkLog.cookiesMetadata?.length ? (
                            selectedNetworkLog.cookiesMetadata.map((c, i) => (
                              <div key={i} className="mb-1 text-[11px]">
                                <strong className="text-sky-400">{c.name}</strong> [HttpOnly: {c.httpOnly ? 'Yes' : 'No'} | Secure: {c.secure ? 'Yes' : 'No'}]
                              </div>
                            ))
                          ) : (
                            <span className="text-slate-500">No cookies modified or observed</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Security Audit Report */}
            {activeTab === 'report' && (
              <div className="max-w-4xl mx-auto space-y-6">
                {report ? (
                  <>
                    {/* Header with Export Buttons */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-xl">
                      <div>
                        <h3 className="text-base font-bold text-white">Security Evaluation Summary</h3>
                        <p className="text-xs text-slate-400">
                          Target: <span className="font-mono text-slate-300">{report.targetUrl}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleExportJSON}
                          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition"
                        >
                          Export JSON
                        </button>
                        <button
                          onClick={handleExportMarkdown}
                          className="px-3.5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-semibold transition shadow-md shadow-sky-500/20"
                        >
                          Export Markdown Report
                        </button>
                      </div>
                    </div>

                    {/* Metric Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center">
                        <div className="text-2xl font-bold text-white">{report.totalTests}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">Total Tests</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center">
                        <div className="text-2xl font-bold text-emerald-400">{report.passedCount}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">Passed</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center">
                        <div className="text-2xl font-bold text-amber-400">{report.warningCount}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">Warnings</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center">
                        <div className="text-2xl font-bold text-rose-400">{report.failedCount}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">Weaknesses</div>
                      </div>
                    </div>

                    {/* Posture Checklist */}
                    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Core Authentication Posture
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <span className="text-slate-300">Rate Limiting Enforced</span>
                          <span
                            className={`font-semibold ${
                              report.auditSummary.rateLimitingEnforced === true
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {report.auditSummary.rateLimitingEnforced ? 'Detected (429)' : 'Inconclusive / Not Observed'}
                          </span>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <span className="text-slate-300">Username Enumeration Risk</span>
                          <span
                            className={`font-semibold uppercase ${
                              report.auditSummary.usernameEnumerationRisk === 'high'
                                ? 'text-rose-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {report.auditSummary.usernameEnumerationRisk}
                          </span>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <span className="text-slate-300">Cookie Security Flags</span>
                          <span
                            className={`font-semibold ${
                              report.auditSummary.sessionCookieFlagsSecured
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {report.auditSummary.sessionCookieFlagsSecured ? 'Secured (HttpOnly/Secure)' : 'Review Needed'}
                          </span>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <span className="text-slate-300">Credential Redaction Active</span>
                          <span className="text-emerald-400 font-semibold">100% Redacted</span>
                        </div>
                      </div>
                    </div>

                    {/* Detailed Findings */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Consolidated Findings & Recommendations
                      </h4>
                      {report.findings.map((f, i) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                            f.type === 'weakness'
                              ? 'bg-rose-950/20 border-rose-500/30'
                              : f.type === 'warning'
                              ? 'bg-amber-950/20 border-amber-500/30'
                              : 'bg-emerald-950/20 border-emerald-500/30'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white text-sm">{f.title}</span>
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                              {f.type}
                            </span>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">{f.description}</p>
                          {f.recommendation && (
                            <div className="pt-2 mt-2 border-t border-slate-800/80 text-[11px] text-sky-400 font-mono">
                              Recommended Fix: {f.recommendation}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400 mb-3">No report generated yet.</p>
                    <button
                      onClick={handleFetchReport}
                      className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition"
                    >
                      Generate Report Now
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
