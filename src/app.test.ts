import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EVENTS, type FileDto, type UploadTicketDto } from '@novachat-enterprise-erp/contracts';
import { CONV, WS, createHarness } from './test/harness.js';

let h: Awaited<ReturnType<typeof createHarness>>;
const base = `/api/v1/workspaces/${WS}`;

const upload = async (userId: string, name: string, extra: Record<string, unknown> = {}) => {
  const ticket = await request(h.app)
    .post(`${base}/files/uploads`)
    .set(h.as(userId))
    .send({ name, mimeType: 'application/pdf', size: 1234, ...extra });
  expect(ticket.status).toBe(201);
  const body = ticket.body as UploadTicketDto;
  const key = body.uploadUrl.replace('memory://put/', '');
  h.storage.objects.set(key, { size: (extra.size as number) ?? 1234, contentType: 'application/pdf' });
  const done = await request(h.app).post(`${base}/files/${body.file.id}/complete`).set(h.as(userId));
  expect(done.status).toBe(200);
  return done.body as FileDto;
};

const list = async (userId: string, query = '') =>
  (await request(h.app).get(`${base}/files?${query}`).set(h.as(userId))).body.items as FileDto[];

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('uploads', () => {
  it('issues presigned uploads and completes them', async () => {
    const file = await upload('ada', 'Syllabus.pdf');
    expect(file).toMatchObject({ status: 'ready', kind: 'pdf', uploaderId: 'ada' });
    expect(h.events.ofType(EVENTS.FILE_UPLOADED)).toHaveLength(1);
  });

  it('rejects oversized files and completion without an object', async () => {
    const big = await request(h.app).post(`${base}/files/uploads`).set(h.as('ada')).send({ name: 'big.zip', size: 50_000 });
    expect(big.status).toBe(400);
    const ticket = await request(h.app).post(`${base}/files/uploads`).set(h.as('ada')).send({ name: 'x.txt', size: 10 });
    const early = await request(h.app).post(`${base}/files/${ticket.body.file.id}/complete`).set(h.as('ada'));
    expect(early.status).toBe(400);
  });

  it('only allows conversation uploads for members', async () => {
    const res = await request(h.app).post(`${base}/files/uploads`).set(h.as('linus')).send({ name: 'a.pdf', size: 5, conversationId: CONV });
    expect(res.status).toBe(403);
  });
});

describe('visibility', () => {
  let attached: FileDto;
  let privateFile: FileDto;

  beforeAll(async () => {
    attached = await upload('ada', 'Lecture.pdf', { conversationId: CONV });
    privateFile = await upload('ada', 'Diary.pdf');
  });

  it('shows conversation files to members only', async () => {
    expect((await list('grace')).map((f) => f.name)).toEqual(['Lecture.pdf']);
    expect(await list('linus')).toEqual([]);
    expect((await request(h.app).get(`${base}/files/${attached.id}/download`).set(h.as('grace'))).status).toBe(200);
    expect((await request(h.app).get(`${base}/files/${attached.id}/download`).set(h.as('linus'))).status).toBe(404);
  });

  it('shares files explicitly', async () => {
    await request(h.app).post(`${base}/files/${privateFile.id}/shares`).set(h.as('ada')).send({ userIds: ['linus'] }).expect(200);
    expect((await list('linus', 'view=shared')).map((f) => f.name)).toEqual(['Diary.pdf']);
    const dl = await request(h.app).get(`${base}/files/${privateFile.id}/download?inline=true`).set(h.as('linus'));
    expect(dl.body.url).toContain('inline=true');
  });

  it('filters, searches and sorts', async () => {
    expect((await list('ada', 'view=mine&sort=name')).map((f) => f.name)).toEqual(['Diary.pdf', 'Lecture.pdf', 'Syllabus.pdf']);
    expect((await list('ada', 'q=lect')).map((f) => f.name)).toEqual(['Lecture.pdf']);
    expect(await list('ada', 'kind=image')).toEqual([]);
    const page = await request(h.app).get(`${base}/files?view=mine&sort=name&limit=2`).set(h.as('ada'));
    const next = await request(h.app).get(`${base}/files?view=mine&sort=name&limit=2&cursor=${page.body.nextCursor}`).set(h.as('ada'));
    expect(next.body.items.map((f: FileDto) => f.name)).toEqual(['Syllabus.pdf']);
  });
});

describe('deletion', () => {
  it('soft deletes, restores and purges', async () => {
    const file = await upload('grace', 'notes.pdf');
    expect((await request(h.app).delete(`${base}/files/${file.id}`).set(h.as('ada'))).status).toBe(403);
    await request(h.app).delete(`${base}/files/${file.id}`).set(h.as('grace')).expect(204);
    expect((await list('grace', 'view=deleted')).map((f) => f.name)).toEqual(['notes.pdf']);
    await request(h.app).post(`${base}/files/${file.id}/restore`).set(h.as('grace')).expect(200);
    await request(h.app).delete(`${base}/files/${file.id}`).set(h.as('owner')).expect(204);
    await request(h.app).delete(`${base}/files/${file.id}/permanent`).set(h.as('grace')).expect(204);
    expect((await request(h.app).get(`${base}/files/${file.id}`).set(h.as('grace'))).status).toBe(404);
  });

  it('purges expired trash and stale pending uploads', async () => {
    const file = await upload('grace', 'old.pdf');
    await request(h.app).delete(`${base}/files/${file.id}`).set(h.as('grace')).expect(204);
    const purged = await h.container.services.files.runMaintenance(new Date(Date.now() + 31 * 86_400_000));
    expect(purged).toBeGreaterThanOrEqual(2);
  });
});

describe('folders', () => {
  it('creates folders, moves files and prevents cycles', async () => {
    const parent = (await request(h.app).post(`${base}/folders`).set(h.as('ada')).send({ name: 'Course' })).body;
    const child = (await request(h.app).post(`${base}/folders`).set(h.as('ada')).send({ name: 'Week 1', parentId: parent.id })).body;
    const file = await upload('ada', 'w1.pdf', { folderId: child.id });
    expect((await list('ada', `view=mine&folderId=${child.id}`)).map((f) => f.id)).toEqual([file.id]);
    const cycle = await request(h.app).patch(`${base}/folders/${parent.id}`).set(h.as('ada')).send({ parentId: child.id });
    expect(cycle.status).toBe(400);
    expect((await request(h.app).get(`${base}/folders?parentId=${parent.id}`).set(h.as('grace'))).status).toBe(404);
    await request(h.app).delete(`${base}/folders/${child.id}`).set(h.as('ada')).expect(204);
    expect((await request(h.app).get(`${base}/files/${file.id}`).set(h.as('ada'))).body.folderId).toBe(parent.id);
  });
});

describe('avatars', () => {
  it('issues uploads and resolves public avatar URLs', async () => {
    const res = await request(h.app).post('/api/v1/avatars/upload-url').set(h.as('ada')).send({ mimeType: 'image/png', size: 1000 });
    expect(res.body.publicUrl).toMatch(/^http:\/\/app\.test\/api\/v1\/avatars\/ada\/[0-9a-f-]{36}\.png$/);
    const path = new URL(res.body.publicUrl).pathname;
    const show = await request(h.app).get(path).set(h.as('anyone'));
    expect(show.status).toBe(302);
    expect((await request(h.app).get('/api/v1/avatars/ada/..%2Fsecret.png').set(h.as('x'))).status).toBe(404);
  });
});
