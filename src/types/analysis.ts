export type RiskSeverity = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  id: string;
  score: number;
  reason: string;
  severity: RiskSeverity;
  category: 'security' | 'legitimacy' | 'dark-pattern' | 'policy';
  source: 'heuristic' | 'ai';
  details?: string;
  pattern?: 'false_urgency' | 'forced_continuity' | 'hidden_costs' | 'trick_questions' | 'confirmshaming' | 'bait_switch' | 'social_proof_manipulation' | 'other';
  textSnippet?: string;
  elementType?: 'button' | 'timer' | 'form' | 'text' | 'image' | 'other';
  context?: string;
}

export interface SecurityAnalysis {
  isHttps: boolean;
  hasMixedContent: boolean;
  hasValidCertificate: boolean;
  signals: RiskSignal[];
}

export interface DomainAnalysis {
  domain: string;
  ageInDays: number | null;
  registrar: string | null;
  isSuspicious: boolean;
  signals: RiskSignal[];
  creationDate?: string | null;
  expirationDate?: string | null;
  updatedDate?: string | null;
  dnssec?: string | null;
  nameServers?: string[] | null;
  registrantEmail?: string | null;
  status?: string[] | null;
  whoisServer?: string | null;
}

export interface SocialMediaProfile {
  platform: string;
  url: string;
  location: 'footer' | 'header' | 'body' | 'unknown';
  isValid?: boolean;
  validationError?: string;
  validatedAt?: number;
}

export interface ContactAnalysis {
  hasContactPage: boolean;
  hasPhoneNumber: boolean;
  hasPhysicalAddress: boolean;
  hasEmail: boolean;
  socialMediaLinks: string[];
  socialMediaProfiles: SocialMediaProfile[];
  signals: RiskSignal[];
  socialProofAudit?: {
    totalProfiles: number;
    validProfiles: number;
    invalidProfiles: number;
    validationRate: number;
    lastValidatedAt: number;
  };
}

export interface PolicyAnalysis {
  hasReturnRefundPolicy: boolean;
  hasShippingPolicy: boolean;
  hasTermsOfService: boolean;
  hasPrivacyPolicy: boolean;
  policyUrls: {
    returnRefund?: string;
    shipping?: string;
    terms?: string;
    privacy?: string;
  };
  signals: RiskSignal[];
}

export interface PaymentAnalysis {
  acceptedMethods: string[];
  hasReversibleMethods: boolean;
  hasIrreversibleOnly: boolean;
  signals: RiskSignal[];
}

export interface DarkPattern {
  type: 'timer' | 'low-stock' | 'confirmshaming' | 'trick-question' | 'misdirection' | 'other';
  selector: string;
  description: string;
  severity: RiskSeverity;
  confidence: number;
}

export interface AIAnalysis {
  darkPatterns: DarkPattern[];
  overallSentiment: 'trustworthy' | 'neutral' | 'suspicious' | 'scam';
  redFlags: string[];
  signals: RiskSignal[];
  rawResponse?: any;
}

export interface PageTypeResult {
  type: 'home' | 'product' | 'category' | 'checkout' | 'cart' | 'policy' | 'other';
  confidence: number;
  signals: string[];
}

export interface AnalysisResult {
  url: string;
  timestamp: number;
  pageType: string;
  pageTypeConfidence?: number;
  security: SecurityAnalysis;
  domain: DomainAnalysis;
  contact: ContactAnalysis;
  policies: PolicyAnalysis;
  payment: PaymentAnalysis;
  ai?: AIAnalysis;
  totalRiskScore: number;
  riskLevel: RiskSeverity;
  allSignals: RiskSignal[];
  riskBreakdown?: any;
  topConcerns?: RiskSignal[];
  analysisVersion: string;
  isEcommerceSite: boolean;
  aiEnabled?: boolean;
  aiSignalsCount?: number;
  elements?: AnnotationElement[];
  status?: 'success' | 'error' | 'in_progress';
  error?: string;
}

export interface PolicySummary {
  policyType: 'returnRefund' | 'shipping' | 'terms';
  url: string;
  language: string;
  wasTranslated: boolean;
  summary: string[];
  keyPoints: {
    returnWindow?: string;
    cost?: string;
    conditions?: string[];
  };
  timestamp: number;
}

export function getRiskLevel(score: number): RiskSeverity {
  if (score >= 76) return 'critical';
  if (score >= 51) return 'high';
  if (score >= 26) return 'medium';
  if (score >= 1) return 'low';
  return 'safe';
}

export function getRiskColor(level: RiskSeverity): string {
  const colors = {
    safe: '#10b981',
    low: '#84cc16',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
  };
  return colors[level];
}

export interface AnnotationElement {
  pattern: 'false_urgency' | 'forced_continuity' | 'hidden_costs' | 'trick_questions' | 'confirmshaming' | 'bait_switch' | 'social_proof_manipulation' | 'other';
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  textSnippet?: string;
  elementType?: 'button' | 'timer' | 'form' | 'text' | 'image' | 'other';
  context?: string;
  selector: string;
}
