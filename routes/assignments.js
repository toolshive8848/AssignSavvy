const express = require('express');
const admin = require('firebase-admin');
const MultiPartGenerator = require('../services/multiPartGenerator');
const FinalDetectionService = require('../services/finalDetection');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const PlanValidator = require('../services/planValidator');

const router = express.Router();

// Initialize services
const multiPartGenerator = new MultiPartGenerator();
const finalDetectionService = new FinalDetectionService();
const atomicCreditSystem = new AtomicCreditSystem();
const planValidator = new PlanValidator();

// Middleware to verify Firebase ID token
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

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
        
        const userId = req.user.uid;

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

            // Store assignment in Firestore
            const db = admin.firestore();
            const assignmentRef = await db.collection('assignments').add({
                userId,
                title,
                description,
                wordCount: result.wordCount,
                citationStyle,
                content: result.content,
                originalityScore: result.finalDetectionResults?.originalityScore || null,
                status: 'completed',
                creditsUsed: creditsNeeded,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                metadata: {
                    style,
                    tone,
                    subject,
                    qualityTier,
                    chunksGenerated: result.chunksGenerated,
                    refinementCycles: result.refinementCycles,
                    generationTime: result.generationTime
                }
            });

            res.json({
                success: true,
                assignmentId: assignmentRef.id,
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
 * Get user's assignment history from Firestore
 */
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        let query = db.collection('assignments')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (offset > 0) {
            const offsetSnapshot = await db.collection('assignments')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(offset)
                .get();
            
            if (!offsetSnapshot.empty) {
                const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        const assignments = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                title: data.title,
                description: data.description,
                word_count: data.wordCount,
                citation_style: data.citationStyle,
                originality_score: data.originalityScore,
                status: data.status,
                credits_used: data.creditsUsed,
                created_at: data.createdAt
            };
        });

        res.json({
            success: true,
            assignments,
            pagination: {
                limit,
                offset,
                hasMore: assignments.length === limit
            }
        });
    } catch (error) {
        console.error('Assignment history error:', error);
        res.status(500).json({ error: 'Failed to get assignment history' });
    }
});

/**
 * GET /api/assignments/:id
 * Get specific assignment by ID from Firestore
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const assignmentId = req.params.id;
        const db = admin.firestore();

        const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();

        if (!assignmentDoc.exists) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignmentData = assignmentDoc.data();

        // Verify ownership
        if (assignmentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            success: true,
            assignment: {
                id: assignmentDoc.id,
                ...assignmentData
            }
        });
    } catch (error) {
        console.error('Assignment fetch error:', error);
        res.status(500).json({ error: 'Failed to get assignment' });
    }
});

/**
 * DELETE /api/assignments/:id
 * Delete assignment from Firestore
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const assignmentId = req.params.id;
        const db = admin.firestore();

        const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();

        if (!assignmentDoc.exists) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignmentData = assignmentDoc.data();

        // Verify ownership
        if (assignmentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.collection('assignments').doc(assignmentId).delete();

        res.json({
            success: true,
            message: 'Assignment deleted successfully'
        });
    } catch (error) {
        console.error('Assignment deletion error:', error);
        res.status(500).json({ error: 'Failed to delete assignment' });
    }
});

/**
 * POST /api/assignments/save-to-history
 * Save content to user's history in Firestore
 */
router.post('/save-to-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { content, title, metadata = {} } = req.body;
        const db = admin.firestore();

        if (!content || !title) {
            return res.status(400).json({
                success: false,
                error: 'Content and title are required'
            });
        }

        const historyItem = {
            userId,
            title,
            content,
            metadata,
            wordCount: content.trim().split(/\s+/).length,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            type: 'saved_content'
        };

        const historyRef = await db.collection('contentHistory').add(historyItem);

        res.json({
            success: true,
            historyId: historyRef.id,
            message: 'Content saved to history successfully'
        });
    } catch (error) {
        console.error('Save to history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save content to history'
        });
    }
});

module.exports = router;