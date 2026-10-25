import type { FileDto, FolderDto } from '@novachat-enterprise-erp/contracts';
import type { FileRow } from '../db/schema.js';
import type { FolderWithCount } from '../repositories/folder.repository.js';

export const toFileDto = (f: FileRow, sharedWith: string[] = []): FileDto => ({
  id: f.id,
  workspaceId: f.workspaceId,
  name: f.name,
  mimeType: f.mimeType,
  kind: f.kind,
  size: f.size,
  status: f.status,
  uploaderId: f.uploaderId,
  folderId: f.folderId,
  conversationId: f.conversationId,
  sharedWith,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
  deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
});

export const toFolderDto = (f: FolderWithCount): FolderDto => ({
  id: f.id,
  workspaceId: f.workspaceId,
  name: f.name,
  parentId: f.parentId,
  ownerId: f.ownerId,
  fileCount: f.fileCount,
  createdAt: f.createdAt.toISOString(),
});
