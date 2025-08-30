import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { S3Client } from '@aws-sdk/client-s3';

// AWS Configuration
const region = 'us-east-2';

// S3 Bucket Configuration
export const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'svf12345awsbucket';
export const BUCKET_REGION = process.env.AWS_REGION || 'us-east-2';

// AWS Clients - only create if credentials are available
const createAwsClients = () => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || 'AKIA5FSDACUL5DKXB77B';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '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';
  
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured');
  }
  
  const credentials = {
    accessKeyId,
    secretAccessKey,
  };
  
  return {
    s3Client: new S3Client({
      region: BUCKET_REGION,
      credentials
    }),
    transcribeClient: new TranscribeClient({
      region: BUCKET_REGION,
      credentials
    })
  };
};

export const { s3Client, transcribeClient } = createAwsClients(); 