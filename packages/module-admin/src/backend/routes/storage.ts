import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyRequest } from 'fastify';

interface MultipartRequest extends FastifyRequest {
  file(): Promise<{ filename: string; mimetype: string; toBuffer(): Promise<Buffer> } | undefined>;
}

export function createStorageRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const storage = context.services.resolve<BackendStorageService>('storage');

  fastify.get('/storage/objects', async () => {
    return storage.listObjects();
  });

  fastify.post('/storage/objects', async (request, reply) => {
    const file = await (request as MultipartRequest).file();
    if (!file) return reply.code(400).send({ error: 'No file provided' });
    const buffer = await file.toBuffer();
    await storage.putObject(file.filename, buffer, { contentType: file.mimetype });
    return storage.headObject(file.filename);
  });

  fastify.delete('/storage/objects/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    await storage.deleteObject(key);
    return reply.code(204).send();
  });

  fastify.get('/storage/objects/:key/download', async (request, reply) => {
    const { key } = request.params as { key: string };
    const info = await storage.headObject(key);
    if (!info) return reply.code(404).send({ error: 'Not found' });

    // Стримом, а не getObject(): иначе каждое скачивание держит файл целиком в памяти процесса.
    // Range пробрасывается как есть — с ним браузер умеет перематывать медиа и докачивать обрыв.
    const object = await storage.getObjectStream(key, { range: request.headers.range });
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(key)}"`);
    reply.header('Accept-Ranges', 'bytes');
    if (object.contentLength !== undefined) reply.header('Content-Length', object.contentLength);
    if (object.contentRange) {
      reply.header('Content-Range', object.contentRange);
      reply.code(206);
    }
    return reply.type(object.contentType ?? info.contentType ?? 'application/octet-stream').send(object.body);
  });
}
