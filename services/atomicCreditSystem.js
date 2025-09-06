const admin = require('firebase-admin');

/**
 * AtomicCreditSystem class for handling credit calculations and atomic Firestore transactions
 * Implements different word-to-credit ratios for different tools
 */
class AtomicCreditSystem {
    constructor() {
        this.db = admin.firestore();
        this.CREDIT_RATIOS = {
            writing: 3,    // 1 credit per 3 words for writing/assignments
            research: 5,   // 1 credit per 5 words for research
            detector: 10,  // 1 credit per 10 words for detection
            detector_generation: 5, // 1 credit per 5 words for detector generation/removal
            prompt_input: 10,  // 1 credit per 10 words for prompt engineer input
            prompt_output: 5   // 1 credit per 5 words for prompt engineer output
        };
        this.MAX_RETRY_ATTEMPTS = 3;
        this.RETRY_DELAY_MS = 100;
    }

    /**
     * Calculate required credits based on total requested words/credits and tool type
     */
    calculateRequiredCredits(requestedAmount, toolType = 'writing', operation = null) {
        if (!requestedAmount || requestedAmount <= 0) {
            throw new Error('Invalid amount for credit calculation');
        }
        
        // Special handling for detector tool
        if (toolType === 'detector') {
            if (operation === 'detection') {
                // 50 credits per 1000 words for detection (1:20 ratio)
                const requiredCredits = Math.ceil((requestedAmount / 1000) * 50);
                console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (detector detection: 50 credits per 1000 words)`);
                return requiredCredits;
            } else if (operation === 'generation') {
                // 1 credit per 5 words for generation/removal
                const requiredCredits = Math.ceil(requestedAmount / this.CREDIT_RATIOS.detector_generation);
                console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (detector generation/removal: 1 credit per 5 words)`);
                return requiredCredits;
            }
        }
        
        // For other tools, calculate credits from word count
        const ratio = this.CREDIT_RATIOS[toolType] || this.CREDIT_RATIOS.writing;
        const requiredCredits = Math.ceil(requestedAmount / ratio);
        console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (ratio: 1:${ratio}, tool: ${toolType})`);
        
        return requiredCredits;
    }

    /**
     * Atomic credit deduction with Firestore transaction
     */
    async deductCreditsAtomic(userId, creditsToDeduct, planType, toolType = 'writing') {
        const requiredCredits = creditsToDeduct;
        const wordCount = 0; // Word count is 0 for credit-based deduction
        
        let attempt = 0;
        while (attempt < this.MAX_RETRY_ATTEMPTS) {
            try {
                const result = await this.executeFirestoreTransaction(userId, requiredCredits, wordCount, planType, toolType);
                console.log(`Atomic credit deduction successful for user ${userId}: -${requiredCredits} credits`);
                result.toolType = toolType;
                result.creditsDeducted = creditsToDeduct;
                return result;
            } catch (error) {
                attempt++;
                console.warn(`Transaction attempt ${attempt} failed for user ${userId}:`, error.message);
                
                if (attempt >= this.MAX_RETRY_ATTEMPTS) {
                    console.error(`All ${this.MAX_RETRY_ATTEMPTS} transaction attempts failed for user ${userId}`);
                    throw error;
                }
                
                // Wait before retry with exponential backoff
                await this.delay(this.RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            }
        }
    }

    /**
     * Execute Firestore transaction for credit deduction
     */
    async executeFirestoreTransaction(userId, requiredCredits, requestedWordCount, planType, toolType) {
        const userRef = this.db.collection('users').doc(userId);
        const transactionId = this.generateTransactionId();
        
        return await this.db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            const currentCredits = userData.credits || 0;
            
            // Check sufficient credits
            if (currentCredits < requiredCredits) {
                throw new Error(`Insufficient credits. Required: ${requiredCredits}, Available: ${currentCredits}`);
            }
            
            // Calculate new balance
            const newCreditBalance = currentCredits - requiredCredits;
            
            // Update user credits
            transaction.update(userRef, {
                credits: newCreditBalance,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Record transaction in usage tracking
            const usageRef = this.db.collection('usageTracking').doc();
            transaction.set(usageRef, {
                userId,
                transactionId,
                toolType,
                wordCount: requestedWordCount,
                creditsUsed: requiredCredits,
                planType,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'deduction'
            });
            
            return {
                success: true,
                transactionId,
                creditsDeducted: requiredCredits,
                wordsAllocated: requestedWordCount,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                timestamp: new Date()
            };
        });
    }

    /**
     * Rollback transaction in case of failure
     */
    async rollbackTransaction(userId, transactionId, creditsToRestore, wordsToDeduct) {
        const userRef = this.db.collection('users').doc(userId);
        
        return await this.db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            
            if (!userDoc.exists) {
                throw new Error('User not found for rollback');
            }
            
            const userData = userDoc.data();
            const currentCredits = userData.credits || 0;
            const restoredBalance = currentCredits + creditsToRestore;
            
            // Restore credits
            transaction.update(userRef, {
                credits: restoredBalance,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Record rollback transaction
            const rollbackRef = this.db.collection('usageTracking').doc();
            transaction.set(rollbackRef, {
                userId,
                originalTransactionId: transactionId,
                wordCount: -wordsToDeduct,
                creditsUsed: -creditsToRestore,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'rollback'
            });
            
            return {
                success: true,
                creditsRestored: creditsToRestore,
                wordsDeducted: wordsToDeduct,
                newBalance: restoredBalance,
                rollbackTimestamp: new Date()
            };
        });
    }

    /**
     * Get user's current credit balance from Firestore
     */
    async getCreditBalance(userId) {
        try {
            const userDoc = await this.db.collection('users').doc(userId).get();
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            
            return {
                currentBalance: userData.credits || 0,
                lastCreditDeduction: userData.updatedAt || null,
                totalCreditsUsed: userData.totalCreditsUsed || 0,
                totalWordsGenerated: userData.totalWordsGenerated || 0
            };
        } catch (error) {
            console.error('Error getting credit balance:', error);
            throw new Error('Failed to get credit balance');
        }
    }

    /**
     * Get transaction history for a user from Firestore
     */
    async getTransactionHistory(userId, limit = 50) {
        try {
            const snapshot = await this.db.collection('usageTracking')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    userId: data.userId,
                    transactionId: data.transactionId,
                    toolType: data.toolType,
                    wordCount: data.wordCount,
                    creditsUsed: data.creditsUsed,
                    planType: data.planType,
                    timestamp: data.timestamp,
                    type: data.type
                };
            });
        } catch (error) {
            console.error('Error getting transaction history:', error);
            throw new Error('Failed to get transaction history');
        }
    }

    /**
     * Generate unique transaction ID
     */
    generateTransactionId() {
        return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Delay function for retry logic
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Refund credits to user account
     */
    async refundCreditsAtomic(userId, creditsToRefund, planType, reason = 'refund') {
        const userRef = this.db.collection('users').doc(userId);
        const refundTransactionId = this.generateTransactionId();
        
        return await this.db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            const currentCredits = userData.credits || 0;
            const newCreditBalance = currentCredits + creditsToRefund;
            
            // Update user credits
            transaction.update(userRef, {
                credits: newCreditBalance,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Record refund transaction
            const refundRef = this.db.collection('usageTracking').doc();
            transaction.set(refundRef, {
                userId,
                transactionId: refundTransactionId,
                toolType: reason,
                wordCount: 0,
                creditsUsed: -creditsToRefund,
                planType,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'refund'
            });
            
            return {
                success: true,
                transactionId: refundTransactionId,
                creditsRefunded: creditsToRefund,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                timestamp: new Date()
            };
        });
    }
}

module.exports = AtomicCreditSystem;