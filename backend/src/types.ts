export interface InteractiveElement {
  refId: string;
  tag: string;
  type?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  label?: string;
  selector: string;
  formId?: string;
  value?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface NetworkLogEntry {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  status: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  requestPayload?: any;
  responseHeaders: Record<string, string>;
  responseBodySnippet?: string;
  cookiesMetadata: {
    name: string;
    domain?: string;
    path?: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
  }[];
}

export type TestScenarioType =
  | 'valid_login'
  | 'invalid_username'
  | 'invalid_password'
  | 'empty_credentials'
  | 'invalid_email_format'
  | 'boundary_testing'
  | 'rate_limiting_probe';

export interface TestScenarioConfig {
  scenario: TestScenarioType;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  usernameValue?: string;
  passwordValue?: string;
  useRandomPassword?: boolean;
  requestDelayMs?: number;
  rateLimitIterations?: number;
}

export interface SecurityObservation {
  type: 'info' | 'warning' | 'weakness' | 'success';
  title: string;
  description: string;
  recommendation?: string;
}

export interface TestResult {
  id: string;
  scenario: TestScenarioType;
  timestamp: string;
  status: 'passed' | 'failed' | 'warning';
  durationMs: number;
  httpStatus?: number;
  networkRequestsCount: number;
  serverMessage?: string;
  observations: SecurityObservation[];
  urlAfterAction: string;
  redirectOccurred: boolean;
  cookiesChanged: boolean;
}

export interface SecurityReport {
  sessionId: string;
  targetUrl: string;
  testedAt: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
  findings: SecurityObservation[];
  testResults: TestResult[];
  auditSummary: {
    rateLimitingEnforced: boolean | 'inconclusive';
    usernameEnumerationRisk: 'low' | 'medium' | 'high' | 'inconclusive';
    sessionCookieFlagsSecured: boolean;
    credentialRedactionActive: boolean;
  };
}
