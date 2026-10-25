import { S3ObjectStorage } from '../providers/object-storage.js';

const storage = new S3ObjectStorage({ endpoint: process.env.AWS_ENDPOINT_URL_S3 }, process.env.FILES_BUCKET ?? 'novachat-files');
const key = `smoke/${Date.now()}.txt`;
const body = 'hello from novachat';

const put = await storage.presignPut(key, 'text/plain', Buffer.byteLength(body), 60);
const upload = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
console.log('PUT', upload.status);

console.log('HEAD', await storage.head(key));
const download = await fetch(await storage.presignGet(key, 'smoke.txt', false, 60));
console.log('GET', download.status, download.headers.get('content-disposition'), JSON.stringify(await download.text()));

await storage.delete(key);
console.log('after delete', await storage.head(key));
