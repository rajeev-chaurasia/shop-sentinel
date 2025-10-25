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

const SCORES = {
  NO_CONTACT_INFO: 15,
  MISSING_POLICIES: 20,
  NO_SOCIAL_MEDIA: 10,
} as const;

export function checkContactInfo(): ContactAnalysis {
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
  
  // ⚠️ DON'T blindly penalize missing social media - let AI make context-aware decision
  // Social media absence is only concerning for NEW sites with other red flags
  // Established businesses (old domains, premium registrars) may not link social media on all pages
  // The AI will receive social media data and make intelligent assessment based on full context
  
  console.log('📱 Social media detection:', {
    found: socialMediaProfiles.length,
    platforms: socialMediaProfiles.map(p => `${p.platform} (${p.location})`),
    legacy_count: socialMediaLinks.length
  });
  
  return {
    hasContactPage,
    hasPhoneNumber,
    hasPhysicalAddress,
    hasEmail,
    socialMediaLinks,
    socialMediaProfiles,
    signals,
  };
}

export function checkPolicyPages(): PolicyAnalysis {
  const signals: RiskSignal[] = [];
  const policyUrls: PolicyAnalysis['policyUrls'] = {};
  
  const allLinks = Array.from(document.querySelectorAll('a[href]'));
  const bodyText = document.body.innerText.toLowerCase();
  
  const policyKeywords = {
    returns: ['return', 'returns'],
    shipping: ['shipping', 'delivery', 'ship'],
    refund: ['refund', 'refunds', 'money back'],
    terms: ['terms', 'terms of service', 'tos', 'terms and conditions', 'conditions'],
    privacy: ['privacy', 'privacy policy', 'data protection'],
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
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const text = link.textContent?.toLowerCase() || '';
    const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
    
    const matches = keywords.some(keyword => {
      const keywordLower = keyword.toLowerCase();
      return text.includes(keywordLower) || 
             href.toLowerCase().includes(keywordLower) ||
             ariaLabel.includes(keywordLower);
    });
    
    if (matches) {
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

        // Relaxed acceptance: allow help/returns/refund pages without the word "policy"
        const allowPatterns = ['policy', 'return', 'returns', 'refund', 'replacement', '/help', '/gp/help', '/help/'];
        const likelyPolicy = allowPatterns.some(k => text.includes(k) || ariaLabel.includes(k) || lowerHref.includes(k));
        if (!likelyPolicy) continue;
      }

      let absoluteUrl = href;
      if (href.startsWith('/')) {
        absoluteUrl = window.location.origin + href;
      } else if (href.startsWith('#')) {
        absoluteUrl = window.location.href.split('#')[0] + href;
      } else if (!href.startsWith('http')) {
        absoluteUrl = window.location.origin + '/' + href;
      }
      
      policyUrls[policyType] = absoluteUrl;
      return true;
    }
  }
  
  return false;
}

export async function runContentPolicyChecks(): Promise<{
  contact: ContactAnalysis;
  policies: PolicyAnalysis;
}> {
  console.log('📋 Running content & policy checks...');
  
  const contact = checkContactInfo();
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
