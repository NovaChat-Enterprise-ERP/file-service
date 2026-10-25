import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.FILES_BUCKET ?? 'novachat-files';
const origins = (process.env.STORAGE_CORS_ORIGINS ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').split(',');
const s3 = new S3Client({ forcePathStyle: true });

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`Bucket ${bucket} exists`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Created bucket ${bucket}`);
}

await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`CORS configured for ${origins.join(', ')}`);
