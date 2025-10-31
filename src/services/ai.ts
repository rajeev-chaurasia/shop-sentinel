/**
 * AI-powered dark pattern explainer
 * Uses Chrome's local AI model to generate a friendly explanation
 */
export async function getDarkPatternExplanation(contextSnippet: string): Promise<string> {
    try {
        // Check for window.ai or LanguageModel API
        const aiAvailable = typeof window !== 'undefined' &&
            (window as any).ai && typeof (window as any).ai.createTextSession === 'function';
        const lmAvailable = typeof LanguageModel !== 'undefined';

        if (!aiAvailable && !lmAvailable) {
            return 'This may be a deceptive design.';
        }

        // Construct prompt
        const prompt = `You are a helpful shopping assistant who protects users from deceptive designs. Analyze the following snippet from an e-commerce site and explain in one friendly, concise sentence how it might be trying to pressure the user. Snippet: ${contextSnippet}`;

        // Use LanguageModel if available
        if (lmAvailable) {
            const session = await LanguageModel.create({
                temperature: 0.7,
                topK: 3,
                initialPrompts: [{ role: 'system', content: 'You are a helpful shopping assistant who explains dark patterns.' }],
            });
            const response = await session.prompt(prompt);
            session.destroy();
            return response.trim();
        }

        // Fallback: Use window.ai
        if (aiAvailable) {
            const session = await (window as any).ai.createTextSession();
            const response = await session.prompt(prompt);
            session.destroy();
            return response.trim();
        }

        return 'This may be a deceptive design.';
    } catch (err) {
        console.warn('AI explainer error:', err);
        return 'This may be a deceptive design.';
    }
}
import { RiskSignal } from '../types';
interface AIRiskSignal {
    pattern: string;
    severity: 'low' | 'medium' | 'high';
    score: number;
    reason: string;
    details?: string;
    location?: string;
}

interface AILegitimacySignal {
    issue: string;
    severity: 'low' | 'medium' | 'high';
    score: number;
    reason: string;
    details?: string;
}

type AIResponse = AIRiskSignal[] | AILegitimacySignal[];
interface AICapabilities {
    available: 'readily' | 'after-download' | 'downloadable' | 'unavailable';
    defaultTemperature?: number;
    defaultTopK?: number;
    maxTopK?: number;
    maxTemperature?: number;
}

interface AISession {
    prompt: (text: string | any[], options?: any) => Promise<string>;
    promptStreaming: (text: string | any[]) => ReadableStream;
    destroy: () => void;
    clone: () => Promise<AISession>;
    inputUsage?: number;
    inputQuota?: number;
}

interface AISessionOptions {
    temperature?: number;
    topK?: number;
    initialPrompts?: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
    monitor?: (m: any) => void;
}

interface AILanguageModel {
    availability: () => Promise<AICapabilities>;
    params: () => Promise<{
        defaultTopK: number;
        maxTopK: number;
        defaultTemperature: number;
        maxTemperature: number;
    }>;
    create: (options?: AISessionOptions) => Promise<AISession>;
}

declare global {
    const LanguageModel: AILanguageModel;
}

export class AIService {
    private static session: AISession | null = null;
    private static isAvailable: boolean | null = null;
    private static aiCache: Map<string, { result: any[], timestamp: number }> = new Map();
    private static readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    /**
     * Generate a content hash for caching AI results
     */
    private static generateContentHash(content: any): string {
        const contentStr = JSON.stringify(content);
        let hash = 0;
        for (let i = 0; i < contentStr.length; i++) {
            const char = contentStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Get cached AI result if available and not expired
     */
    private static getCachedResult(cacheKey: string): any[] | null {
        const cached = this.aiCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
            console.log('♻️ Using cached AI result for:', cacheKey);
            return cached.result;
        }
        if (cached) {
            this.aiCache.delete(cacheKey); // Remove expired cache
        }
        return null;
    }

    /**
     * Cache AI result
     */
    private static setCachedResult(cacheKey: string, result: any[]): void {
        this.aiCache.set(cacheKey, { result, timestamp: Date.now() });
        if (this.aiCache.size > 50) {
            const oldestKey = this.aiCache.keys().next().value;
            if (oldestKey) {
                this.aiCache.delete(oldestKey);
            }
        }
    }

    /**
     * Check if Chrome's Built-in AI is available
     * Returns detailed status information
     */
    static async checkAvailability(): Promise<boolean> {
        try {
            // Check if LanguageModel global exists (NEW API)
            if (typeof LanguageModel === 'undefined') {
                console.log('❌ Chrome AI API not available - LanguageModel is undefined');
                console.log('💡 To enable AI:');
                console.log('   1. Use Chrome Canary 128+ or Chrome Dev');
                console.log('   2. Enable chrome://flags/#optimization-guide-on-device-model');
                console.log('   3. Enable chrome://flags/#prompt-api-for-gemini-nano');
                console.log('   4. Restart Chrome and wait for model download');
                this.isAvailable = false;
                return false;
            }

            const capabilities = await LanguageModel.availability();
            console.log('🤖 Chrome AI Capabilities:', capabilities);

            if (capabilities.available === 'unavailable') {
                console.log('❌ AI not available on this device');
                console.log('💡 Your device may not meet the requirements');
                this.isAvailable = false;
                return false;
            }

            if (capabilities.available === 'after-download') {
                console.log('⏳ AI model is downloadable but not yet downloaded');
                console.log('💡 Model will download on first use with user interaction');
                this.isAvailable = true; // Mark as available, will download on first session
                return true;
            }

            if (capabilities.available === 'downloadable') {
                console.log('⏳ AI model is downloadable');
                console.log('💡 Model will download on first use with user interaction');
                this.isAvailable = true; // Mark as available, will download on first session
                return true;
            }

            this.isAvailable = true; // Available readily
            return true;
        } catch (error) {
            console.error('❌ Error checking AI availability:', error);
            this.isAvailable = false;
            return false;
        }
    }

    /**
     * Initialize AI session with custom system prompt
     * Session persists across analyses
     */
    static async initializeSession(systemPrompt?: string): Promise<boolean> {
        try {
            // If session already exists, reuse it
            if (this.session) {
                console.log('♻️ Reusing existing AI session');
                return true;
            }

            const available = await this.checkAvailability();
            if (!available || typeof LanguageModel === 'undefined') {
                return false;
            }

            const defaultSystemPrompt = `You are a shopping safety expert AI assistant. Your role is to:
1. Analyze e-commerce websites for dark patterns and deceptive practices
2. Evaluate return policies, shipping policies, and terms of service
3. Identify security concerns and legitimacy issues
4. Provide clear, concise risk assessments

Be direct, factual, and focus on consumer protection. Format responses as JSON when requested.`;

            console.log('🔄 Creating new AI session...');

            const capabilities = await LanguageModel.availability();
            // Model is already downloaded if readily available or after-download (cached)
            const isAlreadyDownloaded = capabilities.available === 'readily' || capabilities.available === 'after-download';

            // NEW API: Use initialPrompts instead of systemPrompt
            // Add monitor to track download progress
            this.session = await LanguageModel.create({
                temperature: 0.9, // Lower temperature for more consistent analysis
                topK: 3,
                initialPrompts: [
                    {
                        role: 'system',
                        content: systemPrompt || defaultSystemPrompt,
                    },
                ],
                monitor(m: any) {
                    m.addEventListener('downloadprogress', (e: any) => {
                        // Only log download progress if actually downloading (not loading from cache)
                        if (!isAlreadyDownloaded) {
                            console.log(`📥 AI Model downloading: ${Math.round(e.loaded * 100)}%`);
                        }
                    });
                },
            });

            if (isAlreadyDownloaded) {
                console.log('✅ AI session created (model already downloaded)');
            } else {
                console.log('✅ AI session initialized (downloaded and will persist)');
            }
            return true;
        } catch (error: any) {
            // Handle "NotAllowedError" specifically - model is downloadable but needs user gesture
            if (error.name === 'NotAllowedError') {
                console.warn('⚠️ AI model download requires user interaction. Model will download when user clicks "Analyze"');
                this.isAvailable = false; // Mark as not available for now
                return false;
            }

            console.error('❌ Error initializing AI session:', error);
            this.session = null;
            return false;
        }
    }

    /**
     * Close AI session and cleanup
     */
    static destroySession(): void {
        if (this.session) {
            this.session.destroy();
            this.session = null;
            console.log('🔄 AI session destroyed');
        }
    }

    /**
     * Send a custom prompt using the persistent AI session
     * Used by RAG-based analysis functions
     */
    static async promptWithSession(prompt: string): Promise<string | null> {
        try {
            if (!this.session) {
                console.warn('⚠️ AI session not available');
                return null;
            }

            return await this.session.prompt(prompt);
        } catch (error) {
            console.warn('⚠️ Error sending prompt to AI session:', error);
            return null;
        }
    }

    /**
     * Analyze domain for impersonation and phishing using the persistent AI session
     * Uses existing session to avoid session conflicts
     * Incorporates trust signals to improve accuracy
     */
    static async analyzeDomain(
        domain: string,
        context?: {
            domain?: any;
            contact?: any;
            security?: any;
            policies?: any;
        }
    ): Promise<RiskSignal | null> {
        try {
            // If no session, AI is not available
            if (!this.session) {
                console.log(`🤖 [AI Domain] AI session not available`);
                return null;
            }

            console.log(`🤖 [AI Domain] Analyzing domain with AI: "${domain}"`);

            // Build context for the AI
            const trustSignals = context ? {
                domainAge: context.domain?.ageInDays ? `${context.domain.ageInDays} days` : 'unknown',
                hasEmail: context.contact?.hasEmail,
                hasPhone: context.contact?.hasPhoneNumber,
                hasAddress: context.contact?.hasPhysicalAddress,
                hasSocialMedia: (context.contact?.socialMediaProfiles?.length || 0) > 0,
                socialMediaCount: context.contact?.socialMediaProfiles?.length || 0,
                isHttps: context.security?.isHttps,
                hasPrivacyPolicy: context.policies?.hasPrivacyPolicy,
                hasReturnPolicy: context.policies?.hasReturnRefundPolicy,
            } : null;

            // Enhanced prompt with context
            let prompt = `You are a cybersecurity expert. Analyze this domain for phishing and impersonation: "${domain}"

IMPORTANT: Use context to determine if this is a LEGITIMATE business or SUSPICIOUS impersonation:
- Legitimate businesses have: email, phone, address, social media, HTTPS, clear policies
- Suspicious domains often LACK these trust signals OR mimic established brands`;

            if (trustSignals) {
                prompt += `

TRUST SIGNALS FOUND:
- Domain age: ${trustSignals.domainAge}
- Has email: ${trustSignals.hasEmail}
- Has phone: ${trustSignals.hasPhone}
- Has address: ${trustSignals.hasAddress}
- Social media: ${trustSignals.socialMediaCount} profiles
- HTTPS: ${trustSignals.isHttps}
- Privacy policy: ${trustSignals.hasPrivacyPolicy}
- Return policy: ${trustSignals.hasReturnPolicy}

GUIDELINES:
- If domain is 3+ years old WITH social media and contact info → likely LEGITIMATE (low risk)
- If domain mimics a well-known brand name → check if it's the REAL brand domain
- If domain has few/no trust signals AND looks like brand typo → SUSPICIOUS (impersonation)
- Factor in: Are the trust signals consistent with a real business or a scam?`;
            }

            prompt += `

Identify impersonation by checking:
1. Does it closely mimic a known, legitimate brand? (typosquatting, character substitution)
2. Are the trust signals inconsistent? (e.g., claims to be "official" but no contact info)
3. Does the domain structure look designed to deceive? (excessive hyphens, confusing characters)

CRITICAL: Only report impersonation if the domain appears to be MIMICKING a legitimate brand.
Do NOT report a legitimate business (even if newer or smaller) as impersonation just because it has a similar name.

Return ONLY valid JSON object (not array), no markdown:
{
  "mightImpersonate": "brand_name or null",
  "suspiciousPatterns": ["pattern1", "pattern2"],
  "riskLevel": "low|medium|high",
  "confidence": 0-100,
  "reasoning": "brief explanation considering context"
}`;

            const response = await this.session.prompt(prompt);
            console.log(`🤖 [AI Domain] Response:`, response);

            // Parse response as JSON object (not array)
            try {
                let parsed: any;
                try {
                    parsed = JSON.parse(response);
                } catch {
                    // Try to extract JSON from response
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        parsed = JSON.parse(jsonMatch[0]);
                    } else {
                        throw new Error('No JSON found');
                    }
                }
                
                const riskLevel = parsed.riskLevel || 'low';
                
                // Flag 1: Direct impersonation detected
                if (parsed.mightImpersonate) {
                    const signal: RiskSignal = {
                        id: `ai-domain-impersonation-${Date.now()}`,
                        score: riskLevel === 'high' ? 15 : riskLevel === 'medium' ? 10 : 5,
                        reason: `AI detected potential impersonation: ${parsed.mightImpersonate}`,
                        severity: riskLevel as 'low' | 'medium' | 'high',
                        category: 'security' as const,
                        source: 'ai' as const,
                        details: parsed.reasoning || parsed.suspiciousPatterns?.join(', '),
                    };
                    console.log(`🤖 [AI Domain] Signal generated (impersonation):`, signal);
                    return signal;
                }
                
                // Flag 2: Medium/High risk with missing trust signals (suspicious but not confirmed impersonation)
                // This catches phishing/scam attempts that don't mimic a specific brand
                if (riskLevel === 'medium' || riskLevel === 'high') {
                    const hasMissingTrustSignals = parsed.suspiciousPatterns?.some((p: string) => 
                        p.toLowerCase().includes('missing') || 
                        p.toLowerCase().includes('absence') || 
                        p.toLowerCase().includes('lack') ||
                        p.toLowerCase().includes('no email') ||
                        p.toLowerCase().includes('no phone') ||
                        p.toLowerCase().includes('no social')
                    );
                    
                    if (hasMissingTrustSignals) {
                        const signal: RiskSignal = {
                            id: `ai-domain-suspicious-${Date.now()}`,
                            score: riskLevel === 'high' ? 12 : 8,
                            reason: `AI flagged suspicious domain: Missing trust signals (no contact info/social media)`,
                            severity: riskLevel as 'low' | 'medium' | 'high',
                            category: 'security' as const,
                            source: 'ai' as const,
                            details: parsed.reasoning || parsed.suspiciousPatterns?.join(', '),
                        };
                        console.log(`🤖 [AI Domain] Signal generated (suspicious):`, signal);
                        return signal;
                    }
                }
                
                console.log(`🤖 [AI Domain] No impersonation or suspicious activity detected`);
                return null;
            } catch (parseError) {
                console.warn(`⚠️ [AI Domain] Failed to parse response:`, parseError);
                return null;
            }
        } catch (error) {
            console.error(`❌ [AI Domain] Error analyzing domain:`, error);
            return null;
        }
    }

    /**
     * Analyze text for dark patterns
     */
    static async analyzeDarkPatterns(pageContent: {
        url: string;
        title: string;
        headings: string[];
        buttons: string[];
        forms: string[];
        trustFactor?: number;
    }): Promise<RiskSignal[]> {
        try {
            // Check cache first
            const cacheKey = `dark_${this.generateContentHash(pageContent)}`;
            const cachedResult = this.getCachedResult(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }

            // Seed lightweight local KB (no-op if already seeded)
            const { VectorService, embedTextLocal } = await import('./vector');
            await VectorService.seedIfEmpty();

            const initialized = await this.initializeSession();
            if (!initialized || !this.session) {
                console.log('⚠️ AI not available, skipping dark pattern analysis');
                return [];
            }

            // Retrieval: create a compact query from page signals
            const queryVec = embedTextLocal([
                pageContent.title,
                pageContent.headings.slice(0, 5).join(' '),
                pageContent.buttons.slice(0, 8).join(' ')
            ].join(' '));
            const retrieved = await VectorService.search(queryVec, { topK: 4, threshold: 0.3 });

            // Build minimal, targeted prompt using retrieved exemplars
            const contextLines = retrieved.map(r =>
                `- ${r.it.meta.kind}: ${r.it.meta.pattern || r.it.meta.label} — ${r.it.meta.description || r.it.meta.notes || ''}`
            );

            const prompt = `Analyze dark patterns with retrieved context.
Context:
${contextLines.join('\n')}

URL: ${pageContent.url}
Title: ${pageContent.title}
Headings: ${pageContent.headings.slice(0, 10).join(', ')}
Buttons: ${pageContent.buttons.slice(0, 15).join(', ')}
Forms: ${pageContent.forms.slice(0, 5).join(', ')}

Trust Context: Factor=${pageContent.trustFactor !== undefined ? pageContent.trustFactor.toFixed(2) : 'Unknown'}/1.0

⭐ CRITICAL RULES FOR DARK PATTERNS:

RULE 1 - ESTABLISHED RETAILER (trustFactor > 0.8):
Even established retailers like Amazon/Walmart use marketing tactics (flash sales, urgency, discounts).
These are NORMAL retail practices, not dark patterns.
Only flag if DECEPTIVE:
  - Fake countdown timers (claim 3 items left, then restock)
  - Bait & switch (advertised product unavailable, forced to buy alternative)
  - Hidden mandatory fees (not just disclosed shipping)
  - Trick questions (auto-checked subscriptions)
Do NOT flag: Flash deals, percentage discounts, "Was" prices, limited-time offers (normal retail)

RULE 2 - NEW/UNKNOWN SITE (trustFactor < 0.5):
Apply maximum scrutiny. Even normal marketing tactics are suspicious.
Flag aggressively: ANY urgency pressure, ANY cost opacity, ANY friction to cancel.

RULE 3 - SCORING:
For ESTABLISHED SITES (trustFactor > 0.8):
  - False urgency score: max 2-3 (not 5-10)
  - Bait/switch score: max 2-3 if not severe
  - Hidden costs: only flag actual hidden fees, NOT shipping disclosure
For NEW SITES (trustFactor < 0.5):
  - False urgency score: 8-10 (maximum concern)
  - Any opacity: score high

RULE 4 - INDUSTRY-SPECIFIC PATTERNS:

E-COMMERCE / RETAIL (indicators: "shop", "cart", "buy", "price", "product", "store"):
  Do NOT flag as dark patterns:
  - Flash sales / limited-time offers
  - Countdown timers showing deal duration
  - "Limited quantity" messaging
  - "Was $X now $Y" pricing
  - "Best seller" or "Popular" badges
  - Free shipping offers with conditions
  DO flag as dark patterns:
  - Product unavailable after ad (forcing alternative purchase)
  - Out-of-stock items promoted heavily
  - Shipping cost hidden until final checkout
  - Quantity limitations not visible upfront

SaaS / SERVICE (indicators: "free trial", "subscribe", "plan", "features", "sign up"):
  Do NOT flag:
  - Feature upgrade prompts
  - "Start free trial" CTAs
  - Plan comparison displays
  DO flag as dark patterns:
  - Free trial auto-converts to paid without warning
  - Cancel button hidden or hard to find
  - Auto-renewal without advance reminder
  - Features marked "Free" but are paid
  - Difficult multi-step cancellation process

Identify any dark patterns such as:
- False urgency (fake scarcity, countdown timers)
- Forced continuity (hard to cancel subscriptions)
- Hidden costs (surprise fees at checkout)
- Trick questions (confusing opt-out checkboxes)
- Bait and switch (misleading product descriptions)
- Confirmshaming (guilt-tripping language)

IMPORTANT: Return ONLY valid JSON array, no other text or markdown.
Format:
[
  {
    "pattern": "pattern name",
    "severity": "low",
    "score": 5,
    "reason": "brief description",
    "details": "specific evidence",
    "location": "where found"
  }
]

If no patterns found, return: []

No markdown code blocks, no explanations, JSON only.`;

            const response = await this.session.prompt(prompt);
            console.log('🤖 AI Dark Pattern Analysis:', response);

            // Parse AI response
            const findings: AIResponse = this.parseAIResponse(response);

            // Sort by score (highest first) to prioritize major issues
            const sortedFindings = (findings as AIRiskSignal[]).sort((a, b) => (b.score || 0) - (a.score || 0));

            // Convert to RiskSignal format (limit to top 5)
            const result = sortedFindings.slice(0, 5).map((finding, index: number) => ({
                id: `ai-dark-${index + 1}`,
                score: finding.score,
                reason: finding.reason,
                severity: finding.severity as 'low' | 'medium' | 'high',
                category: 'dark-pattern' as const,
                source: 'ai' as const,
                details: finding.details,
            }));

            // Cache the result
            this.setCachedResult(cacheKey, result);

            return result;
        } catch (error) {
            console.error('❌ Error analyzing dark patterns:', error);
            return [];
        }
    }

    /**
     * Analyze overall page legitimacy with full context
     */
    static async analyzeLegitimacy(pageData: {
        url: string;
        title: string;
        content: string;
        hasHTTPS: boolean;
        hasContactInfo: boolean;
        hasPolicies: boolean;
        // Enhanced social media context
        socialMedia?: {
            facebook?: string | null;
            twitter?: string | null;
            instagram?: string | null;
            linkedin?: string | null;
            youtube?: string | null;
            count?: number;
        };
        // Domain intelligence from WHOIS
        domainAge?: number | null;
        domainAgeYears?: number | null;
        domainStatus?: string[] | null;
        domainRegistrar?: string | null;
        // Trust factor calculated from domain age
        trustFactor?: number;
    }): Promise<RiskSignal[]> {
        try {
            // Check cache first
            const cacheKey = `legit_${this.generateContentHash(pageData)}`;
            const cachedResult = this.getCachedResult(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }

            const { VectorService, embedTextLocal } = await import('./vector');
            await VectorService.seedIfEmpty();
            const initialized = await this.initializeSession();
            if (!initialized || !this.session) {
                console.log('⚠️ AI not available, skipping legitimacy analysis');
                return [];
            }

            // Build context-aware prompt with all available intelligence
            const domainInfo = pageData.domainAge !== undefined && pageData.domainAge !== null
                ? `Domain Age: ${pageData.domainAge} days (${pageData.domainAgeYears || Math.floor(pageData.domainAge / 365)} years)
Domain Registrar: ${pageData.domainRegistrar || 'Unknown'}
Domain Protection: ${pageData.domainStatus?.length || 0} status flags${
    pageData.domainStatus && pageData.domainStatus.length > 0
        ? ` (${pageData.domainStatus.slice(0, 3).join(', ')})`
        : ''
}`
                : '⚠️ DOMAIN AGE UNKNOWN - Exercise extra caution! Unable to verify domain registration details. This could indicate a new or suspicious domain.';

            const socialInfo = pageData.socialMedia
                ? `Social Media Links Found:
- Facebook: ${pageData.socialMedia.facebook ? '✓ Found' : '✗ Not found'}
- Twitter/X: ${pageData.socialMedia.twitter ? '✓ Found' : '✗ Not found'}
- Instagram: ${pageData.socialMedia.instagram ? '✓ Found' : '✗ Not found'}
- LinkedIn: ${pageData.socialMedia.linkedin ? '✓ Found' : '✗ Not found'}
- Total Social Platforms: ${pageData.socialMedia.count || 0}`
                : 'Social Media: Unknown';

            // Retrieval for legitimacy cases
            const legitimacySignals = [
                pageData.hasHTTPS ? 'https' : 'no https',
                pageData.hasContactInfo ? 'contact present' : 'contact missing',
                pageData.hasPolicies ? 'policies present' : 'policies missing',
                `domain age ${pageData.domainAge ?? 'unknown'}`,
                `social ${pageData.socialMedia?.count ?? 0}`,
                pageData.domainRegistrar || 'registrar unknown'
            ].join(' ');
            const qv = embedTextLocal(legitimacySignals);
            const retrieved = await VectorService.search(qv, { topK: 3, threshold: 0.3 });
            const contextLines = retrieved.map(r => `- ${r.it.meta.kind}: ${r.it.meta.label} — ${r.it.meta.notes}`);

            const prompt = `Evaluate legitimacy using retrieved cases.
Context:
${contextLines.join('\n')}

Evaluate the legitimacy of this e-commerce website:

URL: ${pageData.url}
Title: ${pageData.title}

🔒 Security:
- HTTPS: ${pageData.hasHTTPS ? 'Yes' : 'No'}
- Contact Info: ${pageData.hasContactInfo ? 'Found' : 'Missing'}
- Policies: ${pageData.hasPolicies ? 'Present' : 'Absent'}

🌐 Domain Intelligence:
${domainInfo}

📱 ${socialInfo}

📄 Content Sample: ${pageData.content.slice(0, 400)}

⚠️ VIGILANCE PROTOCOL: If domain age is unknown, significantly increase scrutiny of ALL other factors. Missing domain data often indicates new/suspicious domains that require extra verification.

⭐ CONTEXT-AWARE RULES (TRUST-BASED):

Trust Factor: ${pageData.trustFactor !== undefined ? pageData.trustFactor.toFixed(2) : 'Unknown'}/1.0

RULE 1 - ESTABLISHED SITE:
IF domainAge > 1095 days (3+ years) THEN
  - Don't flag "missing social media" as a concern
  - Apply 90% dampening to legitimacy concerns like "missing links"
  - Only flag true security issues

RULE 2 - NEW SITE:
IF domainAge < 180 days (<6 months) THEN
  - Apply maximum scrutiny to all signals
  - Flag ANY missing security features
  - Missing contact or policies = HIGH severity

RULE 3 - INDUSTRY-SPECIFIC LEGITIMACY REQUIREMENTS:

E-COMMERCE RETAIL (keywords: "shop", "buy", "product", "cart", "price"):
  Must have:
  - HTTPS certificate ✓
  - Contact information ✓
  - Return policy (if not: score 10)
  - Refund policy (if not: score 10)
  - Shipping policy (if not: score 8)
  Don't require: Extensive social media, "About us" page, customer reviews

SaaS / SERVICES (keywords: "free trial", "subscribe", "plan", "features"):
  Must have:
  - HTTPS certificate ✓
  - Privacy policy (if not: score 25)
  - Terms of service (if not: score 20)
  - Contact method ✓
  - Trial cancellation information (if not: score 15)
  Don't require: Physical address, return policy, shipping info

CONTENT / PUBLISHING (keywords: "blog", "article", "news", "subscribe"):
  Must have:
  - HTTPS certificate ✓
  - Author/About information
  - Privacy policy (if not: score 15)
  - Contact info (if not: score 8)
  Don't require: Return policies, SaaS-level compliance

ALWAYS RED FLAGS (any site type):
- No HTTPS (score 25+)
- Domain expiring very soon (score 30+)
- Phone number invalid (score 12)
- All contact methods fake or non-functional (score 20+)
- No way to contact support (score 15+)

Security: HTTPS=${pageData.hasHTTPS}, Contact=${pageData.hasContactInfo}, Policies=${pageData.hasPolicies}
Domain: ${domainInfo}
Social: ${socialInfo}

Return JSON array (max 5 concerns, highest severity/score first):
[{"concern":"name","severity":"low|medium|high","score":1-40,"reason":"why","details":"evidence"}]

If strong trust signals, return: []
JSON only, no markdown.`;

            const response = await this.session.prompt(prompt);
            console.log('🤖 AI Legitimacy Analysis:', response);

            const concerns: AIResponse = this.parseAIResponse(response);

            // Sort by score (highest first) to prioritize major issues
            const sortedConcerns = (concerns as AILegitimacySignal[]).sort((a, b) => (b.score || 0) - (a.score || 0));

            // Limit to top 5 concerns to prevent token overflow
            const result = sortedConcerns.slice(0, 5).map((concern, index: number) => ({
                id: `ai-legit-${index + 1}`,
                score: concern.score,
                reason: concern.reason,
                severity: concern.severity as 'low' | 'medium' | 'high',
                category: 'legitimacy' as const,
                source: 'ai' as const,
                details: concern.details,
            }));

            // Cache the result
            this.setCachedResult(cacheKey, result);

            return result;
        } catch (error) {
            console.error('❌ Error analyzing legitimacy:', error);
            return [];
        }
    }

    /**
     * Parse AI response (handle both JSON and text responses)
     */
    private static parseAIResponse(response: string): AIResponse {
        try {
            // Remove markdown code blocks if present
            let cleaned = response.trim();
            cleaned = cleaned.replace(/```json\s*/g, '');
            cleaned = cleaned.replace(/```\s*/g, '');
            cleaned = cleaned.trim();

            // Try direct JSON parse first
            try {
                return JSON.parse(cleaned);
            } catch {
                // If that fails, try to extract JSON
                let extracted = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/)?.[0];
                
                if (!extracted) {
                    console.warn('⚠️ No JSON structure found in response');
                    return [];
                }

                // ROBUST FIX: Handle unescaped quotes inside string values
                // Replace unescaped quotes that appear between colons and commas/closing brackets
                // Example: "reason": "text with "quotes" inside" → "reason": "text with \"quotes\" inside"
                extracted = extracted.replace(/: "([^"]*(?:\\"[^"]*)*)"(?=[,}\]])/g, (match) => {
                    // Get the string content (between first and last quote)
                    const stringContent = match.slice(3, -1); // Remove ': "' and last '"'
                    // Escape any unescaped quotes
                    const fixed = stringContent.replace(/(?<!\\)"/g, '\\"');
                    return `: "${fixed}"`;
                });
                
                // Additional fix for values with mixed quotes
                // This handles cases like: "reason": "...text with \"escaped\" and "unescaped" quotes..."
                extracted = extracted.replace(/: "([^"]*(?:\\"[^"]*)*)"(?=[,}\]])/g, (match) => {
                    const start = match.indexOf('"') + 1; // Position after opening "
                    const stringContent = match.substring(start, match.lastIndexOf('"'));
                    // Replace unescaped quotes with escaped quotes, but be careful not to double-escape
                    const fixed = stringContent.replace(/(?<!\\)"/g, '\\"');
                    return `: "${fixed}"`;
                });
                
                // 2. Remove trailing commas before closing brackets
                extracted = extracted.replace(/,(\s*[}\]])/g, '$1');
                
                // 3. Fix unquoted keys (basic attempt)
                extracted = extracted.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                
                // Handle truncated JSON - try to close incomplete objects/arrays
                if (extracted.includes('{') && !extracted.endsWith('}') && !extracted.endsWith(']')) {
                    const lastColonIndex = extracted.lastIndexOf(':');
                    const afterLastColon = extracted.substring(lastColonIndex);
                    const quotesAfterColon = (afterLastColon.match(/"/g) || []).length;
                    
                    // If odd number of quotes, we're inside an incomplete string - close it
                    if (quotesAfterColon % 2 !== 0) {
                        extracted += '"';
                    }
                    
                    // Count open vs closed braces
                    const openBraces = (extracted.match(/\{/g) || []).length;
                    const closeBraces = (extracted.match(/\}/g) || []).length;
                    const openBrackets = (extracted.match(/\[/g) || []).length;
                    const closeBrackets = (extracted.match(/\]/g) || []).length;
                    
                    // Try to close missing braces/brackets
                    for (let i = 0; i < (openBraces - closeBraces); i++) {
                        extracted += '}';
                    }
                    for (let i = 0; i < (openBrackets - closeBrackets); i++) {
                        extracted += ']';
                    }
                    
                    console.warn('⚠️ Attempted to fix truncated JSON response');
                }

                return JSON.parse(extracted);
            }

            // If no JSON found, return empty array
            console.warn('⚠️ No valid JSON found in AI response');
            console.warn('Response preview:', response.slice(0, 200));
            return [];
        } catch (error) {
            console.error('❌ Error parsing AI response:', error);
            console.error('Response that failed:', response.slice(0, 500));
            // Return empty array instead of throwing - graceful degradation
            return [];
        }
    }

    /**
     * Get AI availability status
     */
    static isAIAvailable(): boolean {
        return this.isAvailable === true;
    }
}
