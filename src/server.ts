import { InternalHttpClient, createLogger, startServer } from '@novachat-enterprise-erp/common';
import { RedisStreamEventPublisher } from '@novachat-enterprise-erp/events';
import { loadFileEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { DrizzleFileRepository } from './repositories/file.repository.js';
import { DrizzleFolderRepository } from './repositories/folder.repository.js';
import { S3ObjectStorage } from './providers/object-storage.js';
import { MessageServiceConversationAccess } from './providers/conversation-access.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';

const env = loadFileEnv();
const logger = createLogger('file-service', env.LOG_LEVEL);
const { db, pool } = createDatabase(env.DATABASE_URL, (err) =>
  logger.warn({ err }, 'Idle database connection failed; the pool will reconnect'),
);
const events = new RedisStreamEventPublisher({ redisUrl: env.REDIS_URL, source: 'file-service' });

const container = buildContainer({
  logger,
  internalSecret: env.INTERNAL_SECRET,
  publicAppUrl: env.PUBLIC_APP_URL,
  files: new DrizzleFileRepository(db),
  folders: new DrizzleFolderRepository(db),
  storage: new S3ObjectStorage(
    {
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
    },
    env.FILES_BUCKET,
  ),
  conversations: new MessageServiceConversationAccess(
    new InternalHttpClient(env.MESSAGE_SERVICE_URL, env.INTERNAL_SECRET, 'file-service'),
  ),
  events,
  config: { maxUploadBytes: env.MAX_UPLOAD_BYTES, retentionDays: env.DELETED_RETENTION_DAYS },
  readiness: { database: async () => void (await pool.query('select 1')) },
});

const maintenance = setInterval(() => {
  container.services.files
    .runMaintenance()
    .then((count) => count && logger.info({ count }, 'Purged files'))
    .catch((err) => logger.error({ err }, 'File maintenance failed'));
}, 60 * 60 * 1000);

startServer({
  app: createApp(container),
  port: env.PORT,
  logger,
  onShutdown: [() => clearInterval(maintenance), () => events.close(), () => pool.end()],
});
