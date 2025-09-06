const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Register new user
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    const db = req.app.locals.db;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (existingUser) {
                return res.status(400).json({ error: 'User already exists with this email' });
            }

            // Hash password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Create user
            db.run(
                'INSERT INTO users (name, email, password_hash, credits) VALUES (?, ?, ?, ?)',
                [name, email, passwordHash, 200], // Default 200 credits for new users
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Failed to create user' });
                    }

                    const userId = this.lastID;

                    // Generate JWT token
                    const token = jwt.sign(
                        { userId: userId, email: email },
                        JWT_SECRET,
                        { expiresIn: JWT_EXPIRES_IN }
                    );

                    res.status(201).json({
                        message: 'User created successfully',
                        token: token,
                        user: {
                            id: userId,
                            name: name,
                            email: email,
                            credits: 200,
                            is_premium: false
                        }
                    });
                }
            );
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login user
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const db = req.app.locals.db;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        db.get(
            'SELECT * FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                if (!user) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                // Verify password
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                if (!isValidPassword) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { userId: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: JWT_EXPIRES_IN }
                );

                res.json({
                    message: 'Login successful',
                    token: token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        credits: user.credits,
                        is_premium: user.is_premium === 1
                    }
                });
            }
        );
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get user profile
router.get('/profile', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const db = req.app.locals.db;

    db.get(
        'SELECT id, name, email, credits, is_premium, created_at FROM users WHERE id = ?',
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
                memberSince: user.created_at
            });
        }
    );
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

module.exports = router;