import { and, asc, desc, eq, exists, gt, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ListFilesQuery } from '@novachat-enterprise-erp/contracts';
import type { Database } from '../db/client.js';
import { fileShares, files, type FileRow } from '../db/schema.js';

export type NewFile = Pick<
  FileRow,
  'workspaceId' | 'uploaderId' | 'name' | 'mimeType' | 'kind' | 'size' | 'storageKey' | 'folderId' | 'conversationId'
>;
export type FilePatch = Partial<Pick<FileRow, 'name' | 'folderId' | 'status' | 'deletedAt' | 'deletedBy' | 'size'>>;

export type FileSort = ListFilesQuery['sort'];
export interface FileCursor {
  v: string | number;
  id: string;
}

export interface FileListFilter {
  workspaceId: string;
  userId: string;
  view: ListFilesQuery['view'];
  conversationIds: string[];
  includeAllDeleted: boolean;
  q?: string;
  kind?: string;
  uploaderId?: string;
  modifiedAfter?: Date;
  folderId?: string;
  conversationId?: string;
  sort: FileSort;
  after: FileCursor | null;
  limit: number;
}

export interface FileRepository {
  create(input: NewFile): Promise<FileRow>;
  findById(id: string): Promise<FileRow | null>;
  update(id: string, patch: FilePatch): Promise<FileRow | null>;
  list(filter: FileListFilter): Promise<FileRow[]>;
  hardDelete(ids: string[]): Promise<void>;
  listPurgeable(deletedBefore: Date, pendingBefore: Date, limit: number): Promise<FileRow[]>;
  share(fileId: string, userIds: string[], sharedBy: string): Promise<void>;
  unshare(fileId: string, userId: string): Promise<void>;
  sharesFor(fileIds: string[]): Promise<Map<string, string[]>>;
}

const SORT_COLUMNS = {
  newest: { column: files.createdAt, dir: 'desc' },
  oldest: { column: files.createdAt, dir: 'asc' },
  name: { column: files.name, dir: 'asc' },
  size: { column: files.size, dir: 'desc' },
} as const;

export const cursorValue = (row: FileRow, sort: FileSort): string | number => {
  if (sort === 'name') return row.name;
  if (sort === 'size') return row.size;
  return row.createdAt.toISOString();
};

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFile): Promise<FileRow> {
    const [row] = await this.db.insert(files).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<FileRow | null> {
    const [row] = await this.db.select().from(files).where(eq(files.id, id)).limit(1);
    return row ?? null;
  }

  async update(id: string, patch: FilePatch): Promise<FileRow | null> {
    const [row] = await this.db.update(files).set({ ...patch, updatedAt: new Date() }).where(eq(files.id, id)).returning();
    return row ?? null;
  }

  async list(filter: FileListFilter): Promise<FileRow[]> {
    const sharedWithMe = exists(
      this.db
        .select({ one: sql`1` })
        .from(fileShares)
        .where(and(eq(fileShares.fileId, files.id), eq(fileShares.userId, filter.userId))),
    );
    const mine = eq(files.uploaderId, filter.userId);
    const inMyConversations = filter.conversationIds.length ? inArray(files.conversationId, filter.conversationIds) : undefined;

    const conditions: (SQL | undefined)[] = [eq(files.workspaceId, filter.workspaceId)];
    switch (filter.view) {
      case 'all':
        conditions.push(isNull(files.deletedAt), eq(files.status, 'ready'), or(mine, sharedWithMe, inMyConversations));
        break;
      case 'mine':
        conditions.push(isNull(files.deletedAt), eq(files.status, 'ready'), mine);
        break;
      case 'shared':
        conditions.push(isNull(files.deletedAt), eq(files.status, 'ready'), sharedWithMe);
        break;
      case 'deleted':
        conditions.push(
          isNotNull(files.deletedAt),
          filter.includeAllDeleted ? undefined : or(mine, eq(files.deletedBy, filter.userId)),
        );
        break;
    }
    if (filter.q) conditions.push(ilike(files.name, `%${filter.q.replace(/[%_\\]/g, '\\$&')}%`));
    if (filter.kind) conditions.push(eq(files.kind, filter.kind as FileRow['kind']));
    if (filter.uploaderId) conditions.push(eq(files.uploaderId, filter.uploaderId));
    if (filter.modifiedAfter) conditions.push(gt(files.updatedAt, filter.modifiedAfter));
    if (filter.folderId) conditions.push(eq(files.folderId, filter.folderId));
    if (filter.conversationId) conditions.push(eq(files.conversationId, filter.conversationId));

    const { column, dir } = SORT_COLUMNS[filter.sort];
    if (filter.after) {
      const value = filter.sort === 'newest' || filter.sort === 'oldest' ? new Date(String(filter.after.v)) : filter.after.v;
      const cmp = dir === 'desc' ? lt : gt;
      conditions.push(or(cmp(column, value as never), and(eq(column, value as never), cmp(files.id, filter.after.id))));
    }
    const order = dir === 'desc' ? [desc(column), desc(files.id)] : [asc(column), asc(files.id)];
    return this.db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(...order)
      .limit(filter.limit);
  }

  async hardDelete(ids: string[]): Promise<void> {
    if (ids.length) await this.db.delete(files).where(inArray(files.id, ids));
  }

  async listPurgeable(deletedBefore: Date, pendingBefore: Date, limit: number): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(
        or(
          and(isNotNull(files.deletedAt), lt(files.deletedAt, deletedBefore)),
          and(eq(files.status, 'pending'), lt(files.createdAt, pendingBefore)),
        ),
      )
      .limit(limit);
  }

  async share(fileId: string, userIds: string[], sharedBy: string): Promise<void> {
    if (userIds.length === 0) return;
    await this.db
      .insert(fileShares)
      .values([...new Set(userIds)].map((userId) => ({ fileId, userId, sharedBy })))
      .onConflictDoNothing();
  }

  async unshare(fileId: string, userId: string): Promise<void> {
    await this.db.delete(fileShares).where(and(eq(fileShares.fileId, fileId), eq(fileShares.userId, userId)));
  }

  async sharesFor(fileIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (fileIds.length === 0) return map;
    const rows = await this.db.select().from(fileShares).where(inArray(fileShares.fileId, fileIds));
    for (const r of rows) map.set(r.fileId, [...(map.get(r.fileId) ?? []), r.userId]);
    return map;
  }
}
