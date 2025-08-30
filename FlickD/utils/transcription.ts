import 'react-native-get-random-values';
import { StartTranscriptionJobCommand, GetTranscriptionJobCommand, LanguageCode } from '@aws-sdk/client-transcribe';
import { PutObjectCommand, GetObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { transcribeClient, s3Client, BUCKET_NAME } from '../config/aws-config';
import * as FileSystem from 'expo-file-system';
import { decode as base64Decode } from 'base-64';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Helper function to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = base64Decode(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const uploadAudioToS3 = async (uri: string, key: string): Promise<string> => {
  try {
    // Determine if this is an image or audio file
    const isImage = uri.toLowerCase().endsWith('.jpg') || uri.toLowerCase().endsWith('.jpeg') || uri.toLowerCase().endsWith('.png');
    const contentType = isImage ? 'image/jpeg' : 'audio/mp4';
    
    // Ensure the key has the correct extension
    if (isImage && !key.toLowerCase().endsWith('.jpg')) {
      key = key.replace(/\.m4a$/, '.jpg');
    } else if (!isImage && !key.toLowerCase().endsWith('.m4a')) {
      key = `${key}.m4a`;
    }

    // First, check if the file exists
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) {
      throw new Error('Audio file does not exist');
    }

    // Read the file content
    const fileContent = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to Uint8Array
    const audioData = base64ToUint8Array(fileContent);

    // Create a proper S3 key with file extension
    const s3Key = `recordings/${Date.now()}-${key}`;

    // Upload to S3 with proper metadata
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: audioData,
      ContentType: contentType,
      ACL: ObjectCannedACL.private,
      Metadata: {
        'x-amz-meta-content-type': contentType,
        'x-amz-meta-cache-control': 'public, max-age=3600'
      },
      CacheControl: 'public, max-age=3600'
    };

    try {
      await s3Client.send(new PutObjectCommand(uploadParams));
    } catch (s3Error) {
      if (s3Error instanceof Error) {
        if (s3Error.message.includes('NoSuchBucket')) {
          throw new Error(`S3 bucket '${BUCKET_NAME}' does not exist. Please create it first.`);
        } else if (s3Error.message.includes('AccessDenied')) {
          throw new Error(`Access denied to S3 bucket '${BUCKET_NAME}'. Please check IAM permissions.`);
        }
      }
      throw s3Error;
    }

    // Construct the S3 URI for Transcribe
    const s3Uri = `s3://${BUCKET_NAME}/${s3Key}`;
    
    return s3Uri;

  } catch (error) {
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
};

export const startStreamingUpload = async (uri: string, key: string): Promise<string> => {
  try {
    // Create a proper S3 key with file extension
    const s3Key = `recordings/${Date.now()}-${key}.m4a`;
    
    // Get file info
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) {
      throw new Error('Audio file does not exist');
    }

    // Read the file content
    const fileContent = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to Uint8Array
    const audioData = base64ToUint8Array(fileContent);

    // Upload to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: audioData,
      ContentType: 'audio/mp4',
      ACL: ObjectCannedACL.private
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Return the S3 URI for transcription
    return `s3://${BUCKET_NAME}/${s3Key}`;
  } catch (error) {
    throw error;
  }
};

export const startTranscriptionJob = async (s3Uri: string, jobName: string): Promise<string> => {
  try {
    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: s3Uri },
      OutputBucketName: BUCKET_NAME,
      OutputKey: `transcriptions/${jobName}.json`,
      LanguageCode: 'en-US',
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2
      }
    });

    await transcribeClient.send(command);
    return jobName;
  } catch (error) {
    throw error;
  }
};

export interface WordTiming {
  text: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptionResult {
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items: Array<{
      start_time?: string;
      end_time?: string;
      alternatives: Array<{
        content: string;
        confidence: number;
      }>;
      type: string;
    }>;
  };
}

export const getTranscriptionResult = async (jobName: string): Promise<TranscriptionResult | null> => {
  try {
    const command = new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    });

    const response = await transcribeClient.send(command);
    
    if (response.TranscriptionJob?.TranscriptionJobStatus === 'COMPLETED') {
      // Get the transcription file from S3
      const transcriptionKey = `transcriptions/${jobName}.json`;
      const getObjectCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: transcriptionKey
      });

      const transcriptionResponse = await s3Client.send(getObjectCommand);
      const transcriptionText = await transcriptionResponse.Body?.transformToString();
      
      if (transcriptionText) {
        return JSON.parse(transcriptionText);
      }
    } else if (response.TranscriptionJob?.TranscriptionJobStatus === 'FAILED') {
      throw new Error('Transcription job failed');
    }
    
    return null;
  } catch (error) {
    throw error;
  }
};

export const getSignedAudioUrl = async (s3Uri: string): Promise<string> => {
  try {
    // Validate input
    if (!s3Uri || typeof s3Uri !== 'string') {
      throw new Error('Invalid S3 URI provided');
    }

    // Convert s3:// URI to key
    const key = s3Uri.replace(`s3://${BUCKET_NAME}/`, '');
    
    if (!key) {
      throw new Error('Invalid S3 key extracted from URI');
    }

    console.log('Generating signed URL for:', { s3Uri, key, bucket: BUCKET_NAME });
    
    // Create the GetObject command with proper content type and headers
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      // Force the response to be treated as an audio file
      ResponseContentType: 'audio/mp4',
      // Ensure the file is downloaded directly
      ResponseContentDisposition: 'attachment; filename="audio.m4a"',
      // Add cache control
      ResponseCacheControl: 'public, max-age=3600',
      // Add CORS headers
      ResponseExpires: new Date(Date.now() + 3600000)
    });

    // Generate signed URL that's valid for 1 hour
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: 3600,
      signableHeaders: new Set([
        'host',
        'x-amz-date',
        'x-amz-content-sha256',
        'x-amz-user-agent',
        'x-amz-security-token'
      ])
    });

    // Validate the generated URL
    if (!signedUrl || typeof signedUrl !== 'string') {
      throw new Error('Generated signed URL is invalid');
    }

    // Ensure URL is using HTTPS and is a direct file URL
    if (!signedUrl.startsWith('https://')) {
      throw new Error('Generated URL must use HTTPS protocol');
    }

    // Test URL format
    try {
      const url = new URL(signedUrl);
      if (!url.hostname || !url.pathname) {
        throw new Error('Generated URL is missing required components');
      }
    } catch (urlError) {
      throw new Error(`Generated URL is malformed: ${urlError instanceof Error ? urlError.message : 'Unknown error'}`);
    }

    // Log the URL for debugging (truncated for security)
    const truncatedUrl = signedUrl.substring(0, 100) + '...';
    console.log('Generated valid audio URL:', truncatedUrl);
    
    return signedUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate signed URL: ${errorMessage}`);
  }
}; 