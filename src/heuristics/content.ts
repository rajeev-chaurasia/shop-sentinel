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

  // Universal inline text patterns for all e-commerce platforms
  const inlineTextPatterns = {
    returns: [
      // Universal e-commerce return/refund patterns
      'returns free', 'free returns', 'free return', 'return free',
      'free 30-day', 'free 15-day', 'free 14-day', 'free 7-day',
      'free 30 day', 'free 15 day', 'free 14 day', 'free 7 day',
      '30-day return', '15-day return', '14-day return', '7-day return',
      '30 day return', '15 day return', '14 day return', '7 day return',
      'day return', 'day returns', 'day refund', 'day refunds',
      'return window', 'return period', 'return policy',
      'refund/replacement', 'refund replacement', 'replacement/refund',
      'return or exchange', 'return and exchange', 'exchange or return',
      // Generic patterns
      'returnable', 'returnable item', 'item returnable',
      'return accepted', 'returns accepted', 'return allowed',
      'return within', 'returns within', 'refund within',
      'money back', 'money-back', 'money back guarantee',
      'satisfaction guarantee', 'satisfaction guaranteed',
      'hassle free return', 'hassle-free return', 'easy return',
      'no questions asked', 'no questions asked return',
      // Additional universal variations
      'returns', 'return', 'refund', 'refunds',
      'free return shipping', 'return shipping free',
      'return label', 'return labels', 'prepaid return',
      // Common e-commerce phrases
      'easy returns', 'simple returns', 'quick returns', 'fast returns',
      'return policy', 'return information', 'return details',
      'refund policy', 'refund information', 'refund details'
    ],
    shipping: [
      'free shipping', 'free delivery', 'free ship',
      'shipping included', 'delivery included', 'ship included',
      'express shipping', 'express delivery', 'fast shipping',
      'same day delivery', 'next day delivery', 'overnight delivery',
      'shipping policy', 'delivery policy', 'shipping info',
      'shipping rates', 'delivery rates', 'shipping cost',
      'estimated delivery', 'delivery estimate', 'shipping estimate'
    ],
    refund: [
      'full refund', 'complete refund', 'total refund',
      'refund policy', 'refund process', 'refund procedure',
      'money back', 'money-back', 'money back guarantee',
      'refund within', 'refund in', 'refund available',
      'refund accepted', 'refunds accepted', 'refund allowed',
      'no questions asked', 'no questions asked refund',
      'hassle free refund', 'hassle-free refund', 'easy refund'
    ],
    terms: [
      'terms of service', 'terms & conditions', 'terms and conditions',
      'terms of use', 'user agreement', 'service terms',
      'website terms', 'site terms', 'legal terms',
      'agreement', 'user agreement', 'service agreement'
    ],
    privacy: [
      'privacy policy', 'privacy statement', 'data policy',
      'privacy notice', 'privacy terms', 'data protection',
      'privacy information', 'data privacy', 'personal data',
      'cookie policy', 'cookie notice', 'tracking policy'
    ]
  };

  // Enhanced helper: search body and nearby UI areas for inline policy phrases
  function findInlinePolicyText(keywords: string[], bodyLow: string): boolean {
    try {
      // Full-body quick scan with flexible matching
      for (const k of keywords) {
        // Try exact word boundary match first
        const exactRegex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (exactRegex.test(bodyLow)) {
          console.log(`✅ Found inline policy text in body (exact): "${k}"`);
          return true;
        }
        
        // Try flexible match for common variations (like "FREE Returns" vs "free returns")
        const flexibleRegex = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (flexibleRegex.test(bodyLow)) {
          console.log(`✅ Found inline policy text in body (flexible): "${k}"`);
          return true;
        }
        
        // Try substring match for very specific patterns (like "Returns FREE 30-day refund/replacement")
        if (bodyLow.includes(k.toLowerCase())) {
          console.log(`✅ Found inline policy text in body (substring): "${k}"`);
          return true;
        }
      }

      // Universal e-commerce selectors (works for Amazon, eBay, Shopify, WooCommerce, etc.)
      const ecommerceSelectors = [
        // Purchase and add-to-cart areas
        '#add-to-cart', '#add-to-cart-button', 'input#add-to-cart-button', '[id*="add-to-cart"]',
        'button[name="add"]', 'button.add-to-cart', 'button[class*="add-to-cart"]',
        '.add-to-cart', '.add-to-basket', '.buy-now', '.purchase-button',
        
        // Product info and pricing areas
        '.product-info', '.product-details', '.product-summary', '.product-meta',
        '.price-container', '.pricing', '.product-price', '.price-box',
        
        // Seller and merchant information
        '.seller-info', '.merchant-info', '.vendor-info', '.store-info',
        '.shipping-info', '.delivery-info', '.return-info', '.policy-info',
        
        // Common e-commerce containers
        '.product-page', '.product-container', '.product-wrapper', '.product-main',
        '.checkout-info', '.purchase-info', '.order-info', '.cart-info',
        
        // Policy and terms areas
        '.policy', '.policies', '.terms', '.conditions', '.return-policy',
        '.shipping-policy', '.delivery-policy', '.refund-policy',
        
        // Generic content areas where policy info might appear
        '.content', '.main-content', '.product-content', '.page-content',
        '.sidebar', '.product-sidebar', '.info-panel', '.details-panel',
        
        // Quantity and options
        '#quantity', '#quantity-select', '.quantity-selector', '.product-options',
        '.variant-selector', '.option-selector', '.product-variants',
        
        // Gift and checkout options
        '.gift-wrap', '.gift-options', '.checkout-options', '.purchase-options'
      ];

      const candidates: HTMLElement[] = [];
      for (const sel of ecommerceSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (el instanceof HTMLElement) candidates.push(el);
        });
      }

      // Search in candidate elements and their nearby context (universal e-commerce approach)
      for (const el of candidates) {
        let node: HTMLElement | null = el;
        for (let depth = 0; depth < 5 && node; depth++) {
          const text = (node.innerText || '').toLowerCase();
          for (const k of keywords) {
            // Try multiple matching strategies
            const exactRegex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const flexibleRegex = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            
            if (exactRegex.test(text) || flexibleRegex.test(text) || text.includes(k.toLowerCase())) {
              console.log(`✅ Found inline policy text near ${el.tagName} (depth ${depth}): "${k}"`);
              return true;
            }
          }
          
          // Check siblings for policy information
          const parent = node.parentElement;
          if (parent) {
            for (const s of Array.from(parent.children)) {
              if (!(s instanceof HTMLElement)) continue;
              const stext = (s.innerText || '').toLowerCase();
              for (const k of keywords) {
                const exactRegex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                const flexibleRegex = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                
                if (exactRegex.test(stext) || flexibleRegex.test(stext) || stext.includes(k.toLowerCase())) {
                  console.log(`✅ Found inline policy text in sibling: "${k}"`);
                  return true;
                }
              }
            }
          }
          node = node.parentElement;
        }
      }
    } catch (e) {
      // swallow DOM errors and return false
      console.warn('Error in findInlinePolicyText:', e);
      return false;
    }

    return false;
  }
  
  // Check for policy links first
  const hasReturnPolicyLink = findPolicyLink(allLinks, policyKeywords.returns, policyUrls, 'returnRefund');
  const hasShippingPolicyLink = findPolicyLink(allLinks, policyKeywords.shipping, policyUrls, 'shipping');
  const hasRefundPolicyLink = findPolicyLink(allLinks, policyKeywords.refund, policyUrls, 'returnRefund');
  const hasTermsOfServiceLink = findPolicyLink(allLinks, policyKeywords.terms, policyUrls, 'terms');
  const hasPrivacyPolicyLink = findPolicyLink(allLinks, policyKeywords.privacy, policyUrls, 'privacy');

  // Check for inline policy text
  console.log('🔍 Checking for inline policy text...');
  console.log('📄 Body text sample:', bodyText.substring(0, 500));
  
  const hasReturnPolicyText = findInlinePolicyText(inlineTextPatterns.returns, bodyText);
  const hasShippingPolicyText = findInlinePolicyText(inlineTextPatterns.shipping, bodyText);
  const hasRefundPolicyText = findInlinePolicyText(inlineTextPatterns.refund, bodyText);
  const hasTermsOfServiceText = findInlinePolicyText(inlineTextPatterns.terms, bodyText);
  const hasPrivacyPolicyText = findInlinePolicyText(inlineTextPatterns.privacy, bodyText);
  
  console.log('📊 Policy detection results:', {
    returnLink: hasReturnPolicyLink,
    returnText: hasReturnPolicyText,
    shippingLink: hasShippingPolicyLink,
    shippingText: hasShippingPolicyText,
    refundLink: hasRefundPolicyLink,
    refundText: hasRefundPolicyText
  });

  // Combine return and refund policies into one
  const hasReturnRefundPolicy = hasReturnPolicyLink || hasReturnPolicyText || hasRefundPolicyLink || hasRefundPolicyText;
  const hasShippingPolicy = hasShippingPolicyLink || hasShippingPolicyText;
  const hasTermsOfService = hasTermsOfServiceLink || hasTermsOfServiceText;
  const hasPrivacyPolicy = hasPrivacyPolicyLink || hasPrivacyPolicyText;

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

  let effectiveHasReturnRefundPolicy = hasReturnRefundPolicy;
  if (itemSaysNoReturn) {
    effectiveHasReturnRefundPolicy = false;
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
  
  const missingPolicies: string[] = [];
  
  if (!effectiveHasReturnRefundPolicy) missingPolicies.push('return/refund policy');
  if (!hasShippingPolicy) missingPolicies.push('shipping policy');
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
    hasReturnRefundPolicy: effectiveHasReturnRefundPolicy,
    hasShippingPolicy,
    hasTermsOfService,
    hasPrivacyPolicy,
    policyUrls,
    signals,
  };
}


/**
 * Validate if a policy link is clickable and accessible
 */
function validatePolicyLink(link: Element, href: string): boolean {
  try {
    // Check if element is visible and clickable
    const element = link as HTMLElement;
    
    // Check if element is hidden or disabled
    if (element.style.display === 'none' || 
        element.style.visibility === 'hidden' ||
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    
    // Check if element has proper dimensions (not collapsed)
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    // Check if href is valid and not a placeholder
    if (!href || href === '#' || href === 'javascript:void(0)' || href === 'javascript:;') {
      return false;
    }
    
    // Check for common invalid patterns
    const invalidPatterns = [
      'javascript:', 'mailto:', 'tel:', 'sms:', 'ftp:',
      'data:', 'blob:', 'about:', 'chrome:', 'moz-extension:'
    ];
    
    if (invalidPatterns.some(pattern => href.toLowerCase().startsWith(pattern))) {
      return false;
    }
    
    // Check if link points to a valid domain (not external unless it's a known policy domain)
    if (href.startsWith('http')) {
      try {
        const url = new URL(href);
        const currentDomain = window.location.hostname;
        
        // Allow same domain or known policy domains
        if (url.hostname !== currentDomain) {
          const knownPolicyDomains = [
            'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr',
            'ebay.com', 'shopify.com', 'stripe.com', 'paypal.com',
            'trustpilot.com', 'bbb.org', 'consumerreports.org'
          ];
          
          if (!knownPolicyDomains.some(domain => url.hostname.includes(domain))) {
            console.log(`⚠️ External policy link to unknown domain: ${url.hostname}`);
            return false;
          }
        }
      } catch (e) {
        console.log(`⚠️ Invalid URL format: ${href}`);
        return false;
      }
    }
    
    // Check if element is actually clickable (not just styled as a link)
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.pointerEvents === 'none') {
      return false;
    }
    
    return true;
  } catch (e) {
    console.warn('Error validating policy link:', e);
    return false;
  }
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
    if (policyType === 'returnRefund') {
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

    // Validate link accessibility and clickability
    const isValidLink = validatePolicyLink(link, href);
    if (!isValidLink) {
      console.log(`⚠️ Skipping invalid policy link: "${text}" (${href})`);
      continue;
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
      console.log(`✅ Valid policy link found: "${text}" -> ${absoluteUrl} (score: ${score})`);
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
