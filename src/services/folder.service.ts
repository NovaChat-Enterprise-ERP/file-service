import type { CreateFolderInput, FolderDto } from '@novachat-enterprise-erp/contracts';
import { BadRequestError, NotFoundError, type MemberContext } from '@novachat-enterprise-erp/common';
import type { FolderRow } from '../db/schema.js';
import type { FolderRepository } from '../repositories/folder.repository.js';
import { toFolderDto } from './mappers.js';

export class FolderService {
  constructor(private readonly folders: FolderRepository) {}

  async list(actor: MemberContext, parentId: string | null): Promise<FolderDto[]> {
    if (parentId) await this.own(actor, parentId);
    return (await this.folders.list(actor.workspaceId, actor.userId, parentId)).map(toFolderDto);
  }

  async create(actor: MemberContext, input: CreateFolderInput): Promise<FolderDto> {
    if (input.parentId) await this.own(actor, input.parentId);
    const row = await this.folders.create({
      workspaceId: actor.workspaceId,
      ownerId: actor.userId,
      name: input.name,
      parentId: input.parentId ?? null,
    });
    return toFolderDto({ ...row, fileCount: 0 });
  }

  async update(actor: MemberContext, folderId: string, input: { name?: string; parentId?: string | null }): Promise<FolderDto> {
    const folder = await this.own(actor, folderId);
    if (input.parentId) await this.assertNoCycle(actor, folder.id, input.parentId);
    const row = await this.folders.update(folder.id, input);
    return toFolderDto({ ...row!, fileCount: 0 });
  }

  async delete(actor: MemberContext, folderId: string): Promise<void> {
    await this.folders.deleteAndReparent(await this.own(actor, folderId));
  }

  private async assertNoCycle(actor: MemberContext, folderId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === folderId) throw new BadRequestError('A folder cannot be moved inside itself');
      cursor = (await this.own(actor, cursor)).parentId;
    }
  }

  private async own(actor: MemberContext, folderId: string): Promise<FolderRow> {
    const folder = await this.folders.findById(folderId);
    if (!folder || folder.workspaceId !== actor.workspaceId || folder.ownerId !== actor.userId) throw new NotFoundError('Folder');
    return folder;
  }
}
