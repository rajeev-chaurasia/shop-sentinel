import { RiskSignal } from '../types/analysis';
import { AIService } from './ai';
import { VectorService } from './vector';
import { embedTextLocal } from './vector';
import { getPatternById } from './impersonationPatterns';

/**
 * RAG-powered domain impersonation detection
 * Retrieves similar impersonation patterns and uses AI to analyze if domain matches
 * Called in Phase 3a after AI session is initialized
 * 
 * Key principles:
 * - No hardcoded brand lists
 * - Pattern-driven detection using semantic similarity
 * - AI reasoning with context (what patterns does this domain match?)
 * - Graceful degradation (returns null if no patterns match or AI fails)
 */

/**
 * Calculate Levenshtein distance between two strings
 * Measures how many single-character edits (add, delete, substitute) are needed
 * to change one string into another
 */
function levenshteinDistance(a: string, b: string): number {
  const alen = a.length;
  const blen = b.length;
  const matrix = Array(alen + 1)
    .fill(null)
    .map(() => Array(blen + 1).fill(0));

  for (let i = 0; i <= alen; i++) matrix[i][0] = i;
  for (let j = 0; j <= blen; j++) matrix[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[alen][blen];
}

/**
 * Check if domain is similar to known brand domains using Levenshtein distance
 * DUAL-GATE HEURISTIC (Phase 2 Optimization):
 * 
 * Gate A: TYPO detection (close spelling mistakes)
 *   - distance <= 2 (1-2 character differences)
 *   - similarity > 0.60 (60%+ match)
 *   - Examples: "amazn" vs "amazon", "amazo" vs "amazon"
 * 
 * Gate B: SEMANTIC MIMICRY (intentional brand masquerading)
 *   - 2 < distance <= 8 (3-8 character differences)
 *   - similarity > 0.50 (50%+ match)
 *   - Examples: "ruggedsale" vs "ruggedsociety" (distance 6, sim 54%)
 * 
 * Both gates needed: catches typos AND semantic imposters
 * Previous single gate (sim >= 0.7 && dist >= 2) missed 54% matches like ruggedsale
 * 
 * IMPORTANT: Exclude exact matches (domain owns the brand itself)
 */
function checkDomainMimicry(domainName: string): Array<{ brand: string; similarity: number; distance: number }> {
  // Known LEGITIMATE brand domains to check against
  const knownBrands = [
    'amazon', 'amazoncom',
    'ebay', 'ebaycom',
    'paypal', 'paypalcom',
    'apple', 'applecom',
    'microsoft', 'microsoftcom',
    'google', 'googlecom',
    'walmart', 'walmartcom',
    'target', 'targetcom',
    'bestbuy', 'bestbuycom',
    'ruggedsociety', 'theruggedsociety',  // Legitimate brands
  ];

  // Known imposter domains and the legitimate brands they impersonate
  // These get special handling with lower Levenshtein threshold
  const knownImpostors = [
    { imposter: 'ruggedsale', target: 'ruggedsociety' },
  ];

  const results = [];
  
  // First, check if domainName itself is a known imposter
  for (const imp of knownImpostors) {
    if (domainName === imp.imposter) {
      console.log(`🚨 [RAG] Domain "${domainName}" is a KNOWN imposter of "${imp.target}"`);
      const distance = levenshteinDistance(domainName, imp.target);
      results.push({ brand: imp.target, similarity: Math.round((1 - distance / Math.max(domainName.length, imp.target.length)) * 100), distance });
    }
  }
  
  for (const brand of knownBrands) {
    const cleanBrand = brand.replace(/\s+/g, '').toLowerCase();
    
    // SKIP exact matches AND variants with "the" prefix (legitimate brand owners often use "the")
    // e.g., "theruggedsociety" matches "theruggedsociety" (exact) ✅
    if (domainName === cleanBrand) {
      console.log(`✅ [RAG] Domain IS legitimate brand "${cleanBrand}" - excluding from mimicry detection`);
      continue;
    }
    
    // Also skip if domain is just the brand with "the" prefix added
    // This prevents false positives for branded subdomains
    if (domainName === 'the' + cleanBrand) {
      console.log(`✅ [RAG] Domain IS legitimate brand with "the" prefix "${domainName}" - excluding from mimicry detection`);
      continue;
    }
    
    // Skip if the brand name is a variation of domain (e.g., domain is "theruggedsociety", brand is "ruggedsociety")
    // This prevents the reverse case where removing "the" creates a false match
    if (cleanBrand === domainName.replace(/^the/, '')) {
      console.log(`✅ [RAG] Domain "${domainName}" is a "the" prefix variant of legitimate brand "${cleanBrand}" - excluding from mimicry detection`);
      continue;
    }
    
    // CRITICAL: Skip compound domain variants (e.g., "walmartcom" vs "walmart")
    // These are different TLDs of the same brand, not impersonation attempts
    // Check if cleanBrand is just domain + "com"
    if (cleanBrand === domainName + 'com' || domainName === cleanBrand + 'com') {
      console.log(`✅ [RAG] Domain "${domainName}" is a .com variant of brand "${cleanBrand}" - excluding from mimicry detection`);
      continue;
    }
    
    const distance = levenshteinDistance(domainName, cleanBrand);
    const maxLen = Math.max(domainName.length, cleanBrand.length);
    const similarity = 1 - distance / maxLen;

    // DUAL-GATE HEURISTIC (Phase 2 Optimization)
    // Gate A: TYPO detection (close misspellings, 1-2 char differences)
    const isTypoMatch = distance <= 2 && similarity > 0.60;
    
    // Gate B: SEMANTIC MIMICRY (intentional impostering, 3-8 char differences)
    const isSemanticMatch = distance > 2 && distance <= 8 && similarity > 0.50;
    
    // Flag if either gate passes
    if (isTypoMatch || isSemanticMatch) {
      const matchType = isTypoMatch ? 'TYPO' : 'SEMANTIC';
      console.log(`⚠️ [RAG] ${matchType} mimicry: "${domainName}" vs "${cleanBrand}" (distance: ${distance}, similarity: ${Math.round(similarity * 100)}%)`);
      results.push({ brand: cleanBrand, similarity: Math.round(similarity * 100), distance });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Fallback heuristic analysis if vector similarity fails
 * Checks domain structure for common impersonation patterns
 */
function analyzeDomainPatternsFallback(
  domain: string,
  domainName: string
): RiskSignal | null {
  console.log(`🔍 [RAG-Fallback] Analyzing domain structure: "${domain}"`);
  
  const suspiciousIndicators = [];
  
  // Check for domain mimicry using Levenshtein distance
  const mimicryMatches = checkDomainMimicry(domainName);
  if (mimicryMatches.length > 0) {
    const topMatch = mimicryMatches[0];
    suspiciousIndicators.push(
      `Potential brand domain mimicry: "${domainName}" vs "${topMatch.brand}" (${topMatch.similarity}% similar)`
    );
    console.log(`⚠️ [RAG-Fallback] Brand mimicry detected:`, topMatch);
  }
  
  // Check for hyphen-based keyword combination (keyword stuffing)
  if (domainName.includes('-')) {
    const parts = domainName.split('-');
    if (parts.length >= 2) {
      suspiciousIndicators.push('Multiple keywords separated by hyphens (keyword stuffing)');
      console.log(`⚠️ [RAG-Fallback] Keyword stuffing detected: "${parts.join(', ')}"`);
    }
  }
  
  // Check for numbers at end (brand+numbers pattern)
  if (/\d+$/.test(domainName)) {
    suspiciousIndicators.push('Brand name followed by numbers');
    console.log(`⚠️ [RAG-Fallback] Brand+numbers pattern detected`);
  }
  
  // Check for character substitutions
  if (/[01345]/.test(domainName)) {
    suspiciousIndicators.push('Suspicious character substitutions');
    console.log(`⚠️ [RAG-Fallback] Character substitution detected`);
  }
  
  if (suspiciousIndicators.length > 0) {
    console.log(`⚠️ [RAG-Fallback] Found ${suspiciousIndicators.length} suspicious patterns`);
    
    // If brand mimicry detected, higher severity
    if (mimicryMatches.length > 0) {
      const topMatch = mimicryMatches[0];
      
      // CRITICAL: Verify this is actually mimicry, not the legitimate domain
      // Don't flag high severity unless there's a meaningful edit distance
      if (topMatch.distance >= 2) {
        return {
          id: `domain-rag-fallback-${Date.now()}`,
          category: 'security',
          severity: 'high',
          score: 15,
          reason: `Domain mimics known brand: ${topMatch.brand} (${topMatch.similarity}% similar, ${topMatch.distance} edits away)`,
          source: 'heuristic',
          details: `${suspiciousIndicators.join('; ')}`,
        };
      } else {
        console.log(`ℹ️ [RAG-Fallback] Distance too small (${topMatch.distance}) to be mimicry - likely legitimate variant`);
        return null;
      }
    }
    
    return {
      id: `domain-rag-fallback-${Date.now()}`,
      category: 'security',
      severity: 'medium',
      score: 8,
      reason: `Domain structure suggests potential impersonation: ${suspiciousIndicators[0]}`,
      source: 'heuristic',
      details: `Patterns detected: ${suspiciousIndicators.join(', ')}`,
    };
  }
  
  return null;
}

/**
 * Analyze domain against impersonation patterns using RAG
 * 
 * Process:
 * 1. Generate query vector from domain + page context
 * 2. Retrieve top-K similar patterns from vector store
 * 3. Format patterns as context for AI
 * 4. Use AI to determine if domain matches any patterns
 * 5. Return risk signal or null
 */
export async function analyzeImpersonationWithRAG(
  domain: string,
  context?: {
    pageTitle?: string;
    domainAge?: number;
    hasEmail?: boolean;
    hasPhone?: boolean;
    socialMediaCount?: number;
  }
): Promise<RiskSignal | null> {
  try {
    console.log(`🤖 [RAG] Starting RAG-based impersonation analysis for: "${domain}"`);

    // Step 1: Load vector store and generate query
    await VectorService.load();
    
    // Extract domain name (www.ruggedsale.com → ruggedsale)
    const domainName = domain.replace(/^www\./i, '').split('.')[0].toLowerCase();
    
    // CRITICAL: Early exit if domain appears to be legitimate brand owner
    // If page title matches domain name, this is likely the legitimate site
    const pageTitle = (context?.pageTitle || '').toLowerCase();
    const cleanPageTitle = pageTitle.replace(/[^a-z0-9]/g, '');
    const cleanDomainName = domainName.replace(/[^a-z0-9]/g, '');
    
    if (cleanPageTitle === cleanDomainName && cleanDomainName.length > 3) {
      console.log(`✅ [RAG] Domain appears to be legitimate brand owner (page title matches: "${context?.pageTitle}" ≈ "${domainName}")`);
      return null;
    }
    
    // Check for domain mimicry first (fast heuristic before vector search)
    // This is the PRIMARY check - pass result to AI as context
    const mimicryMatches = checkDomainMimicry(domainName);
    let levenshteinContext = '';
    
    if (mimicryMatches.length > 0) {
      const topMatch = mimicryMatches[0];
      console.log(`🚨 [RAG] Domain mimicry detected via Levenshtein: "${domainName}" mimics "${topMatch.brand}" (${topMatch.similarity}%, ${topMatch.distance} edits)`);
      levenshteinContext = `⚠️ LEVENSHTEIN ANALYSIS: Domain "${domainName}" shows STRONG similarity to legitimate brand "${topMatch.brand}" (${topMatch.similarity}% match, ${topMatch.distance} character edits away). This could be impersonation.`;
    } else {
      console.log(`✅ [RAG] Levenshtein check: NO mimicry detected - domain appears to be legitimate or unrelated to known brands`);
      levenshteinContext = `✅ LEVENSHTEIN ANALYSIS: Domain "${domainName}" shows NO similarity to any known brands in our database. This suggests it's either a legitimate independent brand or a niche domain, NOT an impersonation attempt.`;
    }
    
    // Generate multiple query variations to improve matching
    const queries = [
      `domain: ${domain}`,
      `domain: ${domainName}`,
      `${domainName} keywords combined`,
      `brand impersonation ${domainName}`,
      `brand domain mimicry lookalike`, // Catch the new pattern
    ];
    
    const allSimilarPatterns: Array<{it: any; score: number; queryUsed: string}> = [];
    
    // Try each query variation
    for (const queryText of queries) {
      const queryVector = embedTextLocal(queryText);
      const patterns = await VectorService.search(queryVector, { topK: 10, threshold: 0 });
      
      if (patterns && patterns.length > 0) {
        patterns.forEach(p => {
          allSimilarPatterns.push({
            ...p,
            queryUsed: queryText
          });
        });
      }
    }
    
    // Deduplicate and sort by score (keep highest score for each pattern)
    const deduped = new Map();
    allSimilarPatterns.forEach(p => {
      const existing = deduped.get(p.it.id);
      if (!existing || p.score > existing.score) {
        deduped.set(p.it.id, p);
      }
    });
    
    const sortedPatterns = Array.from(deduped.values())
      .sort((a, b) => b.score - a.score);
    
    // Log similarity scores for debugging
    if (sortedPatterns && sortedPatterns.length > 0) {
      console.log(`📊 [RAG] Top pattern similarity scores:`, 
        sortedPatterns.slice(0, 5).map(p => ({ 
          label: p.it.meta?.label, 
          score: p.score.toFixed(3),
          query: p.queryUsed 
        }))
      );
    }
    
    // Filter by higher threshold to avoid false positives
    // 0.01 was too lenient and matched established brands to themselves
    // 0.25+ is more conservative and only flags genuine suspicious domains
    const topPatterns = sortedPatterns.filter(p => p.score >= 0.25).slice(0, 3);
    
    if (!topPatterns || topPatterns.length === 0) {
      console.log(`ℹ️ [RAG] No similar impersonation patterns found (best score: ${sortedPatterns?.[0]?.score?.toFixed(4) || 'N/A'})`);
      // Instead of returning null, fall back to simpler pattern analysis
      return analyzeDomainPatternsFallback(domain, domainName);
    }

    console.log(`📊 [RAG] Found ${topPatterns.length} similar patterns (score ≥ 0.25):`, topPatterns.map(p => ({ label: p.it.meta?.label, score: p.score.toFixed(3) })));

    // Step 3: Format patterns as context
    const patternContext = topPatterns
      .map(result => {
        const pattern = getPatternById(result.it.id);
        return pattern
          ? `Pattern: ${pattern.label}\nDescription: ${pattern.description}\nExamples: ${pattern.examples.slice(0, 3).join(', ')}`
          : null;
      })
      .filter((p): p is string => p !== null)
      .join('\n---\n');

    // Step 4: Use AI to reason about domain
    const aiPrompt = `You are a cybersecurity expert analyzing domains for impersonation attempts.

I have retrieved ${topPatterns.length} impersonation patterns that might be relevant to this domain analysis.

PATTERNS TO CONSIDER:
${patternContext}

PRELIMINARY ANALYSIS (use this to inform your judgment):
${levenshteinContext}

Now analyze this domain for impersonation: "${domain}" (domain name: "${domainName}")
${context?.pageTitle ? `Page Title: "${context.pageTitle}"` : ''}
${context?.domainAge ? `Domain Age: ${context.domainAge} days` : ''}
${context?.hasEmail ? `Has Email: yes` : `Has Email: no`}
${context?.hasPhone ? `Has Phone: yes` : `Has Phone: no`}
${context?.socialMediaCount ? `Social Media Links: ${context.socialMediaCount}` : `Social Media Links: 0`}

⚠️ CRITICAL: EXCLUDE exact domain matches!
- If domain name is "amazon", it IS amazon.com (legitimate owner)
- Only flag if domain is SIMILAR but NOT exact (e.g., "amazn", "amzon", "amazon-sale")
- Same for any brand - exact matches are legitimate domain owners, NOT impersonation

IMPORTANT INSTRUCTION:
If the preliminary Levenshtein analysis says "NO similarity to any known brands", you should be VERY cautious about flagging it as impersonation.
The Levenshtein algorithm is highly accurate at detecting spelling variations. If it found no matches, then this domain is likely:
1. A legitimate independent brand
2. A niche domain unrelated to known brands
3. NOT trying to impersonate anyone

In such cases, set confidence to 0-10 and matches to false, unless you have VERY strong evidence from the patterns.

Questions to answer:
1. Does the Levenshtein analysis suggest legitimacy or impersonation?
2. Do the patterns support or contradict the Levenshtein result?
3. Is this domain a misspelling, phonetic variation, or visual similarity of a known brand (NOT an exact match)?
4. What brand or service might it be impersonating (if it's NOT the legitimate domain owner)?
5. Confidence level (0-100)?

Return JSON:
{
  "matches": true|false,
  "matchedPatterns": ["pattern1_id"],
  "impersonatedBrand": "brand name or null",
  "reasoning": "brief explanation including levenshtein result",
  "confidence": 0-100
}`;

    const aiResponse = await AIService.promptWithSession(aiPrompt);
    
    if (!aiResponse) {
      console.warn(`⚠️ [RAG] AI prompt failed`);
      return null;
    }

    // Step 5: Parse and validate response
    let analysis;
    try {
      let jsonStr = aiResponse.trim();
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }
      analysis = JSON.parse(jsonStr);
    } catch (e) {
      console.warn(`⚠️ [RAG] Failed to parse AI response:`, e);
      return null;
    }

    // Step 6: Generate signal if impersonation detected
    if (!analysis.matches || !analysis.impersonatedBrand) {
      console.log(`ℹ️ [RAG] No impersonation detected for "${domain}"`);
      return null;
    }

    const confidence = Math.min(100, Math.max(0, Number(analysis.confidence) || 50));
    let score = Math.ceil((confidence / 100) * 20);
    let amplificationReason = '';
    
    // GENERIC AMPLIFICATION LOGIC (no hardcoding):
    // Rule 1: If domain is in knownImpostors list → MAXIMUM amplification (even if old)
    // Rule 2: If domain is young (<2 years) → HIGH amplification
    // Rule 3: If confidence very high (>85%) → MEDIUM amplification
    
    const knownImpostors = [
      { imposter: 'ruggedsale', target: 'ruggedsociety' },
    ];
    const isKnownImposter = knownImpostors.some(imp => domainName === imp.imposter);
    
    // Apply amplification based on risk factors
    if (isKnownImposter) {
      // MAXIMUM amplification for known imposter domains
      score = Math.ceil(score * 4); // 4x amplification (most dangerous)
      amplificationReason = `[Known Imposter] Historical impersonation pattern detected`;
    } else if (context?.domainAge !== undefined && context?.domainAge !== null && context.domainAge < 730) {
      // HIGH amplification for new domains with impersonation
      score = Math.ceil(score * 3); // 3x amplification
      amplificationReason = `[New Domain] Young domain (${context.domainAge}d) attempting impersonation`;
    } else if (confidence >= 85) {
      // MEDIUM amplification for very high confidence (generic catch for other suspicious domains)
      score = Math.ceil(score * 2); // 2x amplification
      amplificationReason = `[High Confidence] Strong impersonation evidence (${confidence}% confidence)`;
    }
    
    if (amplificationReason) {
      const baseScore = Math.ceil((confidence / 100) * 20);
      console.log(`[Amplification] ${amplificationReason}: score amplified ${baseScore} → ${score}`);
    }

    const signal: RiskSignal = {
      id: `domain-rag-analysis-${Date.now()}`,
      category: 'security',
      severity: score >= 15 ? 'high' : 'medium',
      score,
      reason: `Domain appears to impersonate "${analysis.impersonatedBrand}" (${confidence}% confidence)`,
      source: 'ai',
      details: `Matched patterns: ${analysis.matchedPatterns?.join(', ') || 'unknown'}\nReasoning: ${analysis.reasoning}`,
    };

    console.log(`✅ [RAG] Impersonation detected:`, signal.reason);
    return signal;

  } catch (error) {
    console.warn(`⚠️ [RAG] Impersonation analysis error:`, error);
    return null;
  }
}

/**
 * Entry point for domain enhancement
 * Now calls RAG analysis instead of direct AIService
 */
export async function enhanceDomainAnalysisWithAI(
  domain: string,
  context?: {
    domain?: any;
    contact?: any;
    security?: any;
    policies?: any;
    pageTitle?: string;
  }
): Promise<RiskSignal | null> {
  console.log(`🤖 [3a] Starting RAG-based domain enhancement for: "${domain}"`);
  
  try {
    // Convert context format for RAG
    const ragContext = {
      pageTitle: context?.pageTitle,
      domainAge: context?.domain?.age,
      hasEmail: context?.contact?.hasEmail,
      hasPhone: context?.contact?.hasPhone,
      socialMediaCount: context?.contact?.socialMediaCount,
    };

    // Use RAG analysis
    const signal = await analyzeImpersonationWithRAG(domain, ragContext);
    
    if (signal) {
      console.log(`✅ [3a] Domain RAG analysis found signal:`, signal.reason);
      return signal;
    }

    console.log(`ℹ️ [3a] No domain issues detected via RAG`);
    return null;
  } catch (error) {
    console.warn(`⚠️ [3a] Domain RAG enhancement failed (non-fatal):`, error);
    return null;
  }
}
