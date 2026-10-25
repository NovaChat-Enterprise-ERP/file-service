import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  PERMISSIONS,
  fileKindOf,
  type CreateUploadInput,
  type DownloadUrlDto,
  type FileDto,
  type ListFilesQuery,
  type Page,
  type UpdateFileInput,
  type UploadTicketDto,
} from '@novachat-enterprise-erp/contracts';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  decodeCursor,
  encodeCursor,
  type Logger,
  type MemberContext,
} from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { FileRow } from '../db/schema.js';
import { cursorValue, type FileCursor, type FileRepository } from '../repositories/file.repository.js';
import type { FolderRepository } from '../repositories/folder.repository.js';
import type { ObjectStorage } from '../providers/object-storage.js';
import type { ConversationAccess } from '../providers/conversation-access.js';
import { toFileDto } from './mappers.js';

export interface FileServiceConfig {
  maxUploadBytes: number;
  retentionDays: number;
}

const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const DAY_MS = 86_400_000;

const MODIFIED_WINDOWS: Record<NonNullable<ListFilesQuery['modified']>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  year: 365,
};

export const storageKey = (workspaceId: string, name: string) =>
  `${workspaceId}/${randomUUID()}/${name.replace(/[^\w.\- ]+/g, '_').slice(-120)}`;

export class FileService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly storage: ObjectStorage,
    private readonly conversations: ConversationAccess,
    private readonly events: EventPublisher,
    private readonly config: FileServiceConfig,
    private readonly logger: Logger,
  ) {}

  async createUpload(actor: MemberContext, input: CreateUploadInput): Promise<UploadTicketDto> {
    if (input.size > this.config.maxUploadBytes) {
      throw new BadRequestError(`Files must be smaller than ${Math.round(this.config.maxUploadBytes / 1024 / 1024)} MB`);
    }
    if (input.folderId) await this.ownFolder(actor, input.folderId);
    if (input.conversationId && !(await this.conversations.isMember(actor.workspaceId, input.conversationId, actor.userId))) {
      throw new ForbiddenError('You are not a member of that conversation');
    }

    const file = await this.files.create({
      workspaceId: actor.workspaceId,
      uploaderId: actor.userId,
      name: input.name,
      mimeType: input.mimeType,
      kind: fileKindOf(input.mimeType, input.name),
      size: input.size,
      storageKey: storageKey(actor.workspaceId, input.name),
      folderId: input.folderId ?? null,
      conversationId: input.conversationId ?? null,
    });
    const { url, headers } = await this.storage.presignPut(file.storageKey, file.mimeType, file.size, UPLOAD_TTL_SECONDS);
    return {
      file: toFileDto(file),
      uploadUrl: url,
      method: 'PUT',
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async complete(actor: MemberContext, fileId: string): Promise<FileDto> {
    const file = await this.load(actor, fileId);
    if (file.uploaderId !== actor.userId) throw new ForbiddenError('Only the uploader can complete an upload');
    if (file.status === 'ready') return this.dto(file);

    const stored = await this.storage.head(file.storageKey);
    if (!stored) throw new BadRequestError('The file has not been uploaded yet');
    if (stored.size !== file.size) {
      await this.storage.delete(file.storageKey);
      await this.files.hardDelete([file.id]);
      throw new BadRequestError('Uploaded file size does not match');
    }
    const ready = await this.files.update(file.id, { status: 'ready' });
    const dto = await this.dto(ready!);
    await this.events.publish({ type: EVENTS.FILE_UPLOADED, workspaceId: actor.workspaceId, actorId: actor.userId, data: { file: dto } });
    return dto;
  }

  async list(actor: MemberContext, query: ListFilesQuery): Promise<Page<FileDto>> {
    const conversationIds = query.view === 'all' ? await this.conversations.conversationIds(actor.workspaceId, actor.userId) : [];
    if (query.conversationId && !conversationIds.includes(query.conversationId) && query.view === 'all') {
      return { items: [], nextCursor: null };
    }
    const rows = await this.files.list({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      view: query.view,
      conversationIds,
      includeAllDeleted: actor.permissions.includes(PERMISSIONS.FILES_DELETE_ANY),
      q: query.q,
      kind: query.kind,
      uploaderId: query.uploaderId,
      modifiedAfter: query.modified ? new Date(Date.now() - MODIFIED_WINDOWS[query.modified] * DAY_MS) : undefined,
      folderId: query.folderId,
      conversationId: query.conversationId,
      sort: query.sort,
      after: decodeCursor<FileCursor>(query.cursor),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const shares = await this.files.sharesFor(page.map((f) => f.id));
    const last = page.at(-1);
    return {
      items: page.map((f) => toFileDto(f, shares.get(f.id) ?? [])),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ v: cursorValue(last, query.sort), id: last.id }) : null,
    };
  }

  async get(actor: MemberContext, fileId: string): Promise<FileDto> {
    const file = await this.loadVisible(actor, fileId);
    return this.dto(file);
  }

  async downloadUrl(actor: MemberContext, fileId: string, inline: boolean): Promise<DownloadUrlDto> {
    const file = await this.loadVisible(actor, fileId);
    if (file.status !== 'ready') throw new BadRequestError('This file is still uploading');
    return {
      url: await this.storage.presignGet(file.storageKey, file.name, inline, DOWNLOAD_TTL_SECONDS),
      expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async update(actor: MemberContext, fileId: string, input: UpdateFileInput): Promise<FileDto> {
    const file = await this.load(actor, fileId);
    if (file.uploaderId !== actor.userId) throw new ForbiddenError('Only the uploader can edit this file');
    if (input.folderId) await this.ownFolder(actor, input.folderId);
    return this.dto((await this.files.update(file.id, input))!);
  }

  async share(actor: MemberContext, fileId: string, userIds: string[]): Promise<FileDto> {
    const file = await this.loadVisible(actor, fileId);
    if (file.deletedAt) throw new BadRequestError('Restore this file before sharing it');
    await this.files.share(file.id, userIds.filter((u) => u !== file.uploaderId), actor.userId);
    return this.dto(file);
  }

  async unshare(actor: MemberContext, fileId: string, userId: string): Promise<FileDto> {
    const file = await this.load(actor, fileId);
    if (file.uploaderId !== actor.userId && userId !== actor.userId) throw new ForbiddenError('Only the uploader can unshare');
    await this.files.unshare(file.id, userId);
    return this.dto(file);
  }

  async trash(actor: MemberContext, fileId: string): Promise<void> {
    const file = await this.load(actor, fileId);
    this.assertCanDelete(actor, file);
    if (file.deletedAt) return;
    await this.files.update(file.id, { deletedAt: new Date(), deletedBy: actor.userId });
    await this.events.publish({
      type: EVENTS.FILE_DELETED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { fileId: file.id, conversationId: file.conversationId },
    });
  }

  async restore(actor: MemberContext, fileId: string): Promise<FileDto> {
    const file = await this.load(actor, fileId);
    this.assertCanDelete(actor, file);
    if (!file.deletedAt) return this.dto(file);
    return this.dto((await this.files.update(file.id, { deletedAt: null, deletedBy: null }))!);
  }

  async purge(actor: MemberContext, fileId: string): Promise<void> {
    const file = await this.load(actor, fileId);
    this.assertCanDelete(actor, file);
    if (!file.deletedAt) throw new BadRequestError('Move the file to Deleted files first');
    await this.storage.delete(file.storageKey);
    await this.files.hardDelete([file.id]);
  }

  async runMaintenance(now = new Date()): Promise<number> {
    const rows = await this.files.listPurgeable(new Date(now.getTime() - this.config.retentionDays * DAY_MS), new Date(now.getTime() - DAY_MS), 200);
    for (const row of rows) {
      await this.storage.delete(row.storageKey).catch((err) => this.logger.warn({ err, key: row.storageKey }, 'Object delete failed'));
    }
    await this.files.hardDelete(rows.map((r) => r.id));
    return rows.length;
  }

  private assertCanDelete(actor: MemberContext, file: FileRow): void {
    if (file.uploaderId !== actor.userId && !actor.permissions.includes(PERMISSIONS.FILES_DELETE_ANY)) {
      throw new ForbiddenError('You can only delete your own files');
    }
  }

  private async load(actor: MemberContext, fileId: string): Promise<FileRow> {
    const file = await this.files.findById(fileId);
    if (!file || file.workspaceId !== actor.workspaceId) throw new NotFoundError('File');
    return file;
  }

  private async loadVisible(actor: MemberContext, fileId: string): Promise<FileRow> {
    const file = await this.load(actor, fileId);
    if (file.uploaderId === actor.userId) return file;
    if (file.deletedAt && !actor.permissions.includes(PERMISSIONS.FILES_DELETE_ANY)) throw new NotFoundError('File');
    const shares = await this.files.sharesFor([file.id]);
    if (shares.get(file.id)?.includes(actor.userId)) return file;
    if (file.conversationId && (await this.conversations.isMember(actor.workspaceId, file.conversationId, actor.userId))) return file;
    throw new NotFoundError('File');
  }

  private async ownFolder(actor: MemberContext, folderId: string) {
    const folder = await this.folders.findById(folderId);
    if (!folder || folder.workspaceId !== actor.workspaceId || folder.ownerId !== actor.userId) throw new NotFoundError('Folder');
    return folder;
  }

  private async dto(file: FileRow): Promise<FileDto> {
    const shares = await this.files.sharesFor([file.id]);
    return toFileDto(file, shares.get(file.id) ?? []);
  }
}
