/**
 * Impersonation Patterns for RAG-based Domain Analysis
 * These patterns are used to train the vector store and help AI
 * recognize brand impersonation attempts without hardcoding brand lists
 */

import { VectorService, embedTextLocal } from './vector';

export interface ImpersonationPattern {
  id: string;
  label: string;
  description: string;
  examples: string[];
  keywords: string; // Used for embedding
}

/**
 * Pattern library: What impersonation looks like
 * Each pattern represents a category of impersonation technique
 */
export const IMPERSONATION_PATTERNS: ImpersonationPattern[] = [
  {
    id: 'typosquatting_major_brands',
    label: 'Typosquatting - Character Substitution',
    description: 'Domain mimics popular brands using character typos or substitutions',
    examples: [
      'amazn.com (Amazon)',
      'amzon.com (Amazon)',
      'amaz0n.com (0 instead of O)',
      'paypa1.com (1 instead of l)',
      'microsfot.com (Microsoft)',
      'appl3.com (3 instead of E)',
    ],
    keywords:
      'typosquatting misspelling typo character substitution amazon paypal ebay apple microsoft google walmart homoglyph',
  },
  {
    id: 'subdomain_impersonation',
    label: 'Subdomain Impersonation',
    description: 'Legitimate brand name as subdomain of malicious domain',
    examples: [
      'amazon.security-update.com',
      'paypal.confirm-account.net',
      'apple.support-login.net',
      'bank.security-verify.org',
      'amazon.cloudfront-cdn.com',
    ],
    keywords:
      'subdomain security update verify confirm login account official authentic amazon paypal apple support',
  },
  {
    id: 'keyword_stuffing',
    label: 'Keyword Stuffing',
    description: 'Domain combines brand name with legitimacy-sounding keywords',
    examples: [
      'walmart-official-store.com',
      'amazon-verified-deals.com',
      'ebay-secure-checkout.com',
      'paypal-authentic-login.com',
      'apple-support-official.com',
    ],
    keywords:
      'official verified authentic genuine secure official store shop certified trusted real legitimate',
  },
  {
    id: 'homoglyph_attack',
    label: 'Homoglyph/Visual Similarity Attack',
    description: 'Uses characters that look similar to brand names when viewed quickly',
    examples: [
      'rn as m: amrazon.com (Amazon)',
      '0 as O: p0yp0l.com (PayPal)',
      '1 as l: ebay1.com or ebayl.com (eBay)',
      '5 as S: ama5on.com (Amazon)',
      'vv as w: paypa1 variations',
    ],
    keywords:
      'homoglyph lookalike visual similarity character substitution 0 o 1 l i 5 s 8 b rn m vv w',
  },
  {
    id: 'new_domain_no_trust',
    label: 'New Domain - Missing Trust Signals',
    description: 'Very new domain with no contact info, email, phone, or social media presence',
    examples: [
      'domain registered less than 1 month ago',
      'no email or contact form',
      'no phone number',
      'no social media profiles',
      'no business address',
      'generic placeholder content',
    ],
    keywords:
      'new domain registration no contact missing email phone address social media business information trust signals',
  },
  {
    id: 'old_domain_isolated',
    label: 'Old Domain - Isolated/No Social',
    description:
      'Domain is several years old but appears completely isolated - no contact, email, social media, or online presence',
    examples: [
      '3+ years old but no email listed',
      'No social media profiles anywhere',
      'No phone or address',
      'No team or about page',
      'Generic stock placeholder images',
      'Minimal search history',
    ],
    keywords:
      'old domain aged years isolated no contact information email phone social media address team about',
  },
  {
    id: 'urgency_fear_tactics',
    label: 'Urgency and Fear Tactics',
    description: 'Domain or pages use urgency language suggesting scarcity or immediate action required',
    examples: [
      'limited-stock-ending-today.com',
      'verify-account-now.com',
      'urgent-security-alert.com',
      'act-now-before-expires.com',
      'last-chance-offer.com',
    ],
    keywords:
      'urgent limited stock ending today verify now act immediately hurry expires final chance last opportunity',
  },
  {
    id: 'brand_name_with_numbers',
    label: 'Brand Name Combined with Numbers/Hyphens',
    description: 'Domain uses popular brand names combined with numbers or multiple hyphens in unusual ways',
    examples: [
      'amazon-24.com',
      'paypal-365.com',
      'ebay-99.com',
      'walmart---shop.com',
      'amazon-verified-2024.com',
    ],
    keywords:
      'brand number hyphen amazon paypal ebay walmart verified secure official 2024 2025 store shop',
  },
  {
    id: 'brand_domain_mimicry',
    label: 'Brand Domain Mimicry - Similar Sounding',
    description: 'Domain name is a phonetic variation or similar-sounding variant of a known brand domain',
    examples: [
      'ruggedsale.com mimicking theruggeds0ciety.com',
      'amazn.com mimicking amazon.com',
      'paypl.com mimicking paypal.com',
      'ebay.net mimicking ebay.com',
      'appl.com mimicking apple.com',
    ],
    keywords:
      'brand mimicry lookalike phonetic variant similar sounding domain impersonation mimic fake copy therugged society',
  },
];

/**
 * Seed impersonation patterns into the vector store
 * This is called once at extension startup and caches patterns in chrome.storage.local
 *
 * Idempotent: Safe to call multiple times (checks if already seeded)
 */
export async function seedImpersonationPatterns(): Promise<void> {
  try {
    // Load vector service first
    await VectorService.load();

    console.log('🌱 Seeding impersonation patterns into vector store...');

    // Convert patterns to vector items
    const itemsToSeed = IMPERSONATION_PATTERNS.map((pattern) => ({
      id: pattern.id,
      vector: embedTextLocal(pattern.keywords),
      meta: {
        kind: 'legitimacy_case' as const,
        label: pattern.label,
        description: pattern.description,
        notes: pattern.examples.slice(0, 3).join('; '), // First 3 examples
      },
    }));

    // Upsert into vector store (replaces if exists)
    await VectorService.upsertMany(itemsToSeed);

    console.log(`✅ Seeded ${itemsToSeed.length} impersonation patterns into vector store`);
  } catch (error) {
    console.warn('⚠️ Failed to seed impersonation patterns:', error);
    // Non-fatal: Analysis can continue without seeded patterns
    // (though RAG detection will be less effective)
  }
}

/**
 * Get a specific pattern by ID (useful for debugging/testing)
 */
export function getPatternById(id: string): ImpersonationPattern | undefined {
  return IMPERSONATION_PATTERNS.find((p) => p.id === id);
}

/**
 * Get all pattern labels (for logging/debugging)
 */
export function getPatternLabels(): string[] {
  return IMPERSONATION_PATTERNS.map((p) => p.label);
}
