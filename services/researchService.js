const { GoogleGenerativeAI } = require('@google/generative-ai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class ResearchService {
  constructor(dbPath = null) {
    // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
    // Required for Gemini 2.5 Pro model used in research generation
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Add your Gemini API key
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    this.dbPath = dbPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'assignment_writer.db');
  }

  /**
   * Get database connection
   */
  getDatabase() {
    return new sqlite3.Database(this.dbPath);
  }

  /**
   * Perform deep research on a given topic using Gemini 2.5 Pro
   */
  async conductResearch(query, researchType = 'general', depth = 3, sources = [], userId) {
    try {
      const researchPrompt = this.buildResearchPrompt(query, researchType, depth, sources);
      
      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: researchPrompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        }
      });

      const response = result.response;
      const researchData = this.parseResearchResponse(response.text());
      
      // Parse sources from the research content
      const extractedSources = this.extractSources(response.text());
      
      // Validate and enhance sources
      const sourceValidation = await this.validateSources(extractedSources, query);
      
      // Calculate word count for credit system
      const wordCount = this.calculateWordCount(response.text());
      
      // Generate research metadata
      const metadata = {
        query,
        researchType,
        depth,
        sources,
        wordCount,
        timestamp: new Date(),
        userId,
        processingTime: Date.now()
      };

      return {
        success: true,
        data: {
          ...researchData,
          sources: sourceValidation.validatedSources || extractedSources,
          sourceValidation: sourceValidation.summary || {},
          recommendations: sourceValidation.recommendations || [],
          qualityScore: sourceValidation.overallScore || 75
        },
        metadata,
        wordCount
      };

    } catch (error) {
      console.error('Research generation error:', error);
      throw new Error(`Research failed: ${error.message}`);
    }
  }

  /**
   * Build comprehensive research prompt based on parameters
   */
  buildResearchPrompt(query, researchType, depth, sources) {
    const depthInstructions = {
      1: 'Provide a basic overview with key points',
      2: 'Include moderate detail with supporting evidence',
      3: 'Comprehensive analysis with multiple perspectives',
      4: 'In-depth research with extensive citations and analysis',
      5: 'Exhaustive research with expert-level detail and cross-references'
    };

    const sourceInstructions = sources.length > 0 
      ? `Focus on these source types: ${sources.join(', ')}` 
      : 'Use diverse, credible sources';

    return `
You are an expert researcher conducting ${researchType} research. Your task is to provide comprehensive research on the following query:

**Research Query:** ${query}

**Research Requirements:**
- Research Type: ${researchType}
- Depth Level: ${depth}/5 (${depthInstructions[depth]})
- Source Preference: ${sourceInstructions}

**Output Format:**
Provide your research in the following structured format:

## Executive Summary
[Brief overview of key findings]

## Main Research Findings
[Detailed research content organized by themes/topics]

## Key Insights
[Important insights and analysis]

## Supporting Evidence
[Citations and references to support findings]

## Methodology
[Brief explanation of research approach]

## Limitations
[Any limitations or gaps in the research]

## Recommendations
[Actionable recommendations based on findings]

## Sources and References
[List of sources used in research]

**Guidelines:**
1. Ensure all information is accurate and well-sourced
2. Provide balanced perspectives on controversial topics
3. Use clear, professional language
4. Include relevant statistics and data where available
5. Cite sources appropriately
6. Maintain objectivity and avoid bias
7. Structure information logically
8. Provide actionable insights

Begin your research now:
`;
  }

  /**
   * Parse and structure the research response from Gemini
   */
  parseResearchResponse(responseText) {
    const sections = {
      executiveSummary: '',
      mainFindings: '',
      keyInsights: '',
      supportingEvidence: '',
      methodology: '',
      limitations: '',
      recommendations: '',
      sources: []
    };

    try {
      // Extract sections using regex patterns
      const summaryMatch = responseText.match(/## Executive Summary\s*([\s\S]*?)(?=##|$)/i);
      if (summaryMatch) sections.executiveSummary = summaryMatch[1].trim();

      const findingsMatch = responseText.match(/## Main Research Findings\s*([\s\S]*?)(?=##|$)/i);
      if (findingsMatch) sections.mainFindings = findingsMatch[1].trim();

      const insightsMatch = responseText.match(/## Key Insights\s*([\s\S]*?)(?=##|$)/i);
      if (insightsMatch) sections.keyInsights = insightsMatch[1].trim();

      const evidenceMatch = responseText.match(/## Supporting Evidence\s*([\s\S]*?)(?=##|$)/i);
      if (evidenceMatch) sections.supportingEvidence = evidenceMatch[1].trim();

      const methodologyMatch = responseText.match(/## Methodology\s*([\s\S]*?)(?=##|$)/i);
      if (methodologyMatch) sections.methodology = methodologyMatch[1].trim();

      const limitationsMatch = responseText.match(/## Limitations\s*([\s\S]*?)(?=##|$)/i);
      if (limitationsMatch) sections.limitations = limitationsMatch[1].trim();

      const recommendationsMatch = responseText.match(/## Recommendations\s*([\s\S]*?)(?=##|$)/i);
      if (recommendationsMatch) sections.recommendations = recommendationsMatch[1].trim();

      const sourcesMatch = responseText.match(/## Sources and References\s*([\s\S]*?)(?=##|$)/i);
      if (sourcesMatch) {
        const sourceText = sourcesMatch[1].trim();
        sections.sources = this.extractSources(sourceText);
      }

      return {
        ...sections,
        fullText: responseText,
        structuredData: true
      };

    } catch (error) {
      console.error('Error parsing research response:', error);
      return {
        fullText: responseText,
        structuredData: false,
        error: 'Failed to parse structured data'
      };
    }
  }

  /**
   * Extract sources from the sources section
   */
  extractSources(sourceText) {
    const sources = [];
    const lines = sourceText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && (trimmedLine.startsWith('-') || trimmedLine.startsWith('*') || trimmedLine.match(/^\d+\./))) {
        const cleanSource = trimmedLine.replace(/^[-*\d.\s]+/, '').trim();
        if (cleanSource) {
          sources.push({
            citation: cleanSource,
            type: this.detectSourceType(cleanSource),
            reliability: this.assessSourceReliability(cleanSource)
          });
        }
      }
    }
    
    return sources;
  }

  /**
   * Detect the type of source (academic, news, website, etc.)
   */
  detectSourceType(citation) {
    const lowerCitation = citation.toLowerCase();
    
    if (lowerCitation.includes('journal') || lowerCitation.includes('doi:') || lowerCitation.includes('pubmed')) {
      return 'academic';
    } else if (lowerCitation.includes('news') || lowerCitation.includes('times') || lowerCitation.includes('post')) {
      return 'news';
    } else if (lowerCitation.includes('gov') || lowerCitation.includes('official')) {
      return 'government';
    } else if (lowerCitation.includes('book') || lowerCitation.includes('isbn')) {
      return 'book';
    } else {
      return 'website';
    }
  }

  /**
   * Assess source reliability based on domain and type
   */
  assessSourceReliability(citation) {
    const lowerCitation = citation.toLowerCase();
    
    // High reliability indicators
    if (lowerCitation.includes('doi:') || 
        lowerCitation.includes('pubmed') || 
        lowerCitation.includes('.gov') ||
        lowerCitation.includes('nature.com') ||
        lowerCitation.includes('science.org')) {
      return 'high';
    }
    
    // Medium reliability indicators
    if (lowerCitation.includes('edu') ||
        lowerCitation.includes('reuters') ||
        lowerCitation.includes('bbc') ||
        lowerCitation.includes('associated press')) {
      return 'medium';
    }
    
    // Default to medium for unknown sources
    return 'medium';
  }

  /**
   * Calculate word count for credit system
   */
  calculateWordCount(text) {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Save research to SQLite history
   */
  async saveResearchToHistory(userId, researchData, metadata) {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase();
      
      db.run(
        `INSERT INTO research_history (
          user_id, query, research_type, depth, sources, results, 
          word_count, credits_used, processing_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          userId,
          metadata.query,
          metadata.researchType || 'general',
          metadata.depth,
          JSON.stringify(metadata.sources || []),
          JSON.stringify(researchData),
          metadata.wordCount,
          metadata.creditsUsed || 0,
          metadata.processingTime
        ],
        function(err) {
          db.close();
          
          if (err) {
            reject(new Error('Failed to save research to history'));
            return;
          }
          
          resolve(this.lastID);
        }
      );
    });
  }

  /**
   * Get user's research history from SQLite
   */
  async getResearchHistory(userId, limit = 20, offset = 0) {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase();
      
      db.all(
        'SELECT * FROM research_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset],
        (err, rows) => {
          db.close();
          
          if (err) {
            reject(new Error('Failed to fetch research history'));
            return;
          }
          
          const history = rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            query: row.query,
            researchType: row.research_type,
            depth: row.depth,
            sources: JSON.parse(row.sources || '[]'),
            results: JSON.parse(row.results || '{}'),
            wordCount: row.word_count,
            creditsUsed: row.credits_used,
            processingTime: row.processing_time,
            timestamp: row.created_at
          }));
          
          resolve(history);
        }
      );
    });
  }

  /**
   * Get specific research by ID from SQLite
   */
  async getResearchById(researchId, userId) {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase();
      
      db.get(
        'SELECT * FROM research_history WHERE id = ? AND user_id = ?',
        [researchId, userId],
        (err, row) => {
          db.close();
          
          if (err) {
            reject(new Error('Database error fetching research'));
            return;
          }
          
          if (!row) {
            reject(new Error('Research not found'));
            return;
          }
          
          resolve({
            id: row.id,
            userId: row.user_id,
            query: row.query,
            researchType: row.research_type,
            depth: row.depth,
            sources: JSON.parse(row.sources || '[]'),
            results: JSON.parse(row.results || '{}'),
            wordCount: row.word_count,
            creditsUsed: row.credits_used,
            processingTime: row.processing_time,
            timestamp: row.created_at
          });
        }
      );
    });
  }

  /**
   * Calculate research credits based on depth and word count
   */
  calculateResearchCredits(wordCount, depth = 3) {
    // Base rate: 1 credit per 5 words for research (1:5 ratio)
    const baseCredits = Math.ceil(wordCount / 5);
    
    // Depth multiplier
    const depthMultipliers = {
      1: 0.8,  // Basic research
      2: 1.0,  // Standard research
      3: 1.2,  // Comprehensive research
      4: 1.5,  // In-depth research
      5: 2.0   // Exhaustive research
    };
    
    const multiplier = depthMultipliers[depth] || 1.0;
    return Math.ceil(baseCredits * multiplier);
  }

  /**
   * Validate sources using simple validation
   */
  async validateSources(sources, researchTopic = null) {
    try {
      const validatedSources = sources.map(source => ({
        ...source,
        validated: true,
        validationDate: new Date()
      }));
      
      // Calculate basic validation summary
      const totalSources = validatedSources.length;
      const highReliability = validatedSources.filter(s => s.reliability === 'high').length;
      const mediumReliability = validatedSources.filter(s => s.reliability === 'medium').length;
      const lowReliability = validatedSources.filter(s => s.reliability === 'low').length;
      
      const overallScore = Math.round(
        ((highReliability * 3 + mediumReliability * 2 + lowReliability * 1) / (totalSources * 3)) * 100
      );
      
      return {
        success: true,
        validatedSources,
        summary: {
          total: totalSources,
          highReliability,
          mediumReliability,
          lowReliability,
          flagged: 0
        },
        recommendations: this.generateSourceRecommendations(highReliability, mediumReliability, lowReliability, totalSources),
        overallScore: Math.max(0, overallScore)
      };
      
    } catch (error) {
      console.error('Source validation error:', error);
      return {
        success: false,
        error: error.message,
        validatedSources: sources,
        summary: { total: sources.length, highReliability: 0, mediumReliability: 0, lowReliability: 0, flagged: 0 },
        recommendations: [],
        overallScore: 50
      };
    }
  }

  /**
   * Generate source recommendations
   */
  generateSourceRecommendations(high, medium, low, total) {
    const recommendations = [];
    
    if (low > total * 0.3) {
      recommendations.push({
        type: 'quality',
        priority: 'high',
        message: 'Consider replacing low-reliability sources with more authoritative ones'
      });
    }
    
    if (high < total * 0.5) {
      recommendations.push({
        type: 'improvement',
        priority: 'medium',
        message: 'Add more high-reliability sources (academic, government, or established publications)'
      });
    }
    
    if (total < 3) {
      recommendations.push({
        type: 'coverage',
        priority: 'medium',
        message: 'Consider adding more sources for comprehensive coverage'
      });
    }
    
    return recommendations;
  }
}

module.exports = ResearchService;