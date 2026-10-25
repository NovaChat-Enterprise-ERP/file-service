import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@novachat-enterprise-erp/contracts';
import { createLogger } from '@novachat-enterprise-erp/common';
import { InMemoryEventBus } from '@novachat-enterprise-erp/events';
import { TEST_SECRET, asUser, createTestDatabase } from '@novachat-enterprise-erp/testing';
import { schema } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { DrizzleFileRepository } from '../repositories/file.repository.js';
import { DrizzleFolderRepository } from '../repositories/folder.repository.js';
import { MemoryObjectStorage } from '../providers/object-storage.js';
import type { ConversationAccess } from '../providers/conversation-access.js';
import { buildContainer } from '../container.js';
import { createApp } from '../app.js';

export const WS = '00000000-0000-4000-8000-0000000000f1';
export const CONV = '00000000-0000-4000-8000-0000000000c1';

class FakeConversations implements ConversationAccess {
  members = new Map<string, string[]>([[CONV, ['ada', 'grace']]]);
  async isMember(_w: string, conversationId: string, userId: string) {
    return this.members.get(conversationId)?.includes(userId) ?? false;
  }
  async conversationIds(_w: string, userId: string) {
    return [...this.members].filter(([, users]) => users.includes(userId)).map(([id]) => id);
  }
}

export const createHarness = async () => {
  const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const { db, close } = await createTestDatabase(schema, migrations, 'files');
  const storage = new MemoryObjectStorage();
  const events = new InMemoryEventBus('file-service');
  const container = buildContainer({
    logger: createLogger('test', 'silent'),
    internalSecret: TEST_SECRET,
    publicAppUrl: 'http://app.test',
    files: new DrizzleFileRepository(db as unknown as Database),
    folders: new DrizzleFolderRepository(db as unknown as Database),
    storage,
    conversations: new FakeConversations(),
    events,
    config: { maxUploadBytes: 10_000, retentionDays: 30 },
  });
  const as = (userId: string) =>
    asUser({
      userId,
      workspaceId: WS,
      memberId: `m-${userId}`,
      role: userId === 'owner' ? 'owner' : 'member',
      permissions: userId === 'owner' ? ALL_PERMISSIONS : DEFAULT_ROLE_PERMISSIONS.member,
    });
  return { app: createApp(container), container, storage, events, close, as };
};
