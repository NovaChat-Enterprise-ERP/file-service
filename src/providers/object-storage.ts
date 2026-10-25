import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObject {
  size: number;
  contentType: string | null;
}

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  presignPut(key: string, contentType: string, size: number, expiresInSeconds: number): Promise<PresignedPut>;
  presignGet(key: string, fileName: string, inline: boolean, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const contentDisposition = (fileName: string, inline: boolean) =>
  `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    config: S3ClientConfig,
    private readonly bucket: string,
  ) {
    this.client = new S3Client({ ...config, forcePathStyle: true });
  }

  async presignPut(key: string, contentType: string, size: number, expiresInSeconds: number): Promise<PresignedPut> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size });
    const url = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type']) });
    return { url, headers: { 'Content-Type': contentType } };
  }

  presignGet(key: string, fileName: string, inline: boolean, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(fileName, inline),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(out.ContentLength ?? 0), contentType: out.ContentType ?? null };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as Error).name === 'NotFound') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  async presignPut(key: string, contentType: string) {
    return { url: `memory://put/${key}`, headers: { 'Content-Type': contentType } };
  }

  async presignGet(key: string, fileName: string, inline: boolean) {
    return `memory://get/${key}?name=${encodeURIComponent(fileName)}&inline=${inline}`;
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
