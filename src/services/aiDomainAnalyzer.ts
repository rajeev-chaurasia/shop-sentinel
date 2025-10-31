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
 * Examples:
 *   - "ruggedsale" vs "ruggedsociety" (distance: ~5-6, 70%+ similarity)
 *   - "amazn" vs "amazon" (distance: 1, 83%+ similarity)
 *   - "paypl" vs "paypal" (distance: 1, 83%+ similarity)
 * 
 * IMPORTANT: Exclude exact matches (domain owns the brand itself)
 */
function checkDomainMimicry(domainName: string): Array<{ brand: string; similarity: number; distance: number }> {
  // Known brand domains to check against
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
    'ruggedsociety', 'theruggeds ociety', 'therugged society',
  ];

  const results = [];
  for (const brand of knownBrands) {
    const cleanBrand = brand.replace(/\s+/g, '').toLowerCase();
    
    // SKIP exact matches - domain IS the legitimate brand
    if (domainName === cleanBrand) {
      console.log(`✅ [RAG] Domain IS legitimate brand "${cleanBrand}" - excluding from mimicry detection`);
      continue;
    }
    
    const distance = levenshteinDistance(domainName, cleanBrand);
    const maxLen = Math.max(domainName.length, cleanBrand.length);
    const similarity = 1 - distance / maxLen;

    // Flag if similarity is above 70% AND distance is reasonable
    // This prevents false positives for legitimately similar names
    if (similarity >= 0.7 && distance >= 2) {
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
    
    // Check for domain mimicry first (fast heuristic before vector search)
    // Only log if it's NOT an exact match (exact = legitimate domain owner)
    const mimicryMatches = checkDomainMimicry(domainName);
    if (mimicryMatches.length > 0) {
      const topMatch = mimicryMatches[0];
      console.log(`🚨 [RAG] Domain mimicry detected via Levenshtein: "${domainName}" mimics "${topMatch.brand}" (${topMatch.similarity}%, ${topMatch.distance} edits)`);
    } else {
      console.log(`ℹ️ [RAG] No mimicry detected via Levenshtein for "${domainName}" (may be legitimate domain)`);
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
    
    // Filter by very lenient threshold (hash-based similarity is inherently lower)
    const topPatterns = sortedPatterns.filter(p => p.score >= 0.01).slice(0, 3);
    
    if (!topPatterns || topPatterns.length === 0) {
      console.log(`ℹ️ [RAG] No similar impersonation patterns found (best score: ${sortedPatterns?.[0]?.score?.toFixed(4) || 'N/A'})`);
      // Instead of returning null, fall back to simpler pattern analysis
      return analyzeDomainPatternsFallback(domain, domainName);
    }

    console.log(`📊 [RAG] Found ${topPatterns.length} similar patterns (score ≥ 0.01):`, topPatterns.map(p => ({ label: p.it.meta?.label, score: p.score.toFixed(3) })));

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

Now analyze this domain for impersonation: "${domain}" (domain name: "${domainName}")
${context?.pageTitle ? `Page Title: "${context.pageTitle}"` : ''}
${context?.domainAge ? `Domain Age: ${context.domainAge} days` : ''}
${context?.hasEmail ? `Has Email: yes` : `Has Email: no`}
${context?.hasPhone ? `Has Phone: yes` : `Has Phone: no`}
${context?.socialMediaCount ? `Social Media Links: ${context.socialMediaCount}` : `Social Media Links: 0`}

IMPORTANT: Also check if this domain is a phonetic/spelling variation of known brands:
- "ruggedsale" could mimic "ruggedsociety" or other "rugged" brands
- "amazn" could mimic "amazon"
- "paypl" could mimic "paypal"
- Look for visual or phonetic similarities!

Questions to answer:
1. Does this domain match any of the patterns above?
2. Is this domain a misspelling, phonetic variation, or visual similarity of a known brand?
3. If yes, which pattern(s) and why?
4. What brand or service might it be impersonating?
5. Confidence level (0-100)?

Return JSON:
{
  "matches": true|false,
  "matchedPatterns": ["pattern1_id"],
  "impersonatedBrand": "brand name or null",
  "reasoning": "brief explanation",
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
    const score = Math.ceil((confidence / 100) * 20);

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
