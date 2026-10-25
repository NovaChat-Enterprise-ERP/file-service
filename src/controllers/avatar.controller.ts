import type { Request, Response } from 'express';
import { avatarUploadSchema } from '@novachat-enterprise-erp/contracts';
import { parse, stringParam, userContext } from '@novachat-enterprise-erp/common';
import type { AvatarService } from '../services/avatar.service.js';

export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  createUpload = async (req: Request, res: Response) => {
    const { mimeType, size } = parse(avatarUploadSchema, req.body);
    res.status(201).json(await this.avatars.createUpload(userContext(req).userId, mimeType, size));
  };

  show = async (req: Request, res: Response) => {
    const url = await this.avatars.resolve(`${stringParam(req, 'owner')}/${stringParam(req, 'file')}`);
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.redirect(302, url);
  };
}
