import { 
  RiskSignal, 
  SecurityAnalysis, 
  DomainAnalysis, 
  PaymentAnalysis 
} from '../types/analysis';

// Configuration
const PROXY_BACKEND_URL = 'http://localhost:3001'; // Change this to your deployed backend URL
const DOMAIN_AGE_THRESHOLD_DAYS = 180;

// Scoring values
const SCORES = {
  NO_HTTPS: 40,
  MIXED_CONTENT: 35,
  NEW_DOMAIN: 30,
  SUSPICIOUS_URL: 25,
  IRREVERSIBLE_PAYMENTS_ONLY: 45,
} as const;

// Mock WHOIS data for development (matching real API structure)
const MOCK_WHOIS_RESPONSES: Record<string, any> = {
  'amazon.com': {
    createdDate: '1994-11-01T05:00:00Z',
    registrar: 'MarkMonitor Inc.',
    ageInDays: 10950,
    dnssec: 'unsigned',
    expirationDate: '2025-10-30T04:00:00Z',
    nameServers: ['NS1.AMAZON.COM', 'NS2.AMAZON.COM'],
    emails: 'hostmaster@amazon.com',
  },
  'walmart.com': {
    createdDate: '1995-07-14T04:00:00Z',
    registrar: 'MarkMonitor Inc.',
    ageInDays: 10976, // ~30 years
    dnssec: 'unsigned',
    expirationDate: '2026-07-13T04:00:00Z',
    nameServers: ['NS1.WALMART.COM', 'NS2.WALMART.COM'],
    emails: 'domain-contact@walmart.com',
  },
  'example.com': {
    createdDate: '1992-01-01T00:00:00Z',
    registrar: 'IANA',
    ageInDays: 12000,
    dnssec: 'unsigned',
    expirationDate: '2026-08-13T04:00:00Z',
    nameServers: ['A.IANA-SERVERS.NET', 'B.IANA-SERVERS.NET'],
    emails: 'reserved@iana.org',
  },
  'super-cheap-deals-2024.com': {
    createdDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    registrar: 'Namecheap',
    ageInDays: 45,
    dnssec: 'unsigned',
    expirationDate: new Date(Date.now() + 320 * 24 * 60 * 60 * 1000).toISOString(),
    nameServers: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
    emails: 'abuse@namecheap.com',
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
 * Check domain age using WHOIS API
 */
export async function checkDomainAge(domain: string, includeWhois: boolean = false): Promise<Partial<DomainAnalysis>> {
  try {
    // Strip www. prefix for WHOIS lookup
    const cleanDomain = domain.replace(/^www\./i, '');
    
    let whoisData;

    if (!includeWhois) {
      // Use mock data when WHOIS verification is disabled
      console.log('🔧 WHOIS verification disabled, using mock data for:', cleanDomain);
      whoisData = MOCK_WHOIS_RESPONSES[cleanDomain] || MOCK_WHOIS_RESPONSES['example.com'];
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      // Call proxy backend server
      console.log('🌐 Fetching WHOIS data via proxy for:', cleanDomain);

      const response = await fetch(
        `${PROXY_BACKEND_URL}/api/whois/${cleanDomain}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Proxy server error: ${response.status} ${response.statusText}`);
      }

      const proxyResponse = await response.json();

      if (!proxyResponse.success) {
        throw new Error(proxyResponse.error || 'Proxy server returned an error');
      }

      whoisData = proxyResponse.data;
      
      console.log('📥 WHOIS data from proxy:', whoisData);

      // Parse the creation_date from proxy response
      const createdDate = whoisData.creation_date;
      
      if (!createdDate) {
        console.warn('⚠️ No creation date found in WHOIS data for:', cleanDomain);
        // Return partial data even without creation date
        return {
          domain,
          ageInDays: null,
          registrar: whoisData.registrar || null,
          isSuspicious: false,
          signals: [{
            id: 'no-creation-date',
            score: 0,
            reason: 'Domain creation date not available',
            severity: 'low',
            category: 'legitimacy',
            source: 'heuristic',
            details: 'WHOIS data incomplete - this is not necessarily suspicious',
          }],
          creationDate: null,
          expirationDate: whoisData.expiration_date || null,
          updatedDate: whoisData.updated_date || null,
          dnssec: whoisData.dnssec || null,
          nameServers: whoisData.name_servers || null,
          registrantEmail: whoisData.emails || null,
          status: whoisData.status || null,
          whoisServer: whoisData.whois_server || null,
        };
      }

      // Calculate domain age from creation_date
      // Format: "1997-09-15 04:00:00" or "1997-09-15T04:00:00Z"
      const created = new Date(createdDate);
      
      // Validate date
      if (isNaN(created.getTime())) {
        console.warn('⚠️ Invalid creation date format:', createdDate);
        throw new Error('Invalid date format in WHOIS response');
      }

      const ageInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      const ageInYears = Math.floor(ageInDays / 365);

      // Extract all important fields from WHOIS response
      whoisData = {
        createdDate,
        registrar: whoisData.registrar || null,
        ageInDays,
        ageInYears,
        dnssec: whoisData.dnssec || null,
        expirationDate: whoisData.expiration_date || null,
        updatedDate: whoisData.updated_date || null,
        emails: whoisData.emails || null,
        nameServers: whoisData.name_servers || null,
        status: whoisData.status || null, // Important: clientDeleteProhibited, etc.
        whoisServer: whoisData.whois_server || null,
        domainName: whoisData.domain_name || null,
      };

      console.log('📊 WHOIS data retrieved:', {
        domain: whoisData.domainName || cleanDomain,
        age: `${ageInDays} days (${ageInYears} years)`,
        created: new Date(createdDate).toLocaleDateString(),
        updated: whoisData.updatedDate ? new Date(whoisData.updatedDate).toLocaleDateString() : 'Unknown',
        expires: whoisData.expirationDate ? new Date(whoisData.expirationDate).toLocaleDateString() : 'Unknown',
        registrar: whoisData.registrar,
        dnssec: whoisData.dnssec,
        nameServers: whoisData.nameServers?.length || 0,
        status: whoisData.status?.length || 0,
        whoisServer: whoisData.whoisServer,
      });
    }

    const signals: RiskSignal[] = [];

    // Check if domain is too new (high risk)
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

    // Check DNSSEC status (unsigned domains are less secure)
    if (whoisData.dnssec === 'unsigned') {
      signals.push({
        id: 'dnssec-unsigned',
        score: 5,
        reason: 'Domain does not use DNSSEC',
        severity: 'low',
        category: 'security',
        source: 'heuristic',
        details: 'DNSSEC adds an extra layer of security to prevent DNS spoofing attacks',
      });
    }

    // Check expiration date (domains expiring soon might be abandoned)
    if (whoisData.expirationDate) {
      const expiresIn = Math.floor((new Date(whoisData.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      if (expiresIn < 30 && expiresIn > 0) {
        signals.push({
          id: 'domain-expiring-soon',
          score: 15,
          reason: `Domain expires in ${expiresIn} days`,
          severity: 'medium',
          category: 'legitimacy',
          source: 'heuristic',
          details: 'Legitimate businesses typically renew domains well in advance',
        });
      } else if (expiresIn < 0) {
        signals.push({
          id: 'domain-expired',
          score: 40,
          reason: 'Domain registration has expired',
          severity: 'critical',
          category: 'legitimacy',
          source: 'heuristic',
          details: 'This domain is no longer properly registered',
        });
      }
    }

    // Check domain status flags (important trust indicator)
    // Domains with protection flags (clientDeleteProhibited, etc.) are more legitimate
    if (whoisData.status) {
      // WHOIS API can return status as string, array, or null - normalize to array
      let statusArray: string[] = [];
      
      if (typeof whoisData.status === 'string') {
        // Single status or comma/space separated statuses
        statusArray = whoisData.status
          .split(/[,\s]+/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      } else if (Array.isArray(whoisData.status)) {
        statusArray = whoisData.status;
      }
      
      if (statusArray.length > 0) {
        const protectionFlags = statusArray.filter((status: string) => 
          status.includes('DeleteProhibited') || 
          status.includes('TransferProhibited') ||
          status.includes('UpdateProhibited')
        );
        
        // Domains with NO protection flags are suspicious for established sites
        if (protectionFlags.length === 0 && whoisData.ageInDays && whoisData.ageInDays > 30) {
          signals.push({
            id: 'no-domain-protection',
            score: 10,
            reason: 'Domain lacks standard protection status flags',
            severity: 'low',
            category: 'legitimacy',
            source: 'heuristic',
            details: 'Legitimate businesses typically enable transfer and deletion protection',
          });
        }
      }
    }

    return {
      domain,
      ageInDays: whoisData.ageInDays,
      registrar: whoisData.registrar,
      isSuspicious: whoisData.ageInDays < DOMAIN_AGE_THRESHOLD_DAYS,
      signals,
      creationDate: whoisData.createdDate,
      expirationDate: whoisData.expirationDate,
      updatedDate: whoisData.updatedDate,
      dnssec: whoisData.dnssec,
      nameServers: whoisData.nameServers,
      registrantEmail: whoisData.emails,
      status: whoisData.status,
      whoisServer: whoisData.whoisServer,
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
        details: `WHOIS lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      creationDate: null,
      expirationDate: null,
      updatedDate: null,
      dnssec: null,
      nameServers: null,
      registrantEmail: null,
      status: null,
      whoisServer: null,
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
 * Uses word boundary regex patterns to avoid false positives
 */
export function checkPaymentMethods(): PaymentAnalysis {
  const bodyText = document.body.innerText.toLowerCase();
  const signals: RiskSignal[] = [];

  // Regex patterns with word boundaries for precise matching
  const irreversiblePatterns = [
    { pattern: /\bcryptocurrency\b/i, name: 'cryptocurrency' },
    { pattern: /\bbitcoin\b/i, name: 'bitcoin' },
    { pattern: /\bcrypto\s+payment\b/i, name: 'crypto payment' },
    { pattern: /\bbtc\b/i, name: 'btc' },
    { pattern: /\bethereum\b/i, name: 'ethereum' },
    { pattern: /\bwire\s+transfer\b/i, name: 'wire transfer' },
    { pattern: /\bwestern\s+union\b/i, name: 'western union' },
    { pattern: /\bmoneygram\b/i, name: 'moneygram' },
    { pattern: /\b(zelle|cashapp|cash\s+app|venmo)\s+only\b/i, name: 'peer-to-peer only' },
  ];

  // Reversible payment methods (credit cards, digital wallets with buyer protection)
  const reversiblePatterns = [
    { pattern: /\bcredit\s+card\b/i, name: 'credit card' },
    { pattern: /\bdebit\s+card\b/i, name: 'debit card' },
    { pattern: /\bvisa\b/i, name: 'visa' },
    { pattern: /\bmastercard\b/i, name: 'mastercard' },
    { pattern: /\b(amex|american\s+express)\b/i, name: 'american express' },
    { pattern: /\bdiscover\b/i, name: 'discover' },
    { pattern: /\bpaypal\b/i, name: 'paypal' },
    { pattern: /\bstripe\b/i, name: 'stripe' },
    { pattern: /\bshop\s+pay\b/i, name: 'shop pay' },
    { pattern: /\bapple\s+pay\b/i, name: 'apple pay' },
    { pattern: /\bgoogle\s+pay\b/i, name: 'google pay' },
    { pattern: /\bklarna\b/i, name: 'klarna' },
    { pattern: /\bafterpay\b/i, name: 'afterpay' },
  ];

  const foundIrreversible: string[] = [];
  const foundReversible: string[] = [];

  // Check for irreversible payment methods using regex
  irreversiblePatterns.forEach(({ pattern, name }) => {
    if (pattern.test(bodyText)) {
      foundIrreversible.push(name);
    }
  });

  // Check for reversible payment methods using regex
  reversiblePatterns.forEach(({ pattern, name }) => {
    if (pattern.test(bodyText)) {
      foundReversible.push(name);
    }
  });

  const hasIrreversibleOnly = foundIrreversible.length > 0 && foundReversible.length === 0;

  if (hasIrreversibleOnly) {
    signals.push({
      id: 'irreversible-payments-only',
      score: SCORES.IRREVERSIBLE_PAYMENTS_ONLY,
      reason: 'Only irreversible payment methods detected',
      severity: 'medium',
      category: 'security',
      source: 'heuristic',
      details: `Found: ${foundIrreversible.join(', ')}. Irreversible payments offer less buyer protection.`,
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
export async function runDomainSecurityChecks(includeWhois: boolean = false): Promise<{
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

  // 2. Domain checks (only if WHOIS verification is enabled)
  let domainResult: DomainAnalysis;
  if (includeWhois) {
    console.log('🛡️ Domain Trust Check enabled - running WHOIS verification');
    const domainAgeResult = await checkDomainAge(currentDomain, includeWhois);
    const urlCheckResult = checkSuspiciousURL(currentDomain);

    domainResult = {
      domain: currentDomain,
      ageInDays: domainAgeResult.ageInDays || null,
      registrar: domainAgeResult.registrar || null,
      isSuspicious: urlCheckResult.isSuspicious || (domainAgeResult.isSuspicious || false),
      signals: [
        ...(domainAgeResult.signals || []),
        ...(urlCheckResult.signal ? [urlCheckResult.signal] : []),
      ],
    };
  } else {
    console.log('🚫 Domain Trust Check disabled - skipping WHOIS analysis');
    // Return minimal domain analysis when disabled (only URL pattern checks)
    const urlCheckResult = checkSuspiciousURL(currentDomain);
    domainResult = {
      domain: currentDomain,
      ageInDays: null,
      registrar: null,
      isSuspicious: urlCheckResult.isSuspicious,
      signals: urlCheckResult.signal ? [urlCheckResult.signal] : [],
    };
  }

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


