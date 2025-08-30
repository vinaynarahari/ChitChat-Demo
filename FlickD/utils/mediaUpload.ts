import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from '../config/aws-config';
import * as FileSystem from 'expo-file-system';
import { decode as base64Decode } from 'base-64';

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

export async function uploadMediaToS3(uri: string, type: 'image' | 'video'): Promise<string> {
  try {
    // Verify file exists
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) {
      throw new Error('File does not exist');
    }

    const timestamp = Date.now();
    const fileExtension = type === 'image' ? 'jpg' : 'mp4';
    const key = `groupchat/${type}/${timestamp}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
    
    const fileContent = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const fileData = base64ToUint8Array(fileContent);
    const mimeType = type === 'image' ? 'image/jpeg' : 'video/mp4';

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileData,
      ContentType: mimeType
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const mediaUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
    
    return mediaUrl;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to upload media: ${error.message}`);
    }
    throw error;
  }
} 