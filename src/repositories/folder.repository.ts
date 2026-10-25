import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { files, folders, type FolderRow } from '../db/schema.js';

export type NewFolder = Pick<FolderRow, 'workspaceId' | 'ownerId' | 'name' | 'parentId'>;
export type FolderWithCount = FolderRow & { fileCount: number };

export interface FolderRepository {
  create(input: NewFolder): Promise<FolderRow>;
  findById(id: string): Promise<FolderRow | null>;
  list(workspaceId: string, ownerId: string, parentId: string | null): Promise<FolderWithCount[]>;
  update(id: string, patch: Partial<Pick<FolderRow, 'name' | 'parentId'>>): Promise<FolderRow | null>;
  deleteAndReparent(folder: FolderRow): Promise<void>;
}

export class DrizzleFolderRepository implements FolderRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFolder): Promise<FolderRow> {
    const [row] = await this.db.insert(folders).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<FolderRow | null> {
    const [row] = await this.db.select().from(folders).where(eq(folders.id, id)).limit(1);
    return row ?? null;
  }

  async list(workspaceId: string, ownerId: string, parentId: string | null): Promise<FolderWithCount[]> {
    const rows = await this.db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.workspaceId, workspaceId),
          eq(folders.ownerId, ownerId),
          parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
        ),
      )
      .orderBy(asc(folders.name));
    if (rows.length === 0) return [];
    const counts = await this.db
      .select({ folderId: files.folderId, total: count() })
      .from(files)
      .where(and(inArray(files.folderId, rows.map((r) => r.id)), isNull(files.deletedAt), eq(files.status, 'ready')))
      .groupBy(files.folderId);
    const byFolder = new Map(counts.map((c) => [c.folderId, Number(c.total)]));
    return rows.map((r) => ({ ...r, fileCount: byFolder.get(r.id) ?? 0 }));
  }

  async update(id: string, patch: Partial<Pick<FolderRow, 'name' | 'parentId'>>): Promise<FolderRow | null> {
    const [row] = await this.db.update(folders).set({ ...patch, updatedAt: new Date() }).where(eq(folders.id, id)).returning();
    return row ?? null;
  }

  async deleteAndReparent(folder: FolderRow): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(folders).set({ parentId: folder.parentId }).where(eq(folders.parentId, folder.id));
      await tx.update(files).set({ folderId: folder.parentId }).where(eq(files.folderId, folder.id));
      await tx.delete(folders).where(eq(folders.id, folder.id));
    });
  }
}
