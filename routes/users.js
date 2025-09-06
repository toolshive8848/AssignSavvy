const express = require('express');
const admin = require('firebase-admin');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const router = express.Router();

// Initialize atomic credit system
const atomicCreditSystem = new AtomicCreditSystem();

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

// Get user profile and credits
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();
        
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();

        res.json({
            uid: userId,
            name: userData.name,
            email: userData.email,
            plan: userData.plan || 'free',
            credits: userData.credits || 200,
            isPremium: userData.isPremium || false,
            memberSince: userData.createdAt
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get user's usage statistics from Firestore
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();
        
        // Get all-time statistics
        const allTimeSnapshot = await db.collection('usageTracking')
            .where('userId', '==', userId)
            .where('type', '==', 'deduction')
            .get();
        
        // Get this month's statistics
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const thisMonthSnapshot = await db.collection('usageTracking')
            .where('userId', '==', userId)
            .where('type', '==', 'deduction')
            .where('timestamp', '>=', startOfMonth)
            .get();
        
        // Calculate all-time stats
        let totalAssignments = 0;
        let totalCreditsUsed = 0;
        let totalWordsGenerated = 0;
        
        allTimeSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.toolType === 'writing') {
                totalAssignments++;
            }
            totalCreditsUsed += data.creditsUsed || 0;
            totalWordsGenerated += data.wordCount || 0;
        });
        
        // Calculate this month's stats
        let thisMonthAssignments = 0;
        let thisMonthCredits = 0;
        let thisMonthWords = 0;
        
        thisMonthSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.toolType === 'writing') {
                thisMonthAssignments++;
            }
            thisMonthCredits += data.creditsUsed || 0;
            thisMonthWords += data.wordCount || 0;
        });

        res.json({
            allTime: {
                totalAssignments,
                totalCreditsUsed,
                totalWordsGenerated,
                averageOriginalityScore: null // Will be calculated from content history
            },
            thisMonth: {
                totalAssignments: thisMonthAssignments,
                creditsUsed: thisMonthCredits,
                totalWordsGenerated: thisMonthWords,
                averageOriginalityScore: null
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { name } = req.body;
        const db = admin.firestore();

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters long' });
        }

        await db.collection('users').doc(userId).update({
            name: name.trim(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ message: 'Profile updated successfully', name: name.trim() });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Get current credit balance using atomic system
router.get('/credits', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const creditBalance = await atomicCreditSystem.getCreditBalance(userId);
        
        res.json({
            success: true,
            credits: creditBalance.currentBalance,
            totalCreditsUsed: creditBalance.totalCreditsUsed,
            totalWordsGenerated: creditBalance.totalWordsGenerated,
            lastCreditDeduction: creditBalance.lastCreditDeduction
        });
    } catch (error) {
        console.error('Error getting credit balance:', error);
        res.status(500).json({ error: 'Failed to get credit balance' });
    }
});

// Deduct credits using atomic system (for admin/testing purposes)
router.post('/deduct-credits', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { amount, toolType = 'manual', planType = 'free' } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid credit amount is required' });
        }
        
        const result = await atomicCreditSystem.deductCreditsAtomic(
            userId,
            amount,
            planType,
            toolType
        );
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Credits deducted successfully',
                creditsDeducted: result.creditsDeducted,
                newBalance: result.newBalance,
                transactionId: result.transactionId
            });
        } else {
            res.status(400).json({
                error: 'Credit deduction failed',
                details: result.error
            });
        }
    } catch (error) {
        console.error('Error deducting credits:', error);
        res.status(500).json({ error: 'Failed to deduct credits' });
    }
});

// Manual credit refresh (for testing - in production this would be automated monthly)
router.post('/refresh-credits', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();

        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        const plan = userData.plan || 'free';

        // Determine credits based on plan
        let newCredits = 200; // Default free plan
        if (plan === 'pro') {
            newCredits = 2000;
        } else if (plan === 'custom') {
            newCredits = 3300;
        }

        await db.collection('users').doc(userId).update({
            credits: newCredits,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ 
            message: 'Credits refreshed successfully', 
            newCredits: newCredits,
            isPremium: userData.isPremium || false,
            plan: plan
        });
    } catch (error) {
        console.error('Credit refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh credits' });
    }
});

// Get transaction history using atomic system
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const limit = parseInt(req.query.limit) || 50;
        
        if (limit > 100) {
            return res.status(400).json({ error: 'Limit cannot exceed 100' });
        }
        
        const transactions = await atomicCreditSystem.getTransactionHistory(userId, limit);
        
        res.json({
            success: true,
            transactions,
            count: transactions.length
        });
    } catch (error) {
        console.error('Error getting transaction history:', error);
        res.status(500).json({ error: 'Failed to get transaction history' });
    }
});

// Get user notifications from Firestore
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();

        // Get recent activity for notifications
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const notificationsSnapshot = await db.collection('contentHistory')
            .where('userId', '==', userId)
            .where('createdAt', '>=', sevenDaysAgo)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        const notifications = notificationsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                message: `Content "${data.title || 'Untitled'}" completed`,
                timestamp: data.createdAt,
                type: 'content_completion'
            };
        });

        res.json({
            success: true,
            notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('Notifications error:', error);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Get daily tool statistics from Firestore
router.get('/tool-stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { date } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];
        const db = admin.firestore();

        // Get today's statistics
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const todaySnapshot = await db.collection('usageTracking')
            .where('userId', '==', userId)
            .where('type', '==', 'deduction')
            .where('timestamp', '>=', startOfDay)
            .where('timestamp', '<=', endOfDay)
            .get();

        let assignmentsToday = 0;
        let wordsToday = 0;
        let creditsToday = 0;

        todaySnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.toolType === 'writing') {
                assignmentsToday++;
            }
            wordsToday += data.wordCount || 0;
            creditsToday += data.creditsUsed || 0;
        });

        res.json({
            success: true,
            date: targetDate,
            stats: {
                assignmentsToday,
                wordsToday,
                creditsToday,
                timeSavedToday: Math.round(wordsToday / 1000) // 1 hour per 1000 words
            }
        });
    } catch (error) {
        console.error('Tool stats error:', error);
        res.status(500).json({ error: 'Failed to get tool statistics' });
    }
});

module.exports = router;