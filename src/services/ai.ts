import { RiskSignal } from '../types';

// Chrome Built-in AI Prompt API types (NEW API)
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
     * Check if Chrome's Built-in AI is available with enhanced error reporting
     */
    static async checkAvailability(): Promise<{
        available: boolean;
        status: 'ready' | 'downloading' | 'downloadable' | 'unavailable' | 'unsupported';
        error?: string;
        userMessage?: string;
    }> {
        try {
            // Check if LanguageModel global exists (NEW API)
            if (typeof LanguageModel === 'undefined') {
                const error = 'Chrome AI API not available - LanguageModel is undefined';
                console.log('❌', error);
                console.log('💡 To enable AI:');
                console.log('   1. Use Chrome Canary 128+ or Chrome Dev');
                console.log('   2. Enable chrome://flags/#optimization-guide-on-device-model');
                console.log('   3. Enable chrome://flags/#prompt-api-for-gemini-nano');
                console.log('   4. Restart Chrome and wait for model download');
                
                this.isAvailable = false;
                return {
                    available: false,
                    status: 'unsupported',
                    error,
                    userMessage: 'AI requires Chrome Canary with experimental flags enabled'
                };
            }

            const capabilities = await LanguageModel.availability();
            console.log('🤖 Chrome AI Capabilities:', capabilities);
            console.log('🔍 Capabilities type:', typeof capabilities);
            
            // Handle different possible structures of capabilities
            let availabilityStatus;
            if (typeof capabilities === 'string') {
                // capabilities is directly a string
                availabilityStatus = capabilities;
                console.log('🔍 Available status (string):', availabilityStatus);
            } else if (typeof capabilities === 'object' && capabilities !== null) {
                // capabilities is an object with an available property
                availabilityStatus = capabilities.available;
                console.log('🔍 Available status (object):', availabilityStatus);
                console.log('🔍 Available type:', typeof availabilityStatus);
            } else {
                // Fallback: assume available if we can't determine
                availabilityStatus = 'readily';
                console.log('⚠️ Unknown capabilities structure, assuming readily available');
            }
            
            // Check if AI is available (any status other than 'unavailable')
            if (availabilityStatus === 'unavailable') {
                const error = 'AI not available on this device';
                console.log('❌', error);
                console.log('💡 Your device may not meet the requirements');
                this.isAvailable = false;
                return {
                    available: false,
                    status: 'unavailable',
                    error,
                    userMessage: 'Your device does not support Chrome AI'
                };
            }

            // If we get here, AI should be available in some form
            this.isAvailable = true;
            
            switch (availabilityStatus) {
                case 'readily':
                case 'available': // Handle direct 'available' status from newer API
                    return {
                        available: true,
                        status: 'ready',
                        userMessage: 'AI model ready for analysis'
                    };

                case 'after-download':
                    console.log('⏳ AI model downloaded but needs initialization');
                    return {
                        available: true,
                        status: 'downloadable',
                        userMessage: 'AI model will initialize on first use'
                    };

                case 'downloadable':
                    console.log('⏳ AI model needs to be downloaded');
                    return {
                        available: true,
                        status: 'downloadable',
                        userMessage: 'AI model will download on first use (may take time)'
                    };

                default:
                    // Handle unknown status - assume available
                    console.log('⚠️ Unknown AI availability status:', availabilityStatus, 'assuming available');
                    return {
                        available: true,
                        status: 'ready',
                        userMessage: `AI available with status: ${availabilityStatus}`
                    };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error('❌ Error checking AI availability:', error);
            this.isAvailable = false;
            return {
                available: false,
                status: 'unavailable',
                error: errorMsg,
                userMessage: 'Failed to check AI availability'
            };
        }
    }

    /**
     * Simple availability check for backward compatibility
     */
    static async isAIReady(): Promise<boolean> {
        const status = await this.checkAvailability();
        return status.available;
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

            const availabilityStatus = await this.checkAvailability();
            if (!availabilityStatus.available || typeof LanguageModel === 'undefined') {
                console.log('⚠️ AI not available for session initialization:', availabilityStatus);
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
            console.log('🔧 Session creation capabilities:', capabilities);
            
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

            console.log('✅ AI session created successfully');
            return true;
        } catch (error: any) {
            console.error('❌ Error initializing AI session:', error);
            console.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack?.split('\n')[0]
            });
            
            // Handle "NotAllowedError" specifically - model is downloadable but needs user gesture
            if (error.name === 'NotAllowedError') {
                console.warn('⚠️ AI model download requires user interaction. Model will download when user clicks "Analyze"');
                this.isAvailable = false; // Mark as not available for now
                return false;
            }

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
     * Analyze page content for dark patterns with enhanced prompt engineering
     */
    static async analyzeDarkPatterns(pageContent: {
        url: string;
        title: string;
        headings: string[];
        buttons: string[];
        forms: string[];
        pageType?: string;
    }): Promise<RiskSignal[]> {
        try {
            const initialized = await this.initializeSession();
            if (!initialized || !this.session) {
                console.log('⚠️ AI not available, skipping dark pattern analysis');
                return [];
            }

            // Enhanced prompt with better context and stricter validation
            const prompt = this.constructDarkPatternPrompt(pageContent);
            const response = await this.session.prompt(prompt, { language: 'en' });
            
            console.log('🤖 AI Dark Pattern Analysis Response:', response?.slice(0, 200) + '...');

            // Enhanced parsing with validation
            const findings = this.parseAndValidateDarkPatterns(response);

            // Convert to RiskSignal format with validation
            return findings
                .filter(finding => this.isValidDarkPatternFinding(finding))
                .map((finding: any, index: number) => ({
                    id: `ai-dark-${index + 1}`,
                    score: Math.min(50, Math.max(1, finding.score || 10)), // Clamp score
                    reason: finding.reason || 'Dark pattern detected',
                    severity: this.normalizeSeverity(finding.severity) as 'low' | 'medium' | 'high',
                    category: 'dark-pattern' as const,
                    source: 'ai' as const,
                    details: finding.details || finding.evidence || 'Detected by AI analysis',
                }));
        } catch (error) {
            console.error('❌ Error analyzing dark patterns:', error);
            return [];
        }
    }

    /**
     * Construct enhanced dark pattern analysis prompt
     */
    private static constructDarkPatternPrompt(pageContent: {
        url: string;
        title: string;
        headings: string[];
        buttons: string[];
        forms: string[];
        pageType?: string;
    }): string {
        const contextualInstructions = pageContent.pageType === 'checkout' 
            ? 'Focus on checkout-specific dark patterns: hidden fees, forced subscriptions, default opt-ins.'
            : pageContent.pageType === 'product'
            ? 'Focus on product page dark patterns: fake scarcity, misleading reviews, bait-and-switch.'
            : 'Analyze all common e-commerce dark patterns.';

        return `You are an expert in identifying deceptive e-commerce practices. Analyze this ${pageContent.pageType || 'e-commerce'} page for dark patterns.

PAGE CONTEXT:
URL: ${pageContent.url}
Title: ${pageContent.title}
Page Type: ${pageContent.pageType || 'unknown'}

CONTENT ANALYSIS:
Headings: ${pageContent.headings.slice(0, 12).join(' | ')}
Buttons: ${pageContent.buttons.slice(0, 20).join(' | ')}
Forms: ${pageContent.forms.slice(0, 8).join(' | ')}

ANALYSIS INSTRUCTIONS:
${contextualInstructions}

Look for these specific patterns:
1. False Urgency: "Only 2 left!", fake countdown timers, "Limited time offer"
2. Forced Continuity: Auto-renewal defaults, hard-to-find cancel options
3. Hidden Costs: Surprise fees at checkout, mandatory add-ons
4. Trick Questions: Confusing opt-out checkboxes, double negatives
5. Confirmshaming: "No thanks, I don't want to save money"
6. Bait & Switch: Misleading prices, different product at checkout
7. Social Proof Manipulation: Fake reviews, "people are viewing"

RESPONSE FORMAT - RETURN ONLY VALID JSON:
[
  {
    "pattern": "false_urgency",
    "severity": "medium",
    "score": 15,
    "reason": "Fake scarcity claim without verification",
    "details": "Button text claims 'Only 2 left' but no inventory verification visible",
    "evidence": "specific text or element found"
  }
]

VALIDATION RULES:
- severity: must be "low", "medium", or "high"
- score: integer between 1-50
- Only include patterns you're confident about (>70% certainty)
- If no patterns found, return: []

Return JSON only, no markdown, no explanations.`;
    }

    /**
     * Parse and validate dark pattern findings with enhanced error handling
     */
    private static parseAndValidateDarkPatterns(response: string): any[] {
        try {
            const parsed = this.parseAIResponse(response);
            
            if (!Array.isArray(parsed)) {
                console.warn('⚠️ Dark pattern response not an array, attempting to wrap');
                return parsed ? [parsed] : [];
            }

            return parsed.filter(item => {
                if (!item || typeof item !== 'object') return false;
                
                // Validate required fields
                const hasRequiredFields = item.pattern || item.reason;
                const hasValidSeverity = ['low', 'medium', 'high'].includes(item.severity);
                const hasValidScore = typeof item.score === 'number' && item.score > 0 && item.score <= 50;

                if (!hasRequiredFields || !hasValidSeverity || !hasValidScore) {
                    console.warn('⚠️ Filtering out invalid dark pattern finding:', item);
                    return false;
                }

                return true;
            });
        } catch (error) {
            console.error('❌ Error parsing dark patterns:', error);
            return [];
        }
    }

    /**
     * Validate individual dark pattern finding
     */
    private static isValidDarkPatternFinding(finding: any): boolean {
        return (
            finding &&
            typeof finding === 'object' &&
            (finding.pattern || finding.reason) &&
            ['low', 'medium', 'high'].includes(finding.severity) &&
            typeof finding.score === 'number' &&
            finding.score > 0 &&
            finding.score <= 50
        );
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
            const initialized = await this.initializeSession();
            if (!initialized || !this.session) {
                console.log('⚠️ AI not available, skipping legitimacy analysis');
                return [];
            }

            // Build context-aware prompt with all available intelligence
            const domainInfo = pageData.domainAge !== undefined && pageData.domainAge !== null
                ? `Domain Age: ${pageData.domainAge} days (${pageData.domainAgeYears || Math.floor(pageData.domainAge / 365)} years)
Domain Registrar: ${pageData.domainRegistrar || 'Unknown'}
Domain Protection: ${pageData.domainStatus?.length || 0} status flags${pageData.domainStatus && pageData.domainStatus.length > 0 ? ` (${pageData.domainStatus.slice(0, 3).join(', ')})` : ''}`
                : 'Domain Age: Unknown';

            const socialInfo = pageData.socialMedia
                ? `Social Media Links Found:
- Facebook: ${pageData.socialMedia.facebook ? '✓ Found' : '✗ Not found'}
- Twitter/X: ${pageData.socialMedia.twitter ? '✓ Found' : '✗ Not found'}
- Instagram: ${pageData.socialMedia.instagram ? '✓ Found' : '✗ Not found'}
- LinkedIn: ${pageData.socialMedia.linkedin ? '✓ Found' : '✗ Not found'}
- Total Social Platforms: ${pageData.socialMedia.count || 0}`
                : 'Social Media: Unknown';

            // Enhanced legitimacy analysis prompt with better structure
            const prompt = this.constructLegitimacyPrompt(pageData, domainInfo, socialInfo);

            const response = await this.session.prompt(prompt, { language: 'en' });
            console.log('🤖 AI Legitimacy Analysis:', response);

            const concerns = this.parseAIResponse(response);

            return concerns.map((concern: any, index: number) => ({
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
     * Construct enhanced legitimacy analysis prompt
     */
    private static constructLegitimacyPrompt(
        pageData: {
            url: string;
            title: string;
            content: string;
            hasHTTPS: boolean;
            hasContactInfo: boolean;
            hasPolicies: boolean;
            socialMedia?: any;
            domainAge?: number | null;
            domainAgeYears?: number | null;
            domainStatus?: string[] | null;
            domainRegistrar?: string | null;
        },
        domainInfo: string,
        socialInfo: string
    ): string {
        const trustLevel = this.assessDomainTrustLevel(pageData);
        
        return `You are a cybersecurity expert specializing in e-commerce fraud detection. Analyze this website's legitimacy using advanced risk assessment.

WEBSITE PROFILE:
URL: ${pageData.url}
Title: ${pageData.title}
Trust Level: ${trustLevel.level} (${trustLevel.reasoning})

SECURITY BASELINE:
- HTTPS: ${pageData.hasHTTPS ? '✅ Secure' : '❌ INSECURE'}
- Contact Info: ${pageData.hasContactInfo ? '✅ Available' : '❌ Missing'}
- Policies: ${pageData.hasPolicies ? '✅ Present' : '❌ Absent'}

DOMAIN INTELLIGENCE:
${domainInfo}

SOCIAL PRESENCE:
${socialInfo}

CONTENT SAMPLE:
${pageData.content.slice(0, 600)}

ANALYSIS FRAMEWORK:

🏆 ESTABLISHED BUSINESS INDICATORS (Domain age >3 years):
- Missing social media = LOW concern (may not link all platforms)
- Focus on security, policies, and contact information
- Premium registrars (MarkMonitor, CSC) = High trust

🚨 NEW BUSINESS RED FLAGS (Domain age <6 months):
- Missing social media = HIGH concern
- Missing contact info = CRITICAL concern
- Minimal domain protection = HIGH concern
- Combination of above = SCAM LIKELY

🔍 CONTEXTUAL ASSESSMENT RULES:
1. B2B sites may have minimal social presence (acceptable)
2. Enterprise brands may not link social media on all pages
3. Protection flags (clientDeleteProhibited) indicate investment in security
4. Premium registrars indicate serious business commitment

RESPONSE REQUIREMENTS:
- Only flag legitimate concerns based on FULL context
- Don't penalize established businesses for minor omissions
- Focus on patterns that indicate ACTUAL fraud risk
- Be conservative with scoring (max 30 per issue)

Return ONLY valid JSON array:
[
  {
    "concern": "specific_issue_name",
    "severity": "low"|"medium"|"high",
    "score": 1-30,
    "reason": "Clear explanation of the concern",
    "details": "Specific evidence supporting this assessment"
  }
]

If analysis shows STRONG trust signals, return: []
If analysis shows WEAK trust signals, flag specific concerns.

JSON only, no markdown, no explanations.`;
    }

    /**
     * Assess domain trust level for context-aware analysis
     */
    private static assessDomainTrustLevel(pageData: {
        domainAge?: number | null;
        domainStatus?: string[] | null;
        domainRegistrar?: string | null;
        hasHTTPS: boolean;
        hasContactInfo: boolean;
    }): { level: string; reasoning: string } {
        const age = pageData.domainAge || 0;
        const protectionFlags = pageData.domainStatus?.length || 0;
        const premiumRegistrar = ['markmonitor', 'csc', 'brand registry'].some(reg => 
            pageData.domainRegistrar?.toLowerCase().includes(reg)
        );

        if (age > 1825 && protectionFlags >= 3) { // 5+ years, good protection
            return { level: 'HIGH', reasoning: 'Established domain with strong protection' };
        }
        
        if (age > 1095 && (protectionFlags >= 2 || premiumRegistrar)) { // 3+ years
            return { level: 'MEDIUM-HIGH', reasoning: 'Mature domain with decent protection' };
        }
        
        if (age > 365) { // 1+ year
            return { level: 'MEDIUM', reasoning: 'Moderately established domain' };
        }
        
        if (age > 90) { // 3+ months
            return { level: 'MEDIUM-LOW', reasoning: 'Relatively new domain' };
        }
        
        return { level: 'LOW', reasoning: 'Very new or unknown domain age' };
    }

    /**
     * Normalize severity to valid values
     */
    private static normalizeSeverity(severity: string): 'low' | 'medium' | 'high' {
        if (!severity || typeof severity !== 'string') return 'low';
        
        const normalized = severity.toLowerCase().trim();
        
        if (['high', 'critical', 'severe'].includes(normalized)) return 'high';
        if (['medium', 'moderate', 'warning'].includes(normalized)) return 'medium';
        return 'low'; // Default fallback
    }

    /**
     * Parse AI response with enhanced error handling and validation
     */
    private static parseAIResponse(response: string): any {
        try {
            // Remove markdown code blocks if present
            let cleaned = response.trim();
            cleaned = cleaned.replace(/```json\s*/g, '');
            cleaned = cleaned.replace(/```\s*/g, '');
            cleaned = cleaned.trim();

            console.log('🔍 Parsing AI response (length:', cleaned.length, ')');
            console.log('🔍 Response preview:', cleaned.slice(0, 300));

            // Try direct JSON parse first
            try {
                const result = JSON.parse(cleaned);
                console.log('✅ Direct JSON parse successful');
                return result;
            } catch (directError: any) {
                console.log('⚠️ Direct JSON parse failed:', directError.message);
                
                // If that fails, try to extract JSON from the response
                const jsonMatch = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
                if (jsonMatch) {
                    let extracted = jsonMatch[0];
                    console.log('🔍 Extracted JSON (length:', extracted.length, ')');
                    console.log('🔍 Extracted preview:', extracted.slice(0, 200));

                    // Fix common JSON issues
                    // Remove trailing commas before closing brackets
                    extracted = extracted.replace(/,(\s*[}\]])/g, '$1');
                    // Fix unquoted keys (basic attempt)
                    extracted = extracted.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                    // Fix incomplete strings (truncate at first unclosed quote)
                    extracted = this.fixIncompleteJson(extracted);

                    try {
                        const result = JSON.parse(extracted);
                        console.log('✅ Extracted JSON parse successful');
                        return result;
                    } catch (extractError: any) {
                        console.log('⚠️ Extracted JSON parse failed:', extractError.message);
                        console.log('🔍 Problematic JSON:', extracted.slice(0, 500));
                        
                        // Try to salvage partial JSON by finding complete objects
                        return this.salvagePartialJson(extracted);
                    }
                }
            }

            // If no JSON found, return empty array
            console.warn('⚠️ No valid JSON found in AI response');
            console.warn('Response preview:', response.slice(0, 200));
            return [];
        } catch (error) {
            console.error('❌ Error parsing AI response:', error);
            console.error('Response that failed:', response.slice(0, 500));
            return [];
        }
    }

    /**
     * Fix incomplete JSON by truncating at first unclosed quote or bracket
     */
    private static fixIncompleteJson(json: string): string {
        try {
            // Find the last complete object/array
            let depth = 0;
            let inString = false;
            let escapeNext = false;
            let lastValidPos = -1;

            for (let i = 0; i < json.length; i++) {
                const char = json[i];
                
                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }

                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }

                if (char === '"' && !escapeNext) {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{' || char === '[') {
                        depth++;
                    } else if (char === '}' || char === ']') {
                        depth--;
                        if (depth === 0) {
                            lastValidPos = i;
                        }
                    }
                }
            }

            if (lastValidPos > 0) {
                console.log('🔧 Truncating incomplete JSON at position:', lastValidPos);
                return json.slice(0, lastValidPos + 1);
            }

            return json;
        } catch (error: any) {
            console.log('⚠️ Error fixing incomplete JSON:', error.message);
            return json;
        }
    }

    /**
     * Try to salvage partial JSON by extracting complete objects
     */
    private static salvagePartialJson(json: string): any[] {
        try {
            const results: any[] = [];
            
            // Look for complete JSON objects in the string
            const objectRegex = /\{[^{}]*"pattern"[^{}]*\}/g;
            let match;
            
            while ((match = objectRegex.exec(json)) !== null) {
                try {
                    const obj = JSON.parse(match[0]);
                    if (obj.pattern && typeof obj.pattern === 'string') {
                        results.push(obj);
                    }
                } catch (e) {
                    // Skip invalid objects
                    continue;
                }
            }

            if (results.length > 0) {
                console.log('🔧 Salvaged', results.length, 'complete objects from partial JSON');
                return results;
            }

            console.log('⚠️ Could not salvage any complete objects');
            return [];
        } catch (error: any) {
            console.log('⚠️ Error salvaging partial JSON:', error.message);
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
