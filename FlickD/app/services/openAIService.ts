import { API_URL } from '../config';

export interface SummaryRequest {
  transcripts: string[];
  groupName: string;
}

export interface SummaryResponse {
  headline: string;
  summary: string;
}

export const generateSummary = async (request: SummaryRequest): Promise<SummaryResponse> => {
  try {
    const response = await fetch(`${API_URL}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Failed to generate summary');
    }

    return await response.json();
  } catch (error) {
    console.error('Error generating summary:', error);
    throw error;
  }
}; 