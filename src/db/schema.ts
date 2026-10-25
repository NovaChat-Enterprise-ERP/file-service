import { bigint, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FileKind } from '@novachat-enterprise-erp/contracts';

export const filesSchema = pgSchema('files');

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 6 });

export const folders = filesSchema.table(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    ownerId: text('owner_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('folders_workspace_owner_idx').on(t.workspaceId, t.ownerId, t.parentId)],
);

export const files = filesSchema.table(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    uploaderId: text('uploader_id').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    kind: text('kind').$type<FileKind>().notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: text('status').$type<'pending' | 'ready'>().notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
    deletedBy: text('deleted_by'),
  },
  (t) => [
    index('files_workspace_created_idx').on(t.workspaceId, t.createdAt.desc()),
    index('files_uploader_idx').on(t.workspaceId, t.uploaderId),
    index('files_conversation_idx').on(t.conversationId),
    index('files_folder_idx').on(t.folderId),
  ],
);

export const fileShares = filesSchema.table(
  'file_shares',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    sharedBy: text('shared_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.userId] }), index('file_shares_user_idx').on(t.userId)],
);

export const schema = { folders, files, fileShares };

export type FolderRow = typeof folders.$inferSelect;
export type FileRow = typeof files.$inferSelect;
