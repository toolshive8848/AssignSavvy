const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const admin = require('firebase-admin');
const path = require('path');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            // Production: Use service account key
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: process.env.FIREBASE_PROJECT_ID
            });
        } else {
            // Development: Use default credentials
            admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID || 'assignsavvy-dev'
            });
        }
        console.log('✅ Firebase Admin SDK initialized successfully');
    } catch (error) {
        console.error('❌ Firebase initialization failed:', error);
        if (NODE_ENV === 'production') {
            process.exit(1);
        }
    }
}

// CORS origins from environment or defaults
const corsOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'];

// File size limit from environment or default
const fileSizeLimit = process.env.MAX_FILE_SIZE || '50mb';

// Middleware
app.use(helmet({
    contentSecurityPolicy: process.env.HELMET_CSP !== 'false',
    crossOriginEmbedderPolicy: process.env.HELMET_COEP !== 'false'
}));
app.use(cors({
    origin: corsOrigins,
    credentials: true
}));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: fileSizeLimit }));
app.use(express.urlencoded({ extended: true, limit: fileSizeLimit }));

// Serve static files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// Serve HTML files and assets
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// Make Firebase available to routes
app.locals.db = admin.firestore();
app.locals.auth = admin.auth();

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/research', require('./research'));
app.use('/api/detector', require('./routes/detector'));
app.use('/api/prompt', require('./routes/promptEngineer'));
app.use('/api/writer', require('./routes/writer'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        firebase: admin.apps.length > 0 ? 'connected' : 'disconnected'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Graceful shutdown...');
    try {
        await admin.app().delete();
        console.log('Firebase connection closed.');
    } catch (error) {
        console.error('Error during shutdown:', error);
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`CORS Origins: ${corsOrigins.join(', ')}`);
    console.log(`Firebase Project: ${process.env.FIREBASE_PROJECT_ID || 'assignsavvy-dev'}`);
    
    // Log API key status (without exposing actual keys)
    console.log('API Keys Status:');
    console.log(`- Gemini: ${process.env.GEMINI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Originality.ai: ${process.env.ORIGINALITY_AI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Firebase: ${admin.apps.length > 0 ? '✓ Connected' : '✗ Not Connected'}`);
    
    // Critical API key validation
    const missingKeys = [];
    if (!process.env.GEMINI_API_KEY) missingKeys.push('GEMINI_API_KEY');
    if (!process.env.ORIGINALITY_AI_API_KEY) missingKeys.push('ORIGINALITY_AI_API_KEY');
    
    if (missingKeys.length > 0) {
        console.error('❌ CRITICAL: Missing required API keys:', missingKeys.join(', '));
        console.error('❌ Application will not function properly without these keys!');
        console.error('❌ Please set these environment variables before deployment.');
        
        if (NODE_ENV === 'production') {
            console.error('❌ PRODUCTION MODE: Exiting due to missing API keys');
            process.exit(1);
        }
    } else {
        console.log('✅ All required API keys are configured');
    }
});