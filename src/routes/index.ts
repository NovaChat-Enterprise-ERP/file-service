import { Router } from 'express';
import { requireMember, requireUser } from '@novachat-enterprise-erp/common';
import type { Container } from '../container.js';

export const publicRoutes = ({ controllers: { files: f, folders: d, avatars: a } }: Container): Router => {
  const router = Router();
  router.post('/avatars/upload-url', requireUser, a.createUpload);
  router.get('/avatars/:owner/:file', a.show);

  const ws = Router({ mergeParams: true });
  ws.use(requireMember);
  ws.get('/files', f.list);
  ws.post('/files/uploads', f.createUpload);
  ws.post('/files/:fileId/complete', f.complete);
  ws.get('/files/:fileId', f.get);
  ws.get('/files/:fileId/download', f.download);
  ws.patch('/files/:fileId', f.update);
  ws.post('/files/:fileId/shares', f.share);
  ws.delete('/files/:fileId/shares/:userId', f.unshare);
  ws.delete('/files/:fileId', f.trash);
  ws.post('/files/:fileId/restore', f.restore);
  ws.delete('/files/:fileId/permanent', f.purge);

  ws.get('/folders', d.list);
  ws.post('/folders', d.create);
  ws.patch('/folders/:folderId', d.update);
  ws.delete('/folders/:folderId', d.delete);

  router.use('/workspaces/:workspaceId', ws);
  return router;
};
