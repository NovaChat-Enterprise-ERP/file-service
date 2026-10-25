import type { Request, Response } from 'express';
import { createUploadSchema, listFilesQuerySchema, shareFileSchema, updateFileSchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse, stringParam, uuidParam } from '@novachat-enterprise-erp/common';
import type { FileService } from '../services/file.service.js';

const fid = (req: Request) => uuidParam(req, 'fileId', 'File');

export class FileController {
  constructor(private readonly files: FileService) {}

  createUpload = async (req: Request, res: Response) => {
    res.status(201).json(await this.files.createUpload(memberContext(req), parse(createUploadSchema, req.body)));
  };

  complete = async (req: Request, res: Response) => {
    res.json(await this.files.complete(memberContext(req), fid(req)));
  };

  list = async (req: Request, res: Response) => {
    res.json(await this.files.list(memberContext(req), parse(listFilesQuerySchema, req.query)));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.files.get(memberContext(req), fid(req)));
  };

  download = async (req: Request, res: Response) => {
    const result = await this.files.downloadUrl(memberContext(req), fid(req), req.query.inline === 'true');
    if (req.query.redirect === 'true') return res.redirect(302, result.url);
    res.json(result);
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.files.update(memberContext(req), fid(req), parse(updateFileSchema, req.body)));
  };

  share = async (req: Request, res: Response) => {
    const { userIds } = parse(shareFileSchema, req.body);
    res.json(await this.files.share(memberContext(req), fid(req), userIds));
  };

  unshare = async (req: Request, res: Response) => {
    res.json(await this.files.unshare(memberContext(req), fid(req), stringParam(req, 'userId')));
  };

  trash = async (req: Request, res: Response) => {
    await this.files.trash(memberContext(req), fid(req));
    res.status(204).end();
  };

  restore = async (req: Request, res: Response) => {
    res.json(await this.files.restore(memberContext(req), fid(req)));
  };

  purge = async (req: Request, res: Response) => {
    await this.files.purge(memberContext(req), fid(req));
    res.status(204).end();
  };
}
