import { randomUUID } from 'node:crypto';
import type { AvatarUploadDto } from '@novachat-enterprise-erp/contracts';
import { NotFoundError } from '@novachat-enterprise-erp/common';
import type { ObjectStorage } from '../providers/object-storage.js';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const KEY = /^[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export class AvatarService {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly publicAppUrl: string,
  ) {}

  async createUpload(userId: string, mimeType: string, size: number): Promise<AvatarUploadDto> {
    const name = `${userId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}/${randomUUID()}.${EXT[mimeType]}`;
    const { url, headers } = await this.storage.presignPut(`avatars/${name}`, mimeType, size, 600);
    return { uploadUrl: url, headers, publicUrl: `${this.publicAppUrl}/api/v1/avatars/${name}` };
  }

  async resolve(name: string): Promise<string> {
    if (!KEY.test(name)) throw new NotFoundError('Avatar');
    return this.storage.presignGet(`avatars/${name}`, name.split('/').pop()!, true, 3600);
  }
}
