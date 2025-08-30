const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { TranscribeClient, StartTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');
const crypto = require('crypto');
const { voiceMessageCache } = require('./redisClient');
const { voiceMessageMetrics } = require('./metrics');
const { ObjectId } = require('mongodb');
const { getIO } = require('../socket');
const { publishTranscriptionReady } = require('./redisPubSub');
const fs = require('fs').promises;

// AWS Clients
const snsClient = new SNSClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });

// Helper function to calculate audio hash
const calculateAudioHash = async (audioUrl) => {
  try {
    // Extract the file path from the URL
    const filePath = audioUrl.replace('file://', '');
    
    // Read the file
    const fileBuffer = await fs.readFile(filePath);
    
    // Calculate SHA-256 hash
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    
    return hash.digest('hex');
  } catch (error) {
    console.error('Error calculating audio hash:', error);
    return null;
  }
};

// Generate audio hash for deduplication
const generateAudioHash = async (audioUrl) => {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: audioUrl.replace(`s3://${process.env.S3_BUCKET_NAME}/`, '')
    }));
    
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    console.error('Error generating audio hash:', error);
    return null;
  }
};

// Start transcription job with event-driven completion
const startTranscription = async (messageId, audioUrl, groupChatId) => {
  const startTime = Date.now();

  voiceMessageMetrics.startTranscription(messageId);

  try {
    // Check for existing transcription by audio hash
    const audioHash = await generateAudioHash(audioUrl);

    if (audioHash) {
      const cachedTranscription = await voiceMessageCache.getTranscriptionByHash(audioHash);
      if (cachedTranscription) {
        await handleTranscriptionComplete(messageId, cachedTranscription, groupChatId);
        return `cached-${audioHash.substring(0, 8)}`;
      }
    }

    // Start transcription job
    const jobName = `transcription-${messageId}-${Date.now()}`;

    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: audioUrl },
      OutputBucketName: process.env.S3_BUCKET_NAME,
      OutputKey: `transcriptions/${jobName}.json`,
      LanguageCode: 'en-US',
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2
      }
    });

    // Start job and set up SNS notification
    const [transcriptionResponse, snsResponse] = await Promise.all([
      transcribeClient.send(command),
      snsClient.send(new PublishCommand({
        TopicArn: process.env.TRANSCRIPTION_TOPIC_ARN,
        Message: JSON.stringify({
          messageId,
          jobName,
          groupChatId,
          audioHash
        })
      }))
    ]);

    // Set up 15-second timeout to return empty transcription
    setTimeout(async () => {
      try {
        const { getCollection } = require('../database/collections');
        const recordedMessagesCollection = getCollection('recordedMessages');
        
        // Check if message is still processing
        const message = await recordedMessagesCollection.findOne({ _id: new ObjectId(messageId) });
        if (message && message.processingStatus === 'processing') {
          // Create empty transcription object
          const emptyTranscription = {
            results: {
              transcripts: [{ transcript: '' }],
              items: []
            }
          };
          
          // Update message with empty transcription
          await handleTranscriptionComplete(messageId, emptyTranscription, groupChatId);
        }
      } catch (error) {
        console.error(`Error handling 15-second timeout for message ${messageId}:`, error);
      }
    }, 15000); // 15 seconds

    return jobName;
  } catch (error) {
    console.error('Transcription start error:', {
      messageId,
      error: error.message,
      stack: error.stack,
      timeElapsed: Date.now() - startTime
    });
    voiceMessageMetrics.endTranscription(messageId, { error: error.message });
    throw error;
  }
};

// Handle transcription completion
const handleTranscriptionComplete = async (messageId, transcription, groupChatId) => {
  const startTime = Date.now();
  let audioHash = null;

  try {
    // Get the collection when needed
    const { getCollection } = require('../database/collections');
    const recordedMessagesCollection = getCollection('recordedMessages');

    // Get the message to verify it exists and get audio hash
    const message = await recordedMessagesCollection.findOne({ _id: new ObjectId(messageId) });
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Calculate audio hash if not provided
    if (!audioHash && message.audioUrl) {
      audioHash = await generateAudioHash(message.audioUrl);
    }

    // Update MongoDB with transaction
    const updateResult = await recordedMessagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { 
        $set: { 
          transcription,
          processingStatus: 'completed',
          completedAt: new Date(),
          audioHash
        }
      }
    );

    if (updateResult.modifiedCount === 0) {
      throw new Error('Failed to update message with transcription');
    }

    // Cache transcription with retry
    const cachePromises = [
      retryOperation(() => voiceMessageCache.setTranscription(messageId, transcription), 3),
      retryOperation(() => voiceMessageCache.setTranscriptionByHash(audioHash, transcription), 3)
    ];

    await Promise.all(cachePromises).catch(error => {
      console.warn('Cache update error:', error);
      // Continue execution as cache updates are not critical
    });

    // End metrics
    voiceMessageMetrics.endTranscription(messageId, {
      transcriptionLength: transcription?.results?.transcripts?.[0]?.transcript?.length || 0,
      processingTime: Date.now() - startTime
    });

    // Publish transcription ready event
    try {
      await publishTranscriptionReady(messageId, transcription);
    } catch (error) {
      console.warn('Failed to publish transcription ready event:', error);
      // Continue execution as this is not critical
    }

    // Also emit socket event directly for immediate delivery
    const io = getIO();
    if (io) {
      // Convert groupChatId to string if it's an ObjectId
      const groupChatIdString = typeof groupChatId === 'object' ? groupChatId.toString() : groupChatId;
      io.to(groupChatIdString).emit('transcription:ready', {
        messageId,
        transcription
      });
    }

  } catch (error) {
    console.error('Transcription completion error:', {
      messageId,
      error: error.message,
      stack: error.stack,
      timeElapsed: Date.now() - startTime
    });
    throw error;
  }
};

// Helper function for retrying operations
const retryOperation = async (operation, maxRetries) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  throw lastError;
};

// Lambda handler for transcription completion events
const handleTranscriptionEvent = async (event) => {
  try {
    const { messageId, jobName, groupChatId, audioHash } = JSON.parse(event.Records[0].Sns.Message);
    
    // Get transcription result from S3
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `transcriptions/${jobName}.json`
    }));
    
    const transcription = JSON.parse(await response.Body.transformToString());
    
    // Handle completion
    await handleTranscriptionComplete(messageId, transcription, groupChatId);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Transcription processed successfully' })
    };
  } catch (error) {
    console.error('Lambda handler error:', {
      error: error.message,
      stack: error.stack,
      event: JSON.stringify(event, null, 2)
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process transcription' })
    };
  }
};

module.exports = {
  startTranscription,
  handleTranscriptionEvent,
  handleTranscriptionComplete,
  generateAudioHash
}; 