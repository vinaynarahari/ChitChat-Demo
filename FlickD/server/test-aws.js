const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { SNSClient, ListTopicsCommand } = require('@aws-sdk/client-sns');
require('dotenv').config();

async function testAWSConfig() {
    console.log('Testing AWS Configuration...');
    console.log('Region:', process.env.AWS_REGION);
    console.log('S3 Bucket:', process.env.S3_BUCKET_NAME);
    console.log('SNS Topic:', process.env.TRANSCRIPTION_TOPIC_ARN);

    try {
        // Test S3
        const s3Client = new S3Client({ region: process.env.AWS_REGION });
        const buckets = await s3Client.send(new ListBucketsCommand({}));
        console.log('\nS3 Buckets:', buckets.Buckets.map(b => b.Name));

        // Test SNS
        const snsClient = new SNSClient({ region: process.env.AWS_REGION });
        const topics = await snsClient.send(new ListTopicsCommand({}));
        console.log('\nSNS Topics:', topics.Topics.map(t => t.TopicArn));

        console.log('\n✅ AWS Configuration is working!');
    } catch (error) {
        console.error('\n❌ AWS Configuration Error:', error);
    }
}

testAWSConfig(); 