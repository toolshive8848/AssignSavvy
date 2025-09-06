const express = require('express');
const router = express.Router();
const MultiPartGenerator = require('../services/multiPartGenerator');
const FinalDetectionService = require('../services/finalDetection');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const PlanValidator = require('../services/planValidator');
const { authenticateToken } = require('../middleware/auth');

// Initialize services
const multiPartGenerator = new MultiPartGenerator();
const finalDetectionService = new FinalDetectionService();
const atomicCreditSystem = new AtomicCreditSystem();
const planValidator = new PlanValidator();

/**
 * POST /api/assignments/generate
 * Generate assignment content using real AI services
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const {
            title,
            description,
            wordCount,
            citationStyle = 'APA',
            style = 'Academic',
            tone = 'Formal',
            subject = '',
            additionalInstructions = '',
            qualityTier = 'standard'
        } = req.body;
        
        const userId = req.user.userId;

        // Input validation
        if (!title || title.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Assignment title is required'
            });
        }

        if (!description || description.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Assignment description is required'
            });
        }

        if (!wordCount || wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 100 and 2000'
            });
        }

        // Validate user plan
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'assignment'
        });

        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        }

        // Calculate credits needed based on quality tier
        let baseCreditsNeeded = Math.ceil(wordCount / 3); // 1 credit per 3 words
        const creditsNeeded = qualityTier === 'premium' ? baseCreditsNeeded * 2 : baseCreditsNeeded;

        // Deduct credits atomically
        const creditResult = await atomicCreditSystem.deductCreditsAtomic(
            userId,
            creditsNeeded,
            planValidation.userPlan.planType,
            'writing'
        );

        if (!creditResult.success) {
            return res.status(402).json({
                success: false,
                error: `Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`
            });
        }

        try {
            // Build comprehensive prompt for assignment
            const assignmentPrompt = `
Assignment Title: ${title}

Assignment Description: ${description}

Requirements:
- Academic writing style with ${tone.toLowerCase()} tone
- Target word count: ${wordCount} words
- Citation style: ${citationStyle}
- Subject area: ${subject || 'General'}
- Additional instructions: ${additionalInstructions || 'None'}

Please generate a comprehensive academic assignment that includes:
1. Clear introduction with thesis statement
2. Well-structured body paragraphs with evidence
3. Proper conclusion
4. Academic citations in ${citationStyle} format
5. Professional formatting and structure
            `.trim();

            // Generate content using real AI services
            const result = await multiPartGenerator.generateMultiPartContent({
                userId,
                prompt: assignmentPrompt,
                requestedWordCount: wordCount,
                userPlan: planValidation.userPlan.planType,
                style,
                tone,
                subject: subject || title,
                additionalInstructions,
                requiresCitations: true,
                citationStyle,
                qualityTier,
                enableRefinement: qualityTier === 'premium'
            });

            // Store assignment in database
            const db = req.app.locals.db;
            const assignmentId = await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO assignments (
                        user_id, title, description, word_count, citation_style, 
                        content, originality_score, status, credits_used, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)`,
                    [
                        userId,
                        title,
                        description,
                        result.wordCount,
                        citationStyle,
                        result.content,
                        result.finalDetectionResults?.originalityScore || null,
                        creditsNeeded
                    ],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.lastID);
                        }
                    }
                );
            });

            res.json({
                success: true,
                assignmentId,
                content: result.content,
                metadata: {
                    title,
                    description,
                    wordCount: result.wordCount,
                    citationStyle,
                    style,
                    tone,
                    creditsUsed: creditsNeeded,
                    newBalance: creditResult.newBalance,
                    qualityTier,
                    generationTime: result.generationTime,
                    chunksGenerated: result.chunksGenerated,
                    refinementCycles: result.refinementCycles,
                    originalityScore: result.finalDetectionResults?.originalityScore,
                    aiDetectionScore: result.finalDetectionResults?.aiDetectionScore,
                    plagiarismScore: result.finalDetectionResults?.plagiarismScore,
                    qualityScore: result.finalDetectionResults?.qualityScore,
                    requiresReview: result.finalDetectionResults?.requiresReview,
                    isAcceptable: result.finalDetectionResults?.isAcceptable,
                    citationCount: result.citationData?.citationCount || 0,
                    bibliography: result.citationData?.bibliography || []
                }
            });

        } catch (generationError) {
            console.error('Assignment generation failed, rolling back credits:', generationError);
            
            // Rollback credits on generation failure
            try {
                await atomicCreditSystem.rollbackTransaction(
                    userId,
                    creditResult.transactionId,
                    creditsNeeded,
                    wordCount
                );
            } catch (rollbackError) {
                console.error('Credit rollback failed:', rollbackError);
            }
            
            return res.status(500).json({
                success: false,
                error: 'Assignment generation failed',
                details: generationError.message
            });
        }

    } catch (error) {
        console.error('Error in assignment generation:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/assignments/history
 * Get user's assignment history
 */
router.get('/history', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const db = req.app.locals.db;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    db.all(
        `SELECT id, title, description, word_count, citation_style, 
                originality_score, status, credits_used, created_at 
         FROM assignments 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
        (err, assignments) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({
                success: true,
                assignments,
                pagination: {
                    limit,
                    offset,
                    hasMore: assignments.length === limit
                }
            });
        }
    );
});

/**
 * GET /api/assignments/:id
 * Get specific assignment by ID
 */
router.get('/:id', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const assignmentId = req.params.id;
    const db = req.app.locals.db;

    db.get(
        'SELECT * FROM assignments WHERE id = ? AND user_id = ?',
        [assignmentId, userId],
        (err, assignment) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!assignment) {
                return res.status(404).json({ error: 'Assignment not found' });
            }

            res.json({
                success: true,
                assignment
            });
        }
    );
});

/**
 * DELETE /api/assignments/:id
 * Delete assignment
 */
router.delete('/:id', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const assignmentId = req.params.id;
    const db = req.app.locals.db;

    db.run(
        'DELETE FROM assignments WHERE id = ? AND user_id = ?',
        [assignmentId, userId],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Assignment not found' });
            }

            res.json({
                success: true,
                message: 'Assignment deleted successfully'
            });
        }
    );
});

module.exports = router;