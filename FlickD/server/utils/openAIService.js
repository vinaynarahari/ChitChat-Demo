const { OpenAI } = require('openai');
const config = require('../config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

class OpenAIService {
  async generateSummary(transcripts, groupName) {
    try {
      const combinedText = transcripts.join(' ');
      
      const prompt = `You are a skilled journalist creating a newspaper headline and summary for a group chat conversation.
      Group Name: ${groupName}
      Conversation: ${combinedText}
      
      Please provide:
      1. A catchy, engaging headline (max 10 words) that uses direct quotes from the conversation if possible.
      2. A concise summary (max 3 sentences) that uses direct text evidence (quotes) from the conversation to support the summary.
      
      Format the response as JSON:
      {
        "headline": "your headline here",
        "summary": "your summary here"
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a skilled journalist creating engaging headlines and summaries for group chat conversations."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error('Failed to generate summary using OpenAI');
    }
  }
}

module.exports = new OpenAIService(); 