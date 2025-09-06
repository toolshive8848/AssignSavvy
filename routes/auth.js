const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

/**
 * Authentication routes using Firebase Auth
 * Handles user registration, login, and profile management
 */

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, plan = 'free' } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        // Create user in Firebase Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: name
        });

        // Determine initial credits based on plan
        const initialCredits = {
            free: 200,
            pro: 2000,
            custom: 3300
        };

        // Create user document in Firestore
        const userDoc = {
            uid: userRecord.uid,
            name,
            email,
            plan,
            credits: initialCredits[plan] || 200,
            isPremium: plan !== 'free',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await admin.firestore().collection('users').doc(userRecord.uid).set(userDoc);

        // Generate custom token for client
        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        res.status(201).json({
            message: 'User created successfully',
            token: customToken,
            user: {
                uid: userRecord.uid,
                name,
                email,
                plan,
                credits: userDoc.credits,
                isPremium: userDoc.isPremium
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        
        if (error.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'User already exists with this email' });
        }
        
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Get user by email
        const userRecord = await admin.auth().getUserByEmail(email);
        
        // Get user document from Firestore
        const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User profile not found' });
        }

        const userData = userDoc.data();

        // Generate custom token for client
        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        res.json({
            message: 'Login successful',
            token: customToken,
            user: {
                uid: userRecord.uid,
                name: userData.name,
                email: userData.email,
                plan: userData.plan || 'free',
                credits: userData.credits || 200,
                isPremium: userData.isPremium || false
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        
        if (error.code === 'auth/user-not-found') {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        const userDoc = await admin.firestore().collection('users').doc(userId).get();
        
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
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { name } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters long' });
        }

        await admin.firestore().collection('users').doc(userId).update({
            name: name.trim(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ message: 'Profile updated successfully', name: name.trim() });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Middleware to verify Firebase ID token
async function authenticateToken(req, res, next) {
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
}

module.exports = router;