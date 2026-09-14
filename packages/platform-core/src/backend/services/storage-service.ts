import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  BackendStorageService,
  StorageGetStreamOptions,
  StorageObjectInfo,
  StorageObjectStream,
  StoragePutOptions,
  StoragePutStreamOptions,
} from '../../contracts/backend/storage.js';
import { logger } from '../logger.js';

export class StorageServiceImpl implements BackendStorageService {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject(key: string, body: Buffer | Uint8Array | string, options?: StoragePutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options?.contentType,
        Metadata: options?.metadata,
      }),
    );
  }

  async putObjectStream(key: string, body: Readable, options?: StoragePutStreamOptions): Promise<void> {
    const common = { Bucket: this.bucket, Key: key, ContentType: options?.contentType, Metadata: options?.metadata };

    if (options?.contentLength !== undefined) {
      // Длина известна — один PUT. Без ContentLength SDK вычитал бы поток целиком, чтобы её
      // посчитать, и вся экономия памяти пропала бы.
      await this.client.send(new PutObjectCommand({ ...common, Body: body, ContentLength: options.contentLength }));
      return;
    }

    // Длину заранее не знаем (тело приходит из multipart-запроса) — грузим частями. Upload сам
    // режет поток на куски и держит в памяти только их.
    await new Upload({ client: this.client, params: { ...common, Body: body } }).done();
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  async getObjectStream(key: string, options?: StorageGetStreamOptions): Promise<StorageObjectStream> {
    let result: GetObjectCommandOutput;
    try {
      result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: options?.range }));
    } catch (error) {
      if (isRangeNotSatisfiable(error)) throw rangeNotSatisfiable(key);
      throw error;
    }
    return {
      // В Node SDK отдаёт Readable; тип объявлен как union из-за browser-сборки того же клиента.
      body: result.Body as Readable,
      contentLength: result.ContentLength,
      contentType: result.ContentType,
      contentRange: result.ContentRange,
      etag: result.ETag,
      lastModified: result.LastModified,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    // Пустой префикс снёс бы бакет целиком — такой вызов почти наверняка следствие ошибки в
    // сборке ключа, а не намерение.
    if (!prefix) throw new Error('deletePrefix требует непустой префикс');

    const keys = (await this.listObjects(prefix)).map(object => object.key).filter(Boolean);
    // DeleteObjects принимает не больше 1000 ключей за раз. Пакет курса легко больше — без
    // разбиения на пачки запрос просто отвергается.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }),
      );
    }
    return keys.length;
  }

  async headObject(key: string): Promise<StorageObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType,
        etag: result.ETag,
        lastModified: result.LastModified,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listObjects(prefix?: string): Promise<StorageObjectInfo[]> {
    const objects: StorageObjectInfo[] = [];
    // ListObjectsV2 отдаёт максимум 1000 ключей за вызов и не сообщает об этом ничем, кроме
    // IsTruncated — без дочитывания по токену большой префикс молча виден лишь частично.
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const obj of result.Contents ?? []) {
        objects.push({ key: obj.Key ?? '', size: obj.Size ?? 0, etag: obj.ETag, lastModified: obj.LastModified });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getS3SignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'NotFound' || name === 'NoSuchKey';
}

function isRangeNotSatisfiable(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'InvalidRange' || err?.$metadata?.httpStatusCode === 416;
}

/** `statusCode` на ошибке — канон Fastify: обработчики модулей уже отдают его клиенту как есть. */
function rangeNotSatisfiable(key: string): Error & { statusCode: number } {
  return Object.assign(new Error(`Запрошенный диапазон байт вне размера объекта "${key}"`), { statusCode: 416 });
}

export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    logger.info(`Storage bucket created: ${bucket}`);
    return;
  }
  logger.info(`Storage bucket ready: ${bucket}`);
}
