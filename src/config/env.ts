import { z } from 'zod';
import { baseEnvSchema, loadEnv, serviceUrl } from '@novachat-enterprise-erp/common';

const schema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(4005),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MESSAGE_SERVICE_URL: serviceUrl('http://localhost:4003'),
  PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  AWS_ENDPOINT_URL_S3: z.url(),
  AWS_REGION: z.string().default('us-east-2'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  FILES_BUCKET: z.string().default('novachat-files'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(100 * 1024 * 1024),
  DELETED_RETENTION_DAYS: z.coerce.number().default(30),
});

export type Env = z.infer<typeof schema>;

export const loadFileEnv = (): Env => loadEnv(schema);
