const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * AtomicCreditSystem class for handling credit calculations and atomic SQLite transactions
 * Implements different word-to-credit ratios for different tools
 */
class AtomicCreditSystem {
    constructor(dbPath = null) {
        this.dbPath = dbPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'assignment_writer.db');
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
     * Get database connection
     */
    getDatabase() {
        return new sqlite3.Database(this.dbPath);
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
     * Atomic credit deduction with SQLite transaction
     */
    async deductCreditsAtomic(userId, creditsToDeduct, planType, toolType = 'writing') {
        const requiredCredits = creditsToDeduct;
        const wordCount = 0; // Word count is 0 for credit-based deduction
        
        let attempt = 0;
        while (attempt < this.MAX_RETRY_ATTEMPTS) {
            try {
                const result = await this.executeTransaction(userId, requiredCredits, wordCount, planType);
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
     * Execute SQLite transaction for credit deduction
     */
    async executeTransaction(userId, requiredCredits, requestedWordCount, planType) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Check current user credits
                db.get('SELECT credits FROM users WHERE id = ?', [userId], (err, user) => {
                    if (err) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('Database error during credit check'));
                        return;
                    }
                    
                    if (!user) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('User not found'));
                        return;
                    }
                    
                    const currentCredits = user.credits || 0;
                    
                    // Check sufficient credits
                    if (currentCredits < requiredCredits) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error(`Insufficient credits. Required: ${requiredCredits}, Available: ${currentCredits}`));
                        return;
                    }
                    
                    // Calculate new balance
                    const newCreditBalance = currentCredits - requiredCredits;
                    const transactionId = this.generateTransactionId();
                    
                    // Update user credits
                    db.run(
                        'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [newCreditBalance, userId],
                        (updateErr) => {
                            if (updateErr) {
                                db.run('ROLLBACK');
                                db.close();
                                reject(new Error('Failed to update user credits'));
                                return;
                            }
                            
                            // Record transaction in usage tracking
                            db.run(
                                'INSERT INTO user_usage_tracking (user_id, word_count, credits_used, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                                [userId, requestedWordCount, requiredCredits],
                                (trackingErr) => {
                                    // Don't fail transaction if tracking fails
                                    if (trackingErr) {
                                        console.warn('Failed to record usage tracking:', trackingErr);
                                    }
                                    
                                    db.run('COMMIT', (commitErr) => {
                                        db.close();
                                        
                                        if (commitErr) {
                                            reject(new Error('Transaction commit failed'));
                                            return;
                                        }
                                        
                                        resolve({
                                            success: true,
                                            transactionId,
                                            creditsDeducted: requiredCredits,
                                            wordsAllocated: requestedWordCount,
                                            previousBalance: currentCredits,
                                            newBalance: newCreditBalance,
                                            timestamp: new Date()
                                        });
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    /**
     * Rollback transaction in case of failure
     */
    async rollbackTransaction(userId, transactionId, creditsToRestore, wordsToDeduct) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Get current user credits
                db.get('SELECT credits FROM users WHERE id = ?', [userId], (err, user) => {
                    if (err) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('Database error during rollback'));
                        return;
                    }
                    
                    if (!user) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('User not found for rollback'));
                        return;
                    }
                    
                    const currentCredits = user.credits || 0;
                    const restoredBalance = currentCredits + creditsToRestore;
                    
                    // Restore credits
                    db.run(
                        'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [restoredBalance, userId],
                        (updateErr) => {
                            if (updateErr) {
                                db.run('ROLLBACK');
                                db.close();
                                reject(new Error('Failed to restore credits'));
                                return;
                            }
                            
                            // Record rollback transaction
                            db.run(
                                'INSERT INTO user_usage_tracking (user_id, word_count, credits_used, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                                [userId, -wordsToDeduct, -creditsToRestore],
                                (trackingErr) => {
                                    if (trackingErr) {
                                        console.warn('Failed to record rollback tracking:', trackingErr);
                                    }
                                    
                                    db.run('COMMIT', (commitErr) => {
                                        db.close();
                                        
                                        if (commitErr) {
                                            reject(new Error('Rollback commit failed'));
                                            return;
                                        }
                                        
                                        resolve({
                                            success: true,
                                            creditsRestored: creditsToRestore,
                                            wordsDeducted: wordsToDeduct,
                                            newBalance: restoredBalance,
                                            rollbackTimestamp: new Date()
                                        });
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    /**
     * Get user's current credit balance
     */
    async getCreditBalance(userId) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.get(
                'SELECT credits, created_at FROM users WHERE id = ?',
                [userId],
                (err, user) => {
                    db.close();
                    
                    if (err) {
                        reject(new Error('Database error getting credit balance'));
                        return;
                    }
                    
                    if (!user) {
                        reject(new Error('User not found'));
                        return;
                    }
                    
                    resolve({
                        currentBalance: user.credits || 0,
                        lastCreditDeduction: user.updated_at || null
                    });
                }
            );
        });
    }

    /**
     * Get transaction history for a user
     */
    async getTransactionHistory(userId, limit = 50) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.all(
                'SELECT * FROM user_usage_tracking WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
                [userId, limit],
                (err, transactions) => {
                    db.close();
                    
                    if (err) {
                        reject(new Error('Database error getting transaction history'));
                        return;
                    }
                    
                    resolve(transactions.map(tx => ({
                        id: tx.id,
                        userId: tx.user_id,
                        wordCount: tx.word_count,
                        creditsUsed: tx.credits_used,
                        timestamp: tx.created_at,
                        type: tx.credits_used > 0 ? 'deduction' : 'rollback'
                    })));
                }
            );
        });
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
    async refundCredits(userId, creditsToRefund, originalTransactionId) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                db.get('SELECT credits FROM users WHERE id = ?', [userId], (err, user) => {
                    if (err) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('Database error during refund'));
                        return;
                    }
                    
                    if (!user) {
                        db.run('ROLLBACK');
                        db.close();
                        reject(new Error('User not found'));
                        return;
                    }
                    
                    const currentCredits = user.credits || 0;
                    const newCreditBalance = currentCredits + creditsToRefund;
                    const refundTransactionId = this.generateTransactionId();
                    
                    // Update user credits
                    db.run(
                        'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [newCreditBalance, userId],
                        (updateErr) => {
                            if (updateErr) {
                                db.run('ROLLBACK');
                                db.close();
                                reject(new Error('Failed to refund credits'));
                                return;
                            }
                            
                            // Record refund transaction
                            db.run(
                                'INSERT INTO user_usage_tracking (user_id, word_count, credits_used, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                                [userId, 0, -creditsToRefund],
                                (trackingErr) => {
                                    if (trackingErr) {
                                        console.warn('Failed to record refund tracking:', trackingErr);
                                    }
                                    
                                    db.run('COMMIT', (commitErr) => {
                                        db.close();
                                        
                                        if (commitErr) {
                                            reject(new Error('Refund commit failed'));
                                            return;
                                        }
                                        
                                        resolve({
                                            success: true,
                                            transactionId: refundTransactionId,
                                            creditsRefunded: creditsToRefund,
                                            previousBalance: currentCredits,
                                            newBalance: newCreditBalance,
                                            timestamp: new Date()
                                        });
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    }
}

module.exports = AtomicCreditSystem;