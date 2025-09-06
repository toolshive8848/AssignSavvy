const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * PlanValidator class handles user plan validation and restrictions
 * Uses SQLite for consistent data storage
 */
class PlanValidator {
    constructor(dbPath = null) {
        this.dbPath = dbPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'assignment_writer.db');
        this.planTypes = {
            FREEMIUM: 'freemium',
            PRO: 'pro',
            CUSTOM: 'custom'
        };
        
        this.limits = {
            freemium: {
                maxPromptLength: 500, // words
                maxOutputPerRequest: 1000, // words
            },
            pro: {
                maxPromptLength: 5000, // words
                maxOutputPerRequest: null, // unlimited (credit-based)
            },
            custom: {
                maxPromptLength: 5000, // words
                maxOutputPerRequest: null, // unlimited (credit-based)
            }
        };
    }

    /**
     * Get database connection
     */
    getDatabase() {
        return new sqlite3.Database(this.dbPath);
    }

    /**
     * Validate user request against plan limitations
     */
    async validateRequest(userId, prompt, requestedWordCount, toolType = 'writing') {
        try {
            // Get user plan information
            const userPlan = await this.getUserPlan(userId);
            if (!userPlan) {
                return {
                    isValid: false,
                    error: 'User plan not found',
                    errorCode: 'PLAN_NOT_FOUND'
                };
            }

            const planLimits = this.limits[userPlan.planType];
            if (!planLimits) {
                return {
                    isValid: false,
                    error: 'Invalid plan type',
                    errorCode: 'INVALID_PLAN'
                };
            }

            // Check prompt length limits
            const promptWordCount = this.countWords(prompt);
            const promptValidation = this.validatePromptLength(userPlan.planType, promptWordCount);
            if (!promptValidation.isValid) {
                return promptValidation;
            }

            // Check output word count limits per request
            const outputValidation = this.validateOutputWordCount(userPlan.planType, requestedWordCount);
            if (!outputValidation.isValid) {
                return outputValidation;
            }

            // Check credit availability
            const creditValidation = await this.validateCreditAvailability(userId, requestedWordCount, userPlan.planType, toolType);
            if (!creditValidation.isValid) {
                return creditValidation;
            }

            return {
                isValid: true,
                userPlan,
                promptWordCount,
                requestedWordCount,
                estimatedCredits: creditValidation.estimatedCredits
            };

        } catch (error) {
            console.error('Error validating request:', error);
            return {
                isValid: false,
                error: 'Validation failed',
                errorCode: 'VALIDATION_ERROR',
                details: error.message
            };
        }
    }

    /**
     * Validate user plan for specific tool access
     */
    async validateUserPlan(userId, options = {}) {
        try {
            const userPlan = await this.getUserPlan(userId);
            if (!userPlan) {
                return {
                    isValid: false,
                    error: 'User plan not found',
                    errorCode: 'PLAN_NOT_FOUND'
                };
            }

            // All users have access to all tools with credit-based system
            userPlan.hasDetectorAccess = true;
            userPlan.hasResearcherAccess = true;
            
            return {
                isValid: true,
                userPlan
            };

        } catch (error) {
            console.error('Error validating user plan:', error);
            return {
                isValid: false,
                error: 'Plan validation failed',
                errorCode: 'VALIDATION_ERROR',
                details: error.message
            };
        }
    }

    /**
     * Get user plan information from SQLite
     */
    async getUserPlan(userId) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.get(
                'SELECT id, credits, is_premium, created_at, updated_at FROM users WHERE id = ?',
                [userId],
                (err, user) => {
                    db.close();
                    
                    if (err) {
                        reject(new Error('Database error getting user plan'));
                        return;
                    }
                    
                    if (!user) {
                        resolve(null);
                        return;
                    }
                    
                    resolve({
                        userId: user.id,
                        planType: user.is_premium ? 'pro' : 'freemium',
                        credits: user.credits || 0,
                        createdAt: user.created_at,
                        updatedAt: user.updated_at
                    });
                }
            );
        });
    }

    /**
     * Validate prompt length against plan limits
     */
    validatePromptLength(planType, promptWordCount) {
        const maxPromptLength = this.limits[planType].maxPromptLength;
        
        if (maxPromptLength && promptWordCount > maxPromptLength) {
            const errorMessage = planType === this.planTypes.FREEMIUM 
                ? 'Upgrade to Pro to use longer prompts!'
                : `Prompt length exceeds maximum limit of ${maxPromptLength} words.`;
                
            return {
                isValid: false,
                error: errorMessage,
                errorCode: 'PROMPT_TOO_LONG',
                currentLength: promptWordCount,
                maxLength: maxPromptLength,
                planType
            };
        }

        return { isValid: true };
    }

    /**
     * Validate output word count against plan limits
     */
    validateOutputWordCount(planType, requestedWordCount) {
        const maxOutputPerRequest = this.limits[planType].maxOutputPerRequest;
        
        if (maxOutputPerRequest && requestedWordCount > maxOutputPerRequest) {
            const errorMessage = planType === this.planTypes.FREEMIUM
                ? `Freemium users can generate up to ${maxOutputPerRequest} words per request. Upgrade to Pro for unlimited generation!`
                : `Output word count exceeds maximum limit of ${maxOutputPerRequest} words per request.`;
                
            return {
                isValid: false,
                error: errorMessage,
                errorCode: 'OUTPUT_LIMIT_EXCEEDED',
                requestedCount: requestedWordCount,
                maxCount: maxOutputPerRequest,
                planType
            };
        }

        return { isValid: true };
    }

    /**
     * Validate credit availability for the request
     */
    async validateCreditAvailability(userId, requestedWordCount, planType, toolType = 'writing') {
        try {
            // Get user's current credit balance
            const userCredits = await this.getUserCredits(userId);
            
            // Estimate credits needed for this request
            const estimatedCredits = this.estimateCreditsNeeded(requestedWordCount, planType, toolType);
            
            if (userCredits.availableCredits < estimatedCredits) {
                return {
                    isValid: false,
                    error: 'Insufficient credits for this request',
                    errorCode: 'INSUFFICIENT_CREDITS',
                    availableCredits: userCredits.availableCredits,
                    estimatedCredits,
                    planType
                };
            }
            
            return {
                isValid: true,
                availableCredits: userCredits.availableCredits,
                estimatedCredits
            };
            
        } catch (error) {
            console.error('Error validating credit availability:', error);
            return {
                isValid: false,
                error: 'Failed to validate credit availability',
                errorCode: 'CREDIT_VALIDATION_ERROR'
            };
        }
    }

    /**
     * Get user's current credit balance from SQLite
     */
    async getUserCredits(userId) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.get(
                'SELECT credits FROM users WHERE id = ?',
                [userId],
                (err, user) => {
                    db.close();
                    
                    if (err) {
                        reject(new Error('Database error getting user credits'));
                        return;
                    }
                    
                    if (!user) {
                        reject(new Error('User not found'));
                        return;
                    }
                    
                    resolve({
                        availableCredits: user.credits || 0
                    });
                }
            );
        });
    }

    /**
     * Estimate credits needed for content generation
     */
    estimateCreditsNeeded(wordCount, planType, toolType = 'writing') {
        // Credit ratios for different tools (purely credit-based, no plan multipliers)
        const ratios = {
            writing: 3,              // 1 credit per 3 words for Writer/Assignments
            research: 5,             // 1 credit per 5 words for Research Tool
            detector_detection: 0.05, // 50 credits per 1000 words for Detector Detection
            detector_generation: 5,   // 1 credit per 5 words for Detector Generation
            prompt_engineer: 100     // 1 credit per 100 words for Prompt Engineer
        };
        
        const ratio = ratios[toolType] || ratios.writing;
        
        // For detector detection, calculate differently (50 credits per 1000 words)
        if (toolType === 'detector_detection') {
            return Math.ceil((wordCount / 1000) * 50);
        }
        
        // For other tools, use standard ratio calculation
        return Math.ceil(wordCount / ratio);
    }

    /**
     * Count words in text
     */
    countWords(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }
        
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Record usage after successful content generation
     */
    async recordUsage(userId, wordsGenerated, creditsUsed, metadata = {}) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.run(
                'INSERT INTO user_usage_tracking (user_id, word_count, credits_used, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [userId, wordsGenerated, creditsUsed],
                function(err) {
                    db.close();
                    
                    if (err) {
                        reject(new Error('Failed to record usage'));
                        return;
                    }
                    
                    resolve({
                        success: true,
                        usageId: this.lastID,
                        wordsGenerated,
                        creditsUsed,
                        timestamp: new Date()
                    });
                }
            );
        });
    }
}

module.exports = PlanValidator;