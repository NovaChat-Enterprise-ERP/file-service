import type { Request, Response } from 'express';
import { createFolderSchema, updateFolderSchema } from '@novachat-enterprise-erp/contracts';
import { isUuid, memberContext, parse, uuidParam } from '@novachat-enterprise-erp/common';
import type { FolderService } from '../services/folder.service.js';

export class FolderController {
  constructor(private readonly folders: FolderService) {}

  list = async (req: Request, res: Response) => {
    const parentId = isUuid(req.query.parentId) ? req.query.parentId : null;
    res.json({ items: await this.folders.list(memberContext(req), parentId) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.folders.create(memberContext(req), parse(createFolderSchema, req.body)));
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.folders.update(memberContext(req), uuidParam(req, 'folderId', 'Folder'), parse(updateFolderSchema, req.body)));
  };

  delete = async (req: Request, res: Response) => {
    await this.folders.delete(memberContext(req), uuidParam(req, 'folderId', 'Folder'));
    res.status(204).end();
  };
}
