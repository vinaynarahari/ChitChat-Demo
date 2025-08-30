const crypto = require('crypto');

class SummaryGenerator {
  constructor() {
    this.cache = new Map();
  }

  async generateSummary(transcripts) {
    try {
      const combinedText = this.combineTranscripts(transcripts);
      
      if (!combinedText || combinedText.trim().length === 0) {
        return null;
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(combinedText);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Generate summary using rule-based approach
      const summary = this.generateRuleBasedSummary(combinedText);
      
      // Cache the result
      this.cache.set(cacheKey, summary);
      
      return summary;
    } catch (error) {
      console.error('Summary generation error:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  generateRuleBasedSummary(text) {
    // Split into sentences
    const sentences = text.split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length === 0) {
      return '';
    }

    // If text is short, return it as is
    if (sentences.length <= 3) {
      return text;
    }

    // Extract key sentences:
    // 1. First sentence (usually contains the main topic)
    // 2. Middle sentence (often contains supporting details)
    // 3. Last sentence (often contains conclusion)
    const firstSentence = sentences[0];
    const middleSentence = sentences[Math.floor(sentences.length / 2)];
    const lastSentence = sentences[sentences.length - 1];

    // Combine the sentences
    const summary = [firstSentence, middleSentence, lastSentence]
      .filter(s => s && s.length > 0)
      .join('. ');

    // Add period if missing
    return summary.endsWith('.') ? summary : summary + '.';
  }

  combineTranscripts(transcripts) {
    if (!Array.isArray(transcripts) || transcripts.length === 0) {
      return '';
    }

    // Extract actual transcript text from the nested structure
    const transcriptTexts = transcripts.map(t => {
      try {
        // Handle string transcripts
        if (typeof t === 'string') return t;
        
        // Handle full transcript objects
        if (t.results?.transcripts?.[0]?.transcript) {
          return t.results.transcripts[0].transcript;
        }
        
        // Handle nested transcription objects
        if (t.transcription?.results?.transcripts?.[0]?.transcript) {
          return t.transcription.results.transcripts[0].transcript;
        }

        // If we have items, try to reconstruct the transcript
        if (t.results?.items) {
          return t.results.items
            .map(item => item.alternatives?.[0]?.content || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }

        return '';
      } catch (error) {
        console.error('Error processing transcript:', error);
        return '';
      }
    });

    // Combine transcripts with proper formatting
    return transcriptTexts
      .map(t => t.trim())
      .filter(t => t.length > 0)
      .join('. ');
  }

  generateCacheKey(text) {
    return crypto
      .createHash('md5')
      .update(text)
      .digest('hex');
  }
}

// Create a singleton instance
const summaryGenerator = new SummaryGenerator();

module.exports = summaryGenerator; 