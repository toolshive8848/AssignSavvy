@@ .. @@
 const express = require('express');
 const jwt = require('jsonwebtoken');
+const AtomicCreditSystem = require('../services/atomicCreditSystem');
 const router = express.Router();

 const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

+// Initialize atomic credit system
+const atomicCreditSystem = new AtomicCreditSystem();
+
 // Middleware to verify JWT token
 const authenticateToken = (req, res, next) => {
     const token = req.headers.authorization?.split(' ')[1];
     
     if (!token) {
         return res.status(401).json({ error: 'Access token required' });
     }

     try {
         const decoded = jwt.verify(token, JWT_SECRET);
         req.user = decoded;
         next();
     } catch (error) {
         return res.status(403).json({ error: 'Invalid or expired token' });
     }
 };

 // Get user profile and credits
 router.get('/profile', authenticateToken, (req, res) => {
     const userId = req.user.userId;
     const db = req.app.locals.db;

     db.get(
         'SELECT id, name, email, credits, is_premium, subscription_end_date, created_at FROM users WHERE id = ?',
         [userId],
         (err, user) => {
             if (err) {
                 console.error('Database error:', err);
                 return res.status(500).json({ error: 'Database error' });
             }

             if (!user) {
                 return res.status(404).json({ error: 'User not found' });
             }

             res.json({
                 id: user.id,
                 name: user.name,
                 email: user.email,
                 credits: user.credits,
                 isPremium: user.is_premium === 1,
                 subscriptionEndDate: user.subscription_end_date,
                 memberSince: user.created_at
             });
         }
     );
 });

 // Get user's credit usage statistics
 router.get('/stats', authenticateToken, (req, res) => {
     const userId = req.user.userId;
     const db = req.app.locals.db;

     // Get total assignments and credits used
     db.all(`
         SELECT 
             COUNT(*) as total_assignments,
             SUM(credits_used) as total_credits_used,
             AVG(originality_score) as avg_originality_score
         FROM assignments 
         WHERE user_id = ? AND status = 'completed'
         
         UNION ALL
         
         SELECT 
             COUNT(*) as this_month_assignments,
             SUM(credits_used) as this_month_credits,
             AVG(originality_score) as this_month_avg_score
         FROM assignments 
         WHERE user_id = ? AND status = 'completed' 
         AND created_at >= date('now', 'start of month')
     `, [userId, userId], (err, rows) => {
         if (err) {
             console.error('Database error:', err);
             return res.status(500).json({ error: 'Database error' });
         }

         const allTime = rows[0] || { total_assignments: 0, total_credits_used: 0, avg_originality_score: null };
         const thisMonth = rows[1] || { this_month_assignments: 0, this_month_credits: 0, this_month_avg_score: null };

         res.json({
             allTime: {
                 totalAssignments: allTime.total_assignments || 0,
                 totalCreditsUsed: allTime.total_credits_used || 0,
                 averageOriginalityScore: allTime.avg_originality_score ? Math.round(allTime.avg_originality_score * 100) / 100 : null
             },
             thisMonth: {
                 totalAssignments: thisMonth.this_month_assignments || 0,
                 creditsUsed: thisMonth.this_month_credits || 0,
                 averageOriginalityScore: thisMonth.this_month_avg_score ? Math.round(thisMonth.this_month_avg_score * 100) / 100 : null
             }
         });
     });
 });

 // Update user profile
 router.put('/profile', authenticateToken, (req, res) => {
     const userId = req.user.userId;
     const { name } = req.body;
     const db = req.app.locals.db;

     if (!name || name.trim().length < 2) {
         return res.status(400).json({ error: 'Name must be at least 2 characters long' });
     }

     db.run(
         'UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
         [name.trim(), userId],
         function(err) {
             if (err) {
                 console.error('Database error:', err);
                 return res.status(500).json({ error: 'Database error' });
             }

             if (this.changes === 0) {
                 return res.status(404).json({ error: 'User not found' });
             }

             res.json({ message: 'Profile updated successfully', name: name.trim() });
         }
     );
 });

-// Manual credit refresh (for testing - in production this would be automated monthly)
-router.post('/refresh-credits', authenticateToken, (req, res) => {
+// Get current credit balance using atomic system
+router.get('/credits', authenticateToken, async (req, res) => {
+    try {
+        const userId = req.user.userId;
+        const creditBalance = await atomicCreditSystem.getCreditBalance(userId);
+        
+        res.json({
+            success: true,
+            credits: creditBalance.currentBalance,
+            totalCreditsUsed: creditBalance.totalCreditsUsed,
+            totalWordsGenerated: creditBalance.totalWordsGenerated,
+            lastCreditDeduction: creditBalance.lastCreditDeduction
+        });
+    } catch (error) {
+        console.error('Error getting credit balance:', error);
+        res.status(500).json({ error: 'Failed to get credit balance' });
+    }
+});
+
+// Deduct credits using atomic system (for admin/testing purposes)
+router.post('/deduct-credits', authenticateToken, async (req, res) => {
+    try {
+        const userId = req.user.userId;
+        const { amount, toolType = 'manual', planType = 'free' } = req.body;
+        
+        if (!amount || amount <= 0) {
+            return res.status(400).json({ error: 'Valid credit amount is required' });
+        }
+        
+        const result = await atomicCreditSystem.deductCreditsAtomic(
+            userId,
+            amount,
+            planType,
+            toolType
+        );
+        
+        if (result.success) {
+            res.json({
+                success: true,
+                message: 'Credits deducted successfully',
+                creditsDeducted: result.creditsDeducted,
+                newBalance: result.newBalance,
+                transactionId: result.transactionId
+            });
+        } else {
+            res.status(400).json({
+                error: 'Credit deduction failed',
+                details: result.error
+            });
+        }
+    } catch (error) {
+        console.error('Error deducting credits:', error);
+        res.status(500).json({ error: 'Failed to deduct credits' });
+    }
+});
+
+// Manual credit refresh (for testing - in production this would be automated monthly)
+router.post('/refresh-credits', authenticateToken, async (req, res) => {
     const userId = req.user.userId;
     const db = req.app.locals.db;

-    db.get('SELECT is_premium FROM users WHERE id = ?', [userId], (err, user) => {
+    db.get('SELECT is_premium, plan FROM users WHERE id = ?', [userId], (err, user) => {
         if (err) {
             console.error('Database error:', err);
             return res.status(500).json({ error: 'Database error' });
         }

         if (!user) {
             return res.status(404).json({ error: 'User not found' });
         }

-        const newCredits = user.is_premium === 1 ? 2000 : 200;
+        // Determine credits based on plan
+        let newCredits = 200; // Default free plan
+        if (user.is_premium === 1 || user.plan === 'pro') {
+            newCredits = 2000;
+        } else if (user.plan === 'custom') {
+            newCredits = 3300;
+        }

         db.run(
             'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
             [newCredits, userId],
             function(err) {
                 if (err) {
                     console.error('Database error:', err);
                     return res.status(500).json({ error: 'Database error' });
                 }

                 res.json({ 
                     message: 'Credits refreshed successfully', 
                     newCredits: newCredits,
-                    isPremium: user.is_premium === 1
+                    isPremium: user.is_premium === 1,
+                    plan: user.plan || 'free'
                 });
             }
         );
     });
 });

+// Get transaction history using atomic system
+router.get('/transactions', authenticateToken, async (req, res) => {
+    try {
+        const userId = req.user.userId;
+        const limit = parseInt(req.query.limit) || 50;
+        
+        if (limit > 100) {
+            return res.status(400).json({ error: 'Limit cannot exceed 100' });
+        }
+        
+        const transactions = await atomicCreditSystem.getTransactionHistory(userId, limit);
+        
+        res.json({
+            success: true,
+            transactions,
+            count: transactions.length
+        });
+    } catch (error) {
+        console.error('Error getting transaction history:', error);
+        res.status(500).json({ error: 'Failed to get transaction history' });
+    }
+});
+
 module.exports = router;