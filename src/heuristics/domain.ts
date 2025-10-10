import { 
  RiskSignal, 
  SecurityAnalysis, 
  DomainAnalysis, 
  PaymentAnalysis 
} from '../types/analysis';

// Configuration
const WHOIS_API_KEY = 'DUMMY_API_KEY_FOR_DEMO_PURPOSES_ONLY';
const USE_MOCK_WHOIS = true;
const DOMAIN_AGE_THRESHOLD_DAYS = 180;

// Scoring values
const SCORES = {
  NO_HTTPS: 40,
  MIXED_CONTENT: 35,
  NEW_DOMAIN: 30,
  SUSPICIOUS_URL: 25,
  IRREVERSIBLE_PAYMENTS_ONLY: 45,
} as const;

// Mock WHOIS data for development
const MOCK_WHOIS_RESPONSES: Record<string, any> = {
  'amazon.com': {
    createdDate: '1994-11-01T05:00:00Z',
    registrar: 'MarkMonitor Inc.',
    ageInDays: 10950,
  },
  'example.com': {
    createdDate: '1992-01-01T00:00:00Z',
    registrar: 'IANA',
    ageInDays: 12000,
  },
  'super-cheap-deals-2024.com': {
    createdDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    registrar: 'Namecheap',
    ageInDays: 45,
  },
};

/**
 * Check if the site is using HTTPS
 */
export function checkSecurity(): SecurityAnalysis {
  const isHttps = window.location.protocol === 'https:';
  const signals: RiskSignal[] = [];

  if (!isHttps) {
    signals.push({
      id: 'no-https',
      score: SCORES.NO_HTTPS,
      reason: 'Website is not using secure HTTPS connection',
      severity: 'critical',
      category: 'security',
      source: 'heuristic',
      details: 'Shopping on non-HTTPS sites exposes your payment information to interception',
    });
  }

  return {
    isHttps,
    hasMixedContent: false, // Will be updated by checkMixedContent
    hasValidCertificate: true, // Browser validates this automatically
    signals,
  };
}

/**
 * Check for mixed content (HTTP resources on HTTPS page)
 */
export function checkMixedContent(): { hasMixedContent: boolean; signal?: RiskSignal } {
  // Only check if we're on HTTPS
  if (window.location.protocol !== 'https:') {
    return { hasMixedContent: false };
  }

  let hasMixedContent = false;
  const insecureElements: string[] = [];

  // Check forms for insecure actions
  const forms = document.querySelectorAll('form');
  forms.forEach((form, index) => {
    const action = form.getAttribute('action');
    if (action && action.startsWith('http:')) {
      hasMixedContent = true;
      insecureElements.push(`form[${index}]`);
    }
  });

  // Check input fields with external sources
  const inputsWithSrc = document.querySelectorAll('form input[src], form img[src]');
  inputsWithSrc.forEach((input) => {
    const src = input.getAttribute('src');
    if (src && src.startsWith('http:')) {
      hasMixedContent = true;
      insecureElements.push(input.tagName.toLowerCase());
    }
  });

  if (hasMixedContent) {
    return {
      hasMixedContent: true,
      signal: {
        id: 'mixed-content',
        score: SCORES.MIXED_CONTENT,
        reason: 'Forms contain insecure HTTP elements',
        severity: 'high',
        category: 'security',
        source: 'heuristic',
        details: `Found ${insecureElements.length} insecure element(s) in payment forms`,
      },
    };
  }

  return { hasMixedContent: false };
}

/**
 * Check domain age using WhoisXMLAPI
 */
export async function checkDomainAge(domain: string): Promise<Partial<DomainAnalysis>> {
  try {
    let whoisData;

    if (USE_MOCK_WHOIS) {
      // Use mock data for development
      console.log('🔧 Using mock WHOIS data for:', domain);
      whoisData = MOCK_WHOIS_RESPONSES[domain] || MOCK_WHOIS_RESPONSES['example.com'];
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      // Real API call
      console.log('🌐 Fetching real WHOIS data for:', domain);
      const response = await fetch(
        `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${WHOIS_API_KEY}&domainName=${domain}&outputFormat=JSON`
      );

      if (!response.ok) {
        throw new Error(`WHOIS API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.ErrorMessage) {
        throw new Error(data.ErrorMessage.msg);
      }

      // Parse the response
      const createdDate = data.WhoisRecord?.createdDate || data.WhoisRecord?.registryData?.createdDate;
      
      if (!createdDate) {
        console.warn('⚠️ No creation date found in WHOIS data');
        return {
          domain,
          ageInDays: null,
          registrar: data.WhoisRecord?.registrarName || null,
          isSuspicious: false,
          signals: [],
        };
      }

      const created = new Date(createdDate);
      const ageInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));

      whoisData = {
        createdDate,
        registrar: data.WhoisRecord?.registrarName || null,
        ageInDays,
      };
    }

    const signals: RiskSignal[] = [];

    // Check if domain is too new
    if (whoisData.ageInDays < DOMAIN_AGE_THRESHOLD_DAYS) {
      signals.push({
        id: 'new-domain',
        score: SCORES.NEW_DOMAIN,
        reason: `Domain is only ${whoisData.ageInDays} days old`,
        severity: 'medium',
        category: 'legitimacy',
        source: 'heuristic',
        details: `Domain was registered on ${new Date(whoisData.createdDate).toLocaleDateString()}. New domains are often used for scams.`,
      });
    }

    return {
      domain,
      ageInDays: whoisData.ageInDays,
      registrar: whoisData.registrar,
      isSuspicious: whoisData.ageInDays < DOMAIN_AGE_THRESHOLD_DAYS,
      signals,
    };
  } catch (error) {
    console.error('❌ Error checking domain age:', error);
    
    // Graceful fallback - don't penalize if we can't check
    return {
      domain,
      ageInDays: null,
      registrar: null,
      isSuspicious: false,
      signals: [{
        id: 'domain-check-failed',
        score: 0,
        reason: 'Could not verify domain age',
        severity: 'low',
        category: 'legitimacy',
        source: 'heuristic',
        details: 'WHOIS lookup failed - this is not necessarily suspicious',
      }],
    };
  }
}

/**
 * Check URL for suspicious patterns
 */
export function checkSuspiciousURL(domain: string): { isSuspicious: boolean; signal?: RiskSignal } {
  const suspiciousPatterns = [
    { pattern: /\d{4,}/, description: 'too many consecutive numbers' },
    { pattern: /-{2,}/, description: 'multiple consecutive hyphens' },
    { pattern: /[0-9]+[a-z]+[0-9]+/i, description: 'alternating numbers and letters' },
    { pattern: /\.(tk|ml|ga|cf|gq)$/, description: 'free/suspicious TLD' },
    { pattern: /\d+\.(?:com|net|org)/, description: 'numbers before common TLD' },
  ];

  // Check patterns
  for (const { pattern, description } of suspiciousPatterns) {
    if (pattern.test(domain)) {
      return {
        isSuspicious: true,
        signal: {
          id: 'suspicious-url',
          score: SCORES.SUSPICIOUS_URL,
          reason: `Suspicious URL pattern detected: ${description}`,
          severity: 'high',
          category: 'legitimacy',
          source: 'heuristic',
          details: `The domain "${domain}" contains patterns commonly used in phishing or scam sites`,
        },
      };
    }
  }

  // Check for typosquatting (similar to known brands)
  const knownBrands = [
    'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 
    'paypal', 'apple', 'google', 'microsoft', 'facebook'
  ];

  const domainWithoutTLD = domain.split('.')[0].toLowerCase();

  for (const brand of knownBrands) {
    if (domainWithoutTLD === brand) {
      continue; // It's the real brand
    }

    // Check for character substitution (e.g., amaz0n, appl3)
    const distance = levenshteinDistance(domainWithoutTLD, brand);
    if (distance > 0 && distance <= 2) {
      return {
        isSuspicious: true,
        signal: {
          id: 'typosquatting',
          score: SCORES.SUSPICIOUS_URL,
          reason: `Domain suspiciously similar to "${brand}"`,
          severity: 'critical',
          category: 'legitimacy',
          source: 'heuristic',
          details: `Potential typosquatting attack mimicking the legitimate brand "${brand}"`,
        },
      };
    }
  }

  return { isSuspicious: false };
}

/**
 * Calculate Levenshtein distance for typosquatting detection
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Check for payment methods on the page
 */
export function checkPaymentMethods(): PaymentAnalysis {
  const bodyText = document.body.innerText.toLowerCase();
  const signals: RiskSignal[] = [];

  // Keywords for irreversible payment methods
  const irreversibleKeywords = [
    'cryptocurrency', 'bitcoin', 'crypto', 'btc', 'ethereum', 'eth',
    'wire transfer', 'western union', 'moneygram',
    'zelle only', 'cash app only', 'venmo only',
  ];

  // Keywords for reversible (safer) payment methods
  const reversibleKeywords = [
    'credit card', 'visa', 'mastercard', 'amex', 'american express',
    'paypal', 'stripe', 'shop pay', 'apple pay', 'google pay',
  ];

  const foundIrreversible: string[] = [];
  const foundReversible: string[] = [];

  irreversibleKeywords.forEach(keyword => {
    if (bodyText.includes(keyword)) {
      foundIrreversible.push(keyword);
    }
  });

  reversibleKeywords.forEach(keyword => {
    if (bodyText.includes(keyword)) {
      foundReversible.push(keyword);
    }
  });

  const hasIrreversibleOnly = foundIrreversible.length > 0 && foundReversible.length === 0;

  if (hasIrreversibleOnly) {
    signals.push({
      id: 'irreversible-payments-only',
      score: SCORES.IRREVERSIBLE_PAYMENTS_ONLY,
      reason: 'Only irreversible payment methods detected',
      severity: 'critical',
      category: 'security',
      source: 'heuristic',
      details: `Found: ${foundIrreversible.join(', ')}. Scam sites often only accept irreversible payments.`,
    });
  }

  return {
    acceptedMethods: [...foundReversible, ...foundIrreversible],
    hasReversibleMethods: foundReversible.length > 0,
    hasIrreversibleOnly,
    signals,
  };
}

/**
 * Run all domain and security checks
 */
export async function runDomainSecurityChecks(): Promise<{
  security: SecurityAnalysis;
  domain: DomainAnalysis;
  payment: PaymentAnalysis;
}> {
  console.log('🔍 Running domain & security checks...');

  const currentDomain = window.location.hostname;

  // 1. Security checks (synchronous)
  const securityResult = checkSecurity();
  const mixedContentResult = checkMixedContent();
  
  if (mixedContentResult.hasMixedContent) {
    securityResult.hasMixedContent = true;
    if (mixedContentResult.signal) {
      securityResult.signals.push(mixedContentResult.signal);
    }
  }

  // 2. Domain checks (async for WHOIS)
  const domainAgeResult = await checkDomainAge(currentDomain);
  const urlCheckResult = checkSuspiciousURL(currentDomain);

  const domainResult: DomainAnalysis = {
    domain: currentDomain,
    ageInDays: domainAgeResult.ageInDays || null,
    registrar: domainAgeResult.registrar || null,
    isSuspicious: urlCheckResult.isSuspicious || (domainAgeResult.isSuspicious || false),
    signals: [
      ...(domainAgeResult.signals || []),
      ...(urlCheckResult.signal ? [urlCheckResult.signal] : []),
    ],
  };

  // 3. Payment method checks
  const paymentResult = checkPaymentMethods();

  console.log('✅ Domain & security checks complete', {
    securitySignals: securityResult.signals.length,
    domainSignals: domainResult.signals.length,
    paymentSignals: paymentResult.signals.length,
  });

  return {
    security: securityResult,
    domain: domainResult,
    payment: paymentResult,
  };
}


