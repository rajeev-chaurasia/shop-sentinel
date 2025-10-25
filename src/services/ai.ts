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
     * Analyze text for dark patterns
     */
    static async analyzeDarkPatterns(pageContent: {
        url: string;
        title: string;
        headings: string[];
        buttons: string[];
        forms: string[];
    }): Promise<RiskSignal[]> {
        try {
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
            return sortedFindings.slice(0, 5).map((finding, index: number) => ({
                id: `ai-dark-${index + 1}`,
                score: finding.score,
                reason: finding.reason,
                severity: finding.severity as 'low' | 'medium' | 'high',
                category: 'dark-pattern' as const,
                source: 'ai' as const,
                details: finding.details,
            }));
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
    }): Promise<RiskSignal[]> {
        try {
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
                : 'Domain Age: Unknown';

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

⭐ CRITICAL CONTEXT-AWARE RULES:

Security: HTTPS=${pageData.hasHTTPS}, Contact=${pageData.hasContactInfo}, Policies=${pageData.hasPolicies}
Domain: ${domainInfo}
Social: ${socialInfo}

Context Rules:
- Old domains (>5yr + 3+ flags): Missing social = LOW concern
- New domains (<180d + <2 flags): Missing social = HIGH concern
- Protection flags = trust indicator (0-1=low, 3-5=good, 6=max)

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
            return sortedConcerns.slice(0, 5).map((concern, index: number) => ({
                id: `ai-legit-${index + 1}`,
                score: concern.score,
                reason: concern.reason,
                severity: concern.severity as 'low' | 'medium' | 'high',
                category: 'legitimacy' as const,
                source: 'ai' as const,
                details: concern.details,
            }));
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
                const jsonMatch = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
                if (jsonMatch) {
                    let extracted = jsonMatch[0];

                    // Fix common JSON issues
                    // Remove trailing commas before closing brackets
                    extracted = extracted.replace(/,(\s*[}\]])/g, '$1');
                    // Fix unquoted keys (basic attempt)
                    extracted = extracted.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                    
                    // Handle truncated JSON - try to close incomplete objects/arrays
                    if (extracted.includes('{') && !extracted.endsWith('}') && !extracted.endsWith(']')) {
                        // Check if we're inside an incomplete string (odd number of quotes after last colon)
                        const lastColonIndex = extracted.lastIndexOf(':');
                        const afterLastColon = extracted.substring(lastColonIndex);
                        const quotesAfterColon = (afterLastColon.match(/"/g) || []).length;
                        
                        // If odd number of quotes, we're inside an incomplete string - close it
                        if (quotesAfterColon % 2 !== 0) {
                            extracted += '"';
                        }
                        
                        // Remove any trailing incomplete content after last complete object
                        // Look for last complete property (ends with " or } or ])
                        const lastCompleteMatch = extracted.match(/["\}\]]\s*$/);
                        if (!lastCompleteMatch) {
                            // Find the last comma, closing brace, or opening brace before truncation
                            const lastSafeIndex = Math.max(
                                extracted.lastIndexOf('",'),
                                extracted.lastIndexOf('},'),
                                extracted.lastIndexOf('"}'),
                                extracted.lastIndexOf(']')
                            );
                            
                            if (lastSafeIndex > 0) {
                                // Truncate to last safe point
                                extracted = extracted.substring(0, lastSafeIndex + 1);
                            }
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
