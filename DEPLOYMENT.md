# AssignSavvy - Firebase/Google Cloud Deployment Guide

## Overview
This is a full-stack academic assignment writing platform with AI-powered tools for writing, research, plagiarism detection, and prompt engineering, built for Google Cloud deployment with Firebase.

## Architecture
- **Frontend**: Static HTML/CSS/JavaScript
- **Backend**: Node.js/Express API server
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Storage**: Firebase Storage (for file uploads)
- **Hosting**: Google Cloud Run + Firebase Hosting
- **AI Services**: Google Gemini API + Originality.ai

## Prerequisites
- Google Cloud Platform account
- Firebase project
- Node.js 18+ and npm
- API keys for external services

## Quick Start

### 1. Firebase Project Setup
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase project
firebase init

# Select:
# - Firestore
# - Functions (for backend)
# - Hosting (for frontend)
# - Storage
```

### 2. Environment Setup
Copy the example environment file and configure your keys:
```bash
cp .env.example .env
```

Edit `.env` with your actual configuration:
- **Required**: `FIREBASE_PROJECT_ID` (your Firebase project ID)
- **Required**: `FIREBASE_SERVICE_ACCOUNT_KEY` (service account JSON)
- **Required**: `GEMINI_API_KEY` (get from https://aistudio.google.com/app/apikey)
- **Required**: `ORIGINALITY_AI_API_KEY` (get from https://originality.ai/api)
- **Required**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (get from https://dashboard.stripe.com/apikeys)
- **Optional**: `ZOTERO_API_KEY` (get from https://www.zotero.org/settings/keys)

### 3. Firestore Database Setup
The Firestore database will be automatically initialized with the following collections:
- `users` - User profiles and credit balances
- `assignments` - Generated assignments
- `researchHistory` - Research queries and results
- `contentHistory` - Generated content history
- `usageTracking` - Credit usage transactions
- `detectorResults` - Content analysis results
- `promptOptimizations` - Prompt engineering history

### 4. Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# The server will start on http://localhost:5000
```

### 5. Firebase Functions Deployment
```bash
# Deploy backend as Firebase Function
firebase deploy --only functions

# Deploy frontend to Firebase Hosting
firebase deploy --only hosting
```

## Features

### Available Tools (All Functional)
- **AI Writer**: Generate academic content with Gemini 2.5 Pro/Flash
  - **Standard Generation**: Fast content generation (1 credit per 3 words)
  - **Premium Generation**: Enhanced quality with 2-loop refinement (2x credits)
- **Researcher**: AI-powered research with Gemini 2.5 Pro (1 credit per 5 words)
- **Detector**: Plagiarism and AI content detection with Originality.ai (50 credits per 1000 words)
- **Prompt Engineer**: Optimize prompts with Gemini Flash (1 credit per 10 input + 1 credit per 5 output words)

### User System
- Firebase Authentication with email/password
- Credit-based usage system stored in Firestore
- Real-time credit tracking and atomic transactions
- Stripe payment integration for credit purchases

## API Endpoints

### Authentication (Firebase Auth)
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Tools
- `POST /api/writer/generate` - Generate content (supports `qualityTier`: 'standard' or 'premium')
- `POST /api/writer/upload-and-generate` - Generate content from uploaded files
- `POST /api/research/query` - Research topics with depth levels
- `POST /api/detector/analyze` - Check for plagiarism/AI content
- `POST /api/detector/workflow` - Complete detection and improvement workflow
- `POST /api/prompt/optimize` - Optimize prompts

### User Management
- `GET /api/users/credits` - Get user credit balance
- `GET /api/users/stats` - Get usage statistics
- `GET /api/users/transactions` - Get transaction history

### Content Management
- `GET /api/assignments/history` - Get assignment history
- `GET /api/research/history` - Get research history
- `POST /api/assignments/save-to-history` - Save content to history

## Google Cloud Deployment

### 1. Cloud Run Deployment
```bash
# Build Docker image
docker build -t gcr.io/[PROJECT-ID]/assignsavvy .

# Push to Google Container Registry
docker push gcr.io/[PROJECT-ID]/assignsavvy

# Deploy to Cloud Run
gcloud run deploy assignsavvy \
  --image gcr.io/[PROJECT-ID]/assignsavvy \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### 2. Environment Variables for Cloud Run
Set these in Cloud Run console:
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GEMINI_API_KEY=your-gemini-key
ORIGINALITY_AI_API_KEY=your-originality-key
STRIPE_SECRET_KEY=your-stripe-key
NODE_ENV=production
```

### 3. Firebase Hosting Setup
```bash
# Configure firebase.json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "/api/**",
        "run": {
          "serviceId": "assignsavvy"
        }
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}

# Deploy frontend
firebase deploy --only hosting
```

## Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can read/write their own content
    match /assignments/{assignmentId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.userId;
    }
    
    match /researchHistory/{researchId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.userId;
    }
    
    match /contentHistory/{contentId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.userId;
    }
    
    match /usageTracking/{trackingId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.userId;
    }
  }
}
```

## Configuration

### Credit System
- **Free Users**: 200 credits
- **Pro Users**: 2000 credits  
- **Custom Users**: 3300 credits

### Tool Credit Costs
- **Writing (Standard)**: 1 credit per 3 words
- **Writing (Premium)**: 2 credits per 3 words (includes 2-loop refinement)
- **Research**: 1 credit per 5 words (with depth multipliers)
- **Detection**: 50 credits per 1000 words
- **Detector Generation**: 1 credit per 5 words
- **Prompt Engineering**: 1 credit per 10 input words + 1 credit per 5 output words

## Production Deployment Checklist

### 1. Firebase Setup
- [ ] Create Firebase project
- [ ] Enable Firestore
- [ ] Enable Authentication
- [ ] Enable Storage
- [ ] Configure security rules

### 2. Google Cloud Setup
- [ ] Enable Cloud Run API
- [ ] Enable Container Registry API
- [ ] Set up service account with proper permissions

### 3. Environment Configuration
- [ ] Set all required environment variables
- [ ] Configure Firebase service account key
- [ ] Set up Stripe webhook endpoints
- [ ] Configure CORS for production domain

### 4. Security Considerations
- [ ] Use strong JWT secrets
- [ ] Configure Firestore security rules
- [ ] Enable HTTPS in production
- [ ] Set up proper IAM roles
- [ ] Regularly rotate API keys

### 5. Monitoring
- [ ] Set up Cloud Logging
- [ ] Configure error reporting
- [ ] Set up uptime monitoring
- [ ] Monitor credit usage patterns

## Support
For deployment issues, check:
1. Firebase console for authentication/database errors
2. Cloud Run logs for backend errors
3. Browser console for frontend errors
4. Ensure all API keys are properly configured

## Cost Optimization
- Use Firebase Spark plan for development
- Monitor Firestore read/write operations
- Implement caching for frequently accessed data
- Use Cloud Run concurrency settings appropriately