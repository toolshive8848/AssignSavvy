const express = require('express');
const multer = require('multer');
const path = require('path');
const FileProcessingService = require('../services/fileProcessingService');
const LLMService = require('../services/llmService');
const ContentDatabase = require('../services/contentDatabase');
const MultiPartGenerator = require('../services/multiPartGenerator');
const { authenticateToken } = require('../middleware/auth');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const PlanValidator = require('../services/planValidator');

const router = express.Router();
const fileProcessingService = new FileProcessingService();
const llmService = new LLMService();
## Conclusion

In conclusion, this analysis of "${title}\" reveals significant insights that contribute to the broader understanding of the subject matter. The implications of these findings extend beyond the immediate scope of this assignment.

## References

${citationStyle === 'APA' ? 
`Smith, J. (2023). Academic Writing in the Digital Age. Journal of Modern Education, 45(2), 123-145.

Johnson, M. & Brown, A. (2022). Research Methodologies for Students. Academic Press.` :
citationStyle === 'MLA' ?
`Smith, John. "Academic Writing in the Digital Age." Journal of Modern Education, vol. 45, no. 2, 2023, pp. 123-145.

Johnson, Mary, and Anne Brown. Research Methodologies for Students. Academic Press, 2022.` :
`Smith, J. (2023). Academic Writing in the Digital Age. Journal of Modern Education 45, no. 2: 123-145.

Johnson, M., and A. Brown. Research Methodologies for Students. Academic Press, 2022.`}
    `.trim();

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return mockContent.substring(0, Math.min(mockContent.length, wordCount * 6)); // Rough word estimation
};

/**
 * POST /api/writer/generate
 * Generate content from text prompt or assignment
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const { 
            prompt, 
            style = 'Academic', 
            tone = 'Formal', 
            wordCount = 500, 
            qualityTier = 'standard',
            contentType = 'general', // 'general' or 'assignment'
            assignmentTitle,
            citationStyle = 'APA'
        } = req.body;
        const userId = req.user.userId;
        
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required'
            });
        }
        
        if (wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
        }
        
        // For assignment type, require title
        if (contentType === 'assignment' && (!assignmentTitle || assignmentTitle.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                error: 'Assignment title is required for assignment generation'
            });
        }
        
        // Validate user plan and calculate credits
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'generation'
        });
        
        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        try {
            let result;
            let contentSource = 'new_generation';
            
            // Determine if multi-part generation is needed
            // Use multi-part for requests > 800 words or when user plan supports it
            const useMultiPart = wordCount > 800 || 
                               (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
            
            // Enable 2-loop refinement system for premium quality tier
            const enableRefinement = qualityTier === 'premium';
            
            // Handle assignment generation with premium features integration
            if (contentType === 'assignment') {
                console.log(\`Generating assignment: ${assignmentTitle} (Quality: ${qualityTier})`);
                
                if (qualityTier === 'premium' && (useMultiPart || enableRefinement)) {
                    // Use multi-part generation with refinement for premium assignments
                    console.log('Using premium multi-part generation for assignment');
                    
                    result = await multiPartGenerator.generateMultiPartContent({
                        userId,
                        prompt: \`Assignment Title: ${assignmentTitle}\n\nInstructions: ${prompt}`,
                        requestedWordCount: wordCount,
                        userPlan: planValidation.userPlan.planType,
                        style,
                        tone,
                        subject: assignmentTitle,
                        additionalInstructions: \`Generate academic assignment with ${citationStyle} citations`,
                        requiresCitations: true,
                        newBalance: creditResult.newBalance,
                        qualityTier: qualityTier,
                        enableRefinement: enableRefinement
                    });
                    
                    contentSource = result.usedSimilarContent ? 'assignment_multipart_optimized' : 'assignment_multipart_new';
                    // Use multi-part generation for all assignments to ensure quality
                    
                    result = {
                        content: \`Assignment generation requires multi-part processing. Please use the multi-part generator.`,
                        wordCount: 0,
                        generationTime: 0,
                        source: 'error',
                        refinementCycles: 0,
                        chunksGenerated: 1
                    };
                    contentSource = 'error';
                }
            } else if (useMultiPart) {
                console.log(\`Using multi-part generation for ${wordCount} words`);
                
                // Use MultiPartGenerator for chunk-based generation with iterative detection
                result = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: req.body.additionalInstructions || '',
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa',
                    qualityTier: qualityTier,
                    enableRefinement: enableRefinement
                });
                
                contentSource = result.usedSimilarContent ? 'multipart_optimized' : 'multipart_new';
            } else {
                // Use multi-part generation for all content to ensure consistency
                result = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: req.body.additionalInstructions || '',
                    requiresCitations: false,
                    qualityTier: qualityTier,
                    enableRefinement: enableRefinement
                });
                
                contentSource = result.usedSimilarContent ? 'multipart_optimized' : 'multipart_new';
            }
            
            res.json({
                success: true,
                content: result.content,
                metadata: {
                    source: result.source || 'multipart_generation',
                    generationTime: result.generationTime,
                    fallbackUsed: result.fallbackUsed,
                    contentSource: contentSource,
                    similarContentFound: result.usedSimilarContent || false,
                    style: style,
                    tone: tone,
                    wordCount: result.wordCount || wordCount,
                    creditsUsed: creditsNeeded,
                    remainingCredits: creditResult.newBalance,
                    newBalance: creditResult.newBalance,
                    qualityTier: qualityTier,
                    enabledRefinement: enableRefinement,
                    // Content type specific metadata
                    contentType: contentType,
                    isAssignment: contentType === 'assignment',
                    assignmentTitle: contentType === 'assignment' ? assignmentTitle : null,
                    citationStyle: contentType === 'assignment' ? citationStyle : null,
                    // Multi-part specific metadata
                    isMultiPart: contentType === 'assignment' ? 
                        (qualityTier === 'premium' && (useMultiPart || enableRefinement) && result.chunksGenerated > 1) : 
                        useMultiPart,
                    chunksGenerated: result.chunksGenerated || 1,
                    refinementCycles: result.refinementCycles || 0,
                    contentId: result.contentId,
                    requiresCitations: contentType === 'assignment' ? true : (result.citationData?.requiresCitations || false),
                    citationCount: result.citationData?.citationCount || 0,
                    citationStyle: contentType === 'assignment' ? citationStyle : (result.citationData?.style || null),
                    bibliography: result.citationData?.bibliography || [],
                    inTextCitations: result.citationData?.inTextCitations || [],
                    // Final detection results
                    originalityScore: result.finalDetectionResults?.originalityScore || null,
                    aiDetectionScore: result.finalDetectionResults?.aiDetectionScore || null,
                    plagiarismScore: result.finalDetectionResults?.plagiarismScore || null,
                    qualityScore: result.finalDetectionResults?.qualityScore || null,
                    requiresReview: result.finalDetectionResults?.requiresReview || false,
                    isAcceptable: result.finalDetectionResults?.isAcceptable || true,
                    detectionConfidence: result.finalDetectionResults?.confidence || null,
                    detectionRecommendations: result.finalDetectionResults?.recommendations || []
                }
            });
            
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
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
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in writer generate endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/writer/upload-and-generate
 * Upload files and generate content based on file contents
 */
router.post('/upload-and-generate', authenticateToken, upload.array('files', 5), async (req, res) => {
    try {
        const { additionalPrompt = '', style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard' } = req.body;
        const files = req.files;
        const userId = req.user.userId;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }
        
        if (wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 100 and 2000'
            });
        }
        
        // Validate user plan and calculate credits
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'generation'
        });
        
        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        }
        
        // Calculate credits needed based on quality tier
        // Standard: 1 credit per 3 words, Premium: 2x credits (2 credits per 3 words)
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
            return res.status(400).json({
                success: false,
                error: \`Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`
            });
        }
        
        try {
        
        // Process files and generate content
        const result = await fileProcessingService.processFilesAndGenerate(
            files,
            additionalPrompt,
            style,
            tone
        );
        
            if (!result.success) {
                // Rollback credits on file processing failure
                try {
                    await atomicCreditSystem.refundCreditsAtomic(
                        userId,
                        creditsNeeded,
                        planValidation.userPlan.planType,
                        'writing_rollback'
                    );
                } catch (rollbackError) {
                    console.error('Credit rollback failed:', rollbackError);
                }
                return res.status(400).json(result);
            }
            
            let llmResult;
            let contentSource = 'new_generation';
            
            // Determine if multi-part generation is needed for file-based content
            const useMultiPart = wordCount > 800 || 
                               (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
            
            // Enable 2-loop refinement system for premium quality tier
            const enableRefinement = qualityTier === 'premium';
            
            if (useMultiPart) {
                console.log(\`Using multi-part generation for file-based content: ${wordCount} words`);
                
                // Use MultiPartGenerator for chunk-based generation with iterative detection
                llmResult = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt: result.prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: additionalPrompt,
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa',
                    qualityTier: qualityTier,
                    enableRefinement: enableRefinement
                });
                
                contentSource = llmResult.usedSimilarContent ? 'multipart_optimized_files' : 'multipart_new_files';
            } else {
                // Use multi-part generation for all file-based content to ensure consistency
                llmResult = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt: result.prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: additionalPrompt,
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa',
                    qualityTier: qualityTier,
                    enableRefinement: enableRefinement
                });
                
                contentSource = llmResult.usedSimilarContent ? 'multipart_optimized_files' : 'multipart_new_files';
            }
            
            // Prepare response with multi-part metadata if applicable
            const response = {
                success: true,
                content: llmResult.content,
                extractedContent: result.extractedContent,
                generatedPrompt: result.prompt,
                metadata: {
                    ...result.metadata,
                    llmSource: llmResult.source,
                    generationTime: llmResult.generationTime,
                    fallbackUsed: llmResult.fallbackUsed,
                    contentSource: contentSource,
                    creditsUsed: creditsNeeded,
                    remainingCredits: creditResult.newBalance,
                    newBalance: creditResult.newBalance,
                    qualityTier: qualityTier,
                    enabledRefinement: enableRefinement,
                    basedOnFiles: true,
                    fileCount: files.length
                }
            };
            
            if (useMultiPart) {
                // Add multi-part specific metadata
                response.metadata.isMultiPart = true;
                response.metadata.chunksGenerated = llmResult.chunksGenerated || 0;
                response.metadata.refinementCycles = llmResult.refinementCycles || 0;
                response.metadata.contentId = llmResult.contentId;
                response.metadata.similarContentFound = llmResult.usedSimilarContent || false;
                response.metadata.requiresCitations = llmResult.citationData?.requiresCitations || false;
                response.metadata.citationCount = llmResult.citationData?.citationCount || 0;
                response.metadata.citationStyle = llmResult.citationData?.style || null;
                response.metadata.bibliography = llmResult.citationData?.bibliography || [];
                response.metadata.inTextCitations = llmResult.citationData?.inTextCitations || [];
                // Final detection results
                response.metadata.originalityScore = llmResult.finalDetectionResults?.originalityScore || null;
                response.metadata.aiDetectionScore = llmResult.finalDetectionResults?.aiDetectionScore || null;
                response.metadata.plagiarismScore = llmResult.finalDetectionResults?.plagiarismScore || null;
                response.metadata.qualityScore = llmResult.finalDetectionResults?.qualityScore || null;
                response.metadata.requiresReview = llmResult.finalDetectionResults?.requiresReview || false;
                response.metadata.isAcceptable = llmResult.finalDetectionResults?.isAcceptable || true;
                response.metadata.detectionConfidence = llmResult.finalDetectionResults?.confidence || null;
                response.metadata.detectionRecommendations = llmResult.finalDetectionResults?.recommendations || [];
            } else {
                // Add single-generation metadata
                response.metadata.isMultiPart = false;
                response.metadata.similarContentFound = contentSource === 'optimized_existing';
            }
            
            res.json(response);
            
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
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
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in upload-and-generate endpoint:', error);
        
        // Handle multer errors
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'File too large',
                    details: 'Maximum file size is 10MB'
                });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    success: false,
                    error: 'Too many files',
                    details: 'Maximum 5 files allowed'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'File processing and content generation failed',
            details: error.message
        });
    }
});

/**
 * GET /api/writer/supported-formats
 * Get list of supported file formats
 */
router.get('/supported-formats', (req, res) => {
    res.json({
        success: true,
        formats: [
            {
                extension: '.pdf',
                description: 'Portable Document Format',
                maxSize: '10MB'
            },
            {
                extension: '.docx',
                description: 'Microsoft Word Document',
                maxSize: '10MB'
            },
            {
                extension: '.txt',
                description: 'Plain Text File',
                maxSize: '10MB'
            }
        ],
        limits: {
            maxFiles: 5,
            maxFileSize: '10MB',
            totalMaxSize: '50MB'
        }
    });
});

/**
 * POST /api/writer/validate-files
 * Validate files before upload
 */
router.post('/validate-files', upload.array('files', 5), (req, res) => {
    try {
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files provided for validation'
            });
        }
        
        const validation = fileProcessingService.validateFiles(files);
        
        res.json({
            success: validation.valid,
            valid: validation.valid,
            errors: validation.errors || [],
            fileInfo: files.map(file => ({
                name: file.originalname,
                size: file.size,
                type: path.extname(file.originalname).toLowerCase(),
                sizeFormatted: \`${(file.size / 1024 / 1024).toFixed(2)} MB`
            }))
        });
        
    } catch (error) {
        console.error('Error validating files:', error);
        res.status(500).json({
            success: false,
            error: 'File validation failed',
            details: error.message
        });
    }
});

/**
 * Error handling middleware for multer
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                details: 'Maximum file size is 10MB'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files',
                details: 'Maximum 5 files allowed'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected file field',
                details: 'Please use the correct file field name'
            });
        }
    }
    
    if (error.message.includes('Unsupported file type')) {
            success: false,
            error: 'Unsupported file type',
            details: error.message
        });
    }
    
    next(error);
});

module.exports = router;