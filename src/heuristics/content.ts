import { 
  RiskSignal, 
  ContactAnalysis, 
  PolicyAnalysis 
} from '../types/analysis';

const SCORES = {
  NO_CONTACT_INFO: 15,
  MISSING_POLICIES: 20,
  NO_SOCIAL_MEDIA: 10,
} as const;

export function checkContactInfo(): ContactAnalysis {
  const signals: RiskSignal[] = [];
  const bodyText = document.body.innerText.toLowerCase();
  const bodyHTML = document.body.innerHTML.toLowerCase();
  
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
  
  const socialMediaLinks: string[] = [];
  const socialMediaDomains = [
    { name: 'facebook', patterns: ['facebook.com', 'fb.com'] },
    { name: 'twitter', patterns: ['twitter.com', 'x.com'] },
    { name: 'instagram', patterns: ['instagram.com'] },
    { name: 'linkedin', patterns: ['linkedin.com'] },
    { name: 'youtube', patterns: ['youtube.com'] },
    { name: 'pinterest', patterns: ['pinterest.com'] },
    { name: 'tiktok', patterns: ['tiktok.com'] },
  ];
  
  socialMediaDomains.forEach(({ name, patterns }) => {
    const found = patterns.some(pattern => bodyHTML.includes(pattern));
    if (found && !socialMediaLinks.includes(name)) {
      socialMediaLinks.push(name);
    }
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
  
  if (socialMediaLinks.length === 0) {
    signals.push({
      id: 'no-social-media',
      score: SCORES.NO_SOCIAL_MEDIA,
      reason: 'No social media presence found',
      severity: 'low',
      category: 'legitimacy',
      source: 'heuristic',
      details: 'Established businesses usually maintain social media profiles for customer engagement.',
    });
  }
  
  return {
    hasContactPage,
    hasPhoneNumber,
    hasPhysicalAddress,
    hasEmail,
    socialMediaLinks,
    signals,
  };
}

export function checkPolicyPages(): PolicyAnalysis {
  const signals: RiskSignal[] = [];
  const policyUrls: PolicyAnalysis['policyUrls'] = {};
  
  const allLinks = Array.from(document.querySelectorAll('a[href]'));
  
  const policyKeywords = {
    returns: ['return', 'returns'],
    shipping: ['shipping', 'delivery', 'ship'],
    refund: ['refund', 'refunds', 'money back'],
    terms: ['terms', 'terms of service', 'tos', 'terms and conditions', 'conditions'],
    privacy: ['privacy', 'privacy policy', 'data protection'],
  };
  
  const hasReturnPolicy = findPolicyLink(allLinks, policyKeywords.returns, policyUrls, 'returns');
  const hasShippingPolicy = findPolicyLink(allLinks, policyKeywords.shipping, policyUrls, 'shipping');
  const hasRefundPolicy = findPolicyLink(allLinks, policyKeywords.refund, policyUrls, 'refund');
  const hasTermsOfService = findPolicyLink(allLinks, policyKeywords.terms, policyUrls, 'terms');
  const hasPrivacyPolicy = findPolicyLink(allLinks, policyKeywords.privacy, policyUrls, 'privacy');
  
  const missingPolicies: string[] = [];
  
  if (!hasReturnPolicy) missingPolicies.push('return policy');
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
    hasReturnPolicy,
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
  
  console.log('✅ Content & policy checks complete', {
    contactSignals: contact.signals.length,
    policySignals: policies.signals.length,
  });
  
  return {
    contact,
    policies,
  };
}
