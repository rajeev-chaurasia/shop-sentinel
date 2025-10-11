export type RiskSeverity = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  id: string;
  score: number;
  reason: string;
  severity: RiskSeverity;
  category: 'security' | 'legitimacy' | 'dark-pattern' | 'policy';
  source: 'heuristic' | 'ai';
  details?: string;
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
  // Additional WHOIS data for AI context (from apilayer.com API)
  creationDate?: string | null;
  expirationDate?: string | null;
  updatedDate?: string | null;
  dnssec?: string | null;
  nameServers?: string[] | null;
  registrantEmail?: string | null;
  status?: string[] | null; // Domain status codes (important for trust)
  whoisServer?: string | null;
}

export interface SocialMediaProfile {
  platform: string;
  url: string;
  location: 'footer' | 'header' | 'body' | 'unknown';
}

export interface ContactAnalysis {
  hasContactPage: boolean;
  hasPhoneNumber: boolean;
  hasPhysicalAddress: boolean;
  hasEmail: boolean;
  socialMediaLinks: string[]; // Kept for backward compatibility
  socialMediaProfiles: SocialMediaProfile[]; // Enhanced structured data
  signals: RiskSignal[];
}

export interface PolicyAnalysis {
  hasReturnPolicy: boolean;
  hasShippingPolicy: boolean;
  hasRefundPolicy: boolean;
  hasTermsOfService: boolean;
  hasPrivacyPolicy: boolean;
  policyUrls: {
    returns?: string;
    shipping?: string;
    refund?: string;
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

export interface AnalysisResult {
  url: string;
  timestamp: number;
  pageType?: string; // Page type detected (home, product, checkout, etc.)
  security: SecurityAnalysis;
  domain: DomainAnalysis;
  contact: ContactAnalysis;
  policies: PolicyAnalysis;
  payment: PaymentAnalysis;
  ai?: AIAnalysis;
  totalRiskScore: number;
  riskLevel: RiskSeverity;
  allSignals: RiskSignal[];
  analysisVersion: string;
  isEcommerceSite: boolean;
  aiEnabled?: boolean;
  aiSignalsCount?: number;
}

export interface PolicySummary {
  policyType: 'returns' | 'shipping' | 'refund' | 'terms';
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
