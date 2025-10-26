// Example of a heuristic that finds countdown timers and returns both signal and element
export function findUrgencyPatterns(document: Document): { signal: RiskSignal; element: HTMLElement }[] {
  const timers = document.querySelectorAll('.countdown-timer, [data-urgency], .timer, .offer-timer');
  return Array.from(timers).map(timerElement => ({
    signal: {
      id: 'false-urgency-timer',
      score: 30,
      reason: 'A countdown timer was found, which may create false urgency.',
      severity: 'medium',
      category: 'dark-pattern',
      source: 'heuristic',
      details: timerElement.outerHTML
    },
    element: timerElement as HTMLElement,
  }));
}
import { 
  RiskSignal, 
  ContactAnalysis, 
  PolicyAnalysis,
  SocialMediaProfile 
} from '../types/analysis';
import { socialProofAuditService } from '../services/socialProofAudit';

const SCORES = {
  NO_CONTACT_INFO: 15,
  MISSING_POLICIES: 20,
  NO_SOCIAL_MEDIA: 10,
} as const;

export async function checkContactInfo(): Promise<ContactAnalysis> {
  const signals: RiskSignal[] = [];
  const bodyText = document.body.innerText.toLowerCase();
  
  // Check for contact page
  const contactLinks = document.querySelectorAll('a[href*="contact"]');
  const hasContactPage = contactLinks.length > 0;
  
  const phonePatterns = [
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
  ];
  const hasPhoneNumber = phonePatterns.some(pattern => pattern.test(bodyText));
  
  const addressPatterns = [
    /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|circle|cir|way)/i,
    /\d{5}(?:-\d{4})?/,
    /[A-Z]{2}\s+\d{5}/,
  ];
  const hasPhysicalAddress = addressPatterns.some(pattern => pattern.test(bodyText));
  
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasEmail = emailPattern.test(bodyText);
  
  // Enhanced social media detection - find actual links, not just domain mentions
  const socialMediaLinks: string[] = []; // Platform names for backward compatibility
  const socialMediaProfiles: SocialMediaProfile[] = [];
  
  const socialMediaDomains = [
    { name: 'facebook', patterns: ['facebook.com/'], urls: [] as string[] },
    { name: 'twitter', patterns: ['twitter.com/', 'x.com/'], urls: [] as string[] },
    { name: 'instagram', patterns: ['instagram.com/'], urls: [] as string[] },
    { name: 'linkedin', patterns: ['linkedin.com/company/', 'linkedin.com/in/'], urls: [] as string[] },
    { name: 'youtube', patterns: ['youtube.com/@', 'youtube.com/c/', 'youtube.com/channel/'], urls: [] as string[] },
    { name: 'pinterest', patterns: ['pinterest.com/'], urls: [] as string[] },
    { name: 'tiktok', patterns: ['tiktok.com/@'], urls: [] as string[] },
  ];
  
  // Detect location context
  const footer = document.querySelector('footer, [role="contentinfo"]');
  const header = document.querySelector('header, [role="banner"], nav');
  
  // Find actual anchor tags pointing to social media
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    const lowerHref = href.toLowerCase();
    
    // Determine location
    let location: 'footer' | 'header' | 'body' | 'unknown' = 'unknown';
    if (footer?.contains(link)) {
      location = 'footer';
    } else if (header?.contains(link)) {
      location = 'header';
    } else {
      location = 'body';
    }
    
    // Check each social platform
    socialMediaDomains.forEach(({ name, patterns }) => {
      patterns.forEach(pattern => {
        if (lowerHref.includes(pattern) && 
            !lowerHref.includes('sharer') && // Exclude share buttons
            !lowerHref.includes('share.php') &&
            !lowerHref.includes('intent/tweet')) { // Exclude tweet buttons
          
          // Add to profiles if not already added
          const exists = socialMediaProfiles.some(p => p.platform === name);
          if (!exists) {
            socialMediaProfiles.push({
              platform: name,
              url: href,
              location
            });
            
            // Also add to legacy array
            if (!socialMediaLinks.includes(name)) {
              socialMediaLinks.push(name);
            }
          }
        }
      });
    });
  });

  // Generate signals for missing contact information
  const missingInfo: string[] = [];
  if (!hasContactPage) missingInfo.push('contact page');
  if (!hasPhoneNumber) missingInfo.push('phone number');
  if (!hasPhysicalAddress) missingInfo.push('physical address');
  if (!hasEmail) missingInfo.push('email address');
  
  if (missingInfo.length > 0) {
    signals.push({
      id: 'missing-contact-info',
      score: SCORES.NO_CONTACT_INFO,
      reason: `Missing contact information: ${missingInfo.join(', ')}`,
      severity: 'medium',
      category: 'legitimacy',
      source: 'heuristic',
      details: 'Legitimate businesses typically provide multiple ways to contact them. Missing contact information can indicate a scam.',
    });
  }

  // Perform social proof audit (TG-11 implementation)
  let enhancedProfiles = socialMediaProfiles;
  let socialProofSignals: RiskSignal[] = [];
  let socialProofAudit: ContactAnalysis['socialProofAudit'];

  try {
    const auditResult = await socialProofAuditService.auditSocialProof(socialMediaProfiles);
    enhancedProfiles = auditResult.enhancedProfiles;
    socialProofSignals = auditResult.signals;
    socialProofAudit = auditResult.auditSummary;

    console.log('📱 Social proof audit:', {
      total: socialProofAudit.totalProfiles,
      valid: socialProofAudit.validProfiles,
      invalid: socialProofAudit.invalidProfiles,
      rate: `${socialProofAudit.validationRate}%`,
    });

  } catch (error) {
    console.warn('⚠️ Social proof audit failed, using basic detection:', error);
    // Fallback: use basic social media detection without validation
  }
  
  console.log('📱 Social media detection:', {
    found: enhancedProfiles.length,
    platforms: enhancedProfiles.map(p => `${p.platform} (${p.location})${p.isValid !== undefined ? ` [${p.isValid ? 'valid' : 'invalid'}]` : ''}`),
    legacy_count: socialMediaLinks.length
  });
  
  return {
    hasContactPage,
    hasPhoneNumber,
    hasPhysicalAddress,
    hasEmail,
    socialMediaLinks,
    socialMediaProfiles: enhancedProfiles,
    signals: [...signals, ...socialProofSignals],
    socialProofAudit,
  };
}

export function checkPolicyPages(): PolicyAnalysis {
  const signals: RiskSignal[] = [];
  const policyUrls: PolicyAnalysis['policyUrls'] = {};
  
  const allLinks = Array.from(document.querySelectorAll('a[href]'));
  const bodyText = document.body.innerText.toLowerCase();
  
  const policyKeywords = {
    returns: [
      'return policy', 'returns policy', 'return & exchange', 'exchange policy',
      'return information', 'returns & exchanges', 'refund & return',
      '/returns', '/return-policy', '/returnpolicy'
    ],
    shipping: [
      'shipping policy', 'delivery policy', 'shipping info', 'delivery information',
      'shipping & delivery', 'shipping rates', 'shipping costs',
      '/shipping', '/delivery', '/shipping-policy', '/shippingpolicy'
    ],
    refund: [
      'refund policy', 'money back guarantee', 'refund process', 'refund procedure',
      'refund terms', 'refund conditions',
      '/refund', '/refunds', '/refund-policy', '/refundpolicy'
    ],
    terms: [
      'terms of service', 'terms & conditions', 'terms of use', 'user agreement',
      'service terms', 'website terms', 'terms and conditions',
      '/terms', '/tos', '/terms-of-service', '/termsofservice', '/terms-and-conditions'
    ],
    privacy: [
      'privacy policy', 'privacy statement', 'data policy', 'privacy notice',
      'privacy terms', 'data protection',
      '/privacy', '/privacy-policy', '/privacypolicy', '/data-policy'
    ],
  };
  
  const hasReturnPolicy = findPolicyLink(allLinks, policyKeywords.returns, policyUrls, 'returns');
  // Item-level override: if page explicitly states no returns, treat returns as NOT available for this item
  const noReturnPhrases = [
    'no returns applicable',
    'no return applicable',
    'no returns',
    'non returnable',
    'non-returnable',
    'final sale',
    'no exchange',
  ];
  const itemSaysNoReturn = noReturnPhrases.some(p => bodyText.includes(p));

  let effectiveHasReturnPolicy = hasReturnPolicy;
  if (itemSaysNoReturn) {
    effectiveHasReturnPolicy = false;
    signals.push({
      id: 'item-no-returns',
      score: 12,
      reason: 'This item states that returns are not applicable.',
      severity: 'medium',
      category: 'policy',
      source: 'heuristic',
      details: 'Detected phrases indicating no returns for this specific item.'
    });
  }
  const hasShippingPolicy = findPolicyLink(allLinks, policyKeywords.shipping, policyUrls, 'shipping');
  const hasRefundPolicy = findPolicyLink(allLinks, policyKeywords.refund, policyUrls, 'refund');
  const hasTermsOfService = findPolicyLink(allLinks, policyKeywords.terms, policyUrls, 'terms');
  const hasPrivacyPolicy = findPolicyLink(allLinks, policyKeywords.privacy, policyUrls, 'privacy');
  
  const missingPolicies: string[] = [];
  
  if (!effectiveHasReturnPolicy) missingPolicies.push('return policy');
  if (!hasShippingPolicy) missingPolicies.push('shipping policy');
  if (!hasRefundPolicy) missingPolicies.push('refund policy');
  if (!hasTermsOfService) missingPolicies.push('terms of service');
  if (!hasPrivacyPolicy) missingPolicies.push('privacy policy');
  
  const missingCount = missingPolicies.length;
  
  if (missingCount >= 3) {
    signals.push({
      id: 'missing-critical-policies',
      score: SCORES.MISSING_POLICIES,
      reason: `Missing ${missingCount} important policies`,
      severity: 'high',
      category: 'policy',
      source: 'heuristic',
      details: `Missing: ${missingPolicies.join(', ')}. Legitimate e-commerce sites provide clear policies.`,
    });
  } else if (missingCount > 0) {
    signals.push({
      id: 'missing-some-policies',
      score: Math.round(SCORES.MISSING_POLICIES * (missingCount / 5)),
      reason: `Missing ${missingCount} policy page(s)`,
      severity: 'medium',
      category: 'policy',
      source: 'heuristic',
      details: `Missing: ${missingPolicies.join(', ')}.`,
    });
  }
  
  if (!hasPrivacyPolicy) {
    signals.push({
      id: 'no-privacy-policy',
      score: 10,
      reason: 'No privacy policy found',
      severity: 'medium',
      category: 'policy',
      source: 'heuristic',
      details: 'Privacy policies are required by law in many jurisdictions (GDPR, CCPA, etc.).',
    });
  }
  
  return {
    hasReturnPolicy: effectiveHasReturnPolicy,
    hasShippingPolicy,
    hasRefundPolicy,
    hasTermsOfService,
    hasPrivacyPolicy,
    policyUrls,
    signals,
  };
}

function findPolicyLink(
  links: Element[], 
  keywords: string[], 
  policyUrls: PolicyAnalysis['policyUrls'],
  policyType: keyof PolicyAnalysis['policyUrls']
): boolean {
  let bestMatch: { url: string; score: number } | null = null;
  
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const text = link.textContent?.toLowerCase().trim() || '';
    const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
    
    // Skip if href is empty, just #, or external links
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    
    // Skip links that are clearly not policy pages
    const skipPatterns = [
      'return to', 'back to', 'go back', 'continue shopping', 'add to cart', 'buy now',
      'login', 'sign in', 'register', 'account', 'profile', 'wishlist', 'favorites',
      'contact us', 'help', 'support', 'faq', 'search', 'home', 'homepage',
      'cart', 'checkout', 'payment', 'subscribe', 'newsletter'
    ];
    
    if (skipPatterns.some(pattern => text.includes(pattern) || ariaLabel.includes(pattern))) {
      continue;
    }
    
    let score = 0;
    let matchesKeyword = false;
    
    // Check for keyword matches
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (text.includes(keywordLower)) {
        score += 10; // Text match is strongest
        matchesKeyword = true;
      } else if (ariaLabel.includes(keywordLower)) {
        score += 8; // Aria label is good
        matchesKeyword = true;
      } else if (href.toLowerCase().includes(keywordLower)) {
        score += 5; // URL match is weaker
        matchesKeyword = true;
      }
    }
    
    if (!matchesKeyword) continue;
    
    // Bonus points for exact matches and common policy URL patterns
    if (text === keywords[0] || text === keywords[0].toLowerCase()) score += 5;
    if (href.includes('/policy') || href.includes('/policies')) score += 3;
    if (href.includes('/legal') || href.includes('/help')) score += 2;
    
    // Penalty for generic or suspicious URLs
    if (href.includes('?') || href.includes('&')) score -= 2; // Query parameters
    if (href.includes('http') && !href.includes(window.location.hostname)) score -= 5; // External links
    
    // Avoid false positives like "no returns", "non-returnable", "final sale"
    if (policyType === 'returns' || policyType === 'refund') {
      const negativePhrases = [
        'no return', 'no returns', 'non return', 'non-return', 'non returnable', 'non-returnable',
        'final sale', 'no exchange', 'no refund', 'non refundable', 'non-refundable'
      ];
      const lowerHref = href.toLowerCase();
      const neg = negativePhrases.some(p => text.includes(p) || ariaLabel.includes(p) || lowerHref.includes(p.replace(/\s+/g, '')));
      if (neg) {
        continue; // do not count negative statements as a policy page
      }
    }

    // Keep track of the best match
    if (!bestMatch || score > bestMatch.score) {
      let absoluteUrl = href;
      if (href.startsWith('/')) {
        absoluteUrl = window.location.origin + href;
      } else if (href.startsWith('#')) {
        absoluteUrl = window.location.href.split('#')[0] + href;
      } else if (!href.startsWith('http')) {
        absoluteUrl = window.location.origin + '/' + href;
      }
      
      bestMatch = { url: absoluteUrl, score };
    }
  }
  
  if (bestMatch) {
    policyUrls[policyType] = bestMatch.url;
    return true;
  }
  
  return false;
}

export async function runContentPolicyChecks(): Promise<{
  contact: ContactAnalysis;
  policies: PolicyAnalysis;
}> {
  console.log('📋 Running content & policy checks...');
  
  const contact = await checkContactInfo();
  const policies = checkPolicyPages();

  // Detect category/page-level content differences that often change by section
  const bodyText = document.body.innerText.toLowerCase();
  const categorySignals: RiskSignal[] = [];
  if (/final sale|clearance only|non\s*returnable|intimate wear|hygiene product/.test(bodyText)) {
    categorySignals.push({
      id: 'category-hygiene-noreturns',
      score: 8,
      reason: 'This category often restricts returns (hygiene/sensitive items).',
      severity: 'low',
      category: 'policy',
      source: 'heuristic',
      details: 'Detected phrases indicating category-specific return restrictions.'
    });
  }
  policies.signals.push(...categorySignals);
  
  console.log('✅ Content & policy checks complete', {
    contactSignals: contact.signals.length,
    policySignals: policies.signals.length,
  });
  
  return {
    contact,
    policies,
  };
}
