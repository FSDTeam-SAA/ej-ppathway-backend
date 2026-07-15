import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const trimSlash = (value) => String(value || '').replace(/^\/+|\/+$/g, '');
const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

const getStorageConfig = () => ({
  accessKey:
    process.env.R2_ACCESS_KEY_ID ||
    process.env.STORAGE_S3_ACCESS_KEY ||
    process.env.EGRESS_S3_ACCESS_KEY,
  secret:
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.STORAGE_S3_SECRET ||
    process.env.EGRESS_S3_SECRET,
  bucket: process.env.R2_BUCKET || process.env.R2_PUBLIC_BUCKET || process.env.R2_PRIVATE_BUCKET || process.env.STORAGE_S3_BUCKET || process.env.EGRESS_S3_BUCKET,
  publicBucket: process.env.R2_PUBLIC_BUCKET || process.env.R2_BUCKET || process.env.STORAGE_S3_BUCKET || process.env.EGRESS_S3_BUCKET,
  privateBucket: process.env.R2_PRIVATE_BUCKET || process.env.R2_BUCKET || process.env.STORAGE_S3_BUCKET || process.env.EGRESS_S3_BUCKET,
  region:
    process.env.R2_REGION ||
    process.env.STORAGE_S3_REGION ||
    process.env.EGRESS_S3_REGION ||
    'auto',
  endpoint:
    process.env.R2_ENDPOINT ||
    process.env.STORAGE_S3_ENDPOINT ||
    process.env.EGRESS_S3_ENDPOINT,
  forcePathStyle: String(
    process.env.R2_FORCE_PATH_STYLE ||
    process.env.STORAGE_S3_FORCE_PATH_STYLE ||
    process.env.EGRESS_S3_FORCE_PATH_STYLE ||
    'true'
  ) === 'true',
  publicBase: trimTrailingSlash(
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.STORAGE_PUBLIC_BASE_URL ||
    process.env.EGRESS_S3_PUBLIC_BASE_URL ||
    process.env.RECORDING_PUBLIC_BASE_URL ||
    ''
  )
});

const PRIVATE_FOLDERS = new Set([
  'advisor-contracts-signed',
  'complaint-docs',
  'contract-signatures',
  'dispute-docs',
  'documents',
  'recordings'
]);

const resolveAccess = (folder, options = {}) => {
  if (options.access === 'public' || options.access === 'private') return options.access;
  const root = trimSlash(folder).split('/')[0];
  return PRIVATE_FOLDERS.has(root) ? 'private' : 'public';
};

const configForAccess = (access) => {
  const cfg = getStorageConfig();
  return {
    ...cfg,
    bucket: access === 'private' ? cfg.privateBucket : cfg.publicBucket,
    access
  };
};

export const objectStorageConfigured = () => {
  const cfg = getStorageConfig();
  return !!(cfg.accessKey && cfg.secret && (cfg.publicBucket || cfg.privateBucket || cfg.bucket) && cfg.endpoint);
};

const assertStorageConfigured = (access = 'public') => {
  const cfg = configForAccess(access);
  if (!objectStorageConfigured()) {
    throw new Error('R2/S3 storage is not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_ENDPOINT.');
  }
  if (!cfg.bucket) {
    throw new Error(`R2/S3 ${access} bucket is not configured.`);
  }
  return cfg;
};

const extensionFor = (resourceType = 'auto', contentType = '') => {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('svg')) return 'svg';
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('mpeg')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('quicktime')) return 'mov';
  if (resourceType === 'image') return 'jpg';
  if (resourceType === 'video') return 'mp4';
  return 'bin';
};

const defaultContentType = (resourceType = 'auto') => {
  if (resourceType === 'image') return 'image/jpeg';
  if (resourceType === 'video') return 'video/mp4';
  return 'application/octet-stream';
};

const safeSegment = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const buildObjectKey = (folder, resourceType, contentType, filename) => {
  const cleanFolder = trimSlash(folder || 'prophetic-pathway');
  const ext = path.extname(filename || '').replace(/^\./, '') || extensionFor(resourceType, contentType);
  const baseName = safeSegment(path.basename(filename || '', path.extname(filename || ''))) || crypto.randomUUID();
  const stamp = new Date().toISOString().slice(0, 10);
  return `${cleanFolder}/${stamp}/${baseName}-${crypto.randomUUID()}.${ext}`;
};

const encodeKey = (key) => trimSlash(key).split('/').map(encodeURIComponent).join('/');

export const getObjectPublicUrl = (key, options = {}) => {
  const access = options.access || 'public';
  const cfg = configForAccess(access);
  const clean = encodeKey(key);
  if (access === 'private') return `r2://${cfg.bucket}/${trimSlash(key)}`;
  if (cfg.publicBase) return `${cfg.publicBase}/${clean}`;
  const endpoint = trimTrailingSlash(cfg.endpoint || '');
  if (!endpoint || !cfg.bucket) return clean;
  return cfg.forcePathStyle
    ? `${endpoint}/${cfg.bucket}/${clean}`
    : `${new URL(endpoint).protocol}//${cfg.bucket}.${new URL(endpoint).host}/${clean}`;
};

const buildObjectUrl = (cfg, key) => {
  const endpoint = new URL(trimTrailingSlash(cfg.endpoint));
  const clean = encodeKey(key);
  if (cfg.forcePathStyle) {
    endpoint.pathname = `${trimSlash(endpoint.pathname) ? `/${trimSlash(endpoint.pathname)}` : ''}/${cfg.bucket}/${clean}`;
  } else {
    endpoint.hostname = `${cfg.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${trimSlash(endpoint.pathname) ? `/${trimSlash(endpoint.pathname)}` : ''}/${clean}`;
  }
  endpoint.search = '';
  return endpoint;
};

const getSigningKey = (secret, dateStamp, region) => {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
};

const signedHeadersFor = ({ method, url, payloadHash, contentType, access = 'public' }) => {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const cfg = assertStorageConfigured(access);
  const region = cfg.region || 'auto';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const host = url.host;
  const canonicalUri = url.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signature = hmac(getSigningKey(cfg.secret, dateStamp, region), stringToSign, 'hex');
  return {
    ...(contentType ? { 'Content-Type': contentType } : {}),
    'X-Amz-Content-Sha256': payloadHash,
    'X-Amz-Date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
};

const toUploadResult = ({ key, url, bytes, contentType }) => ({
  key,
  public_id: key,
  publicId: key,
  url,
  secure_url: url,
  bytes,
  contentType,
  provider: 'r2'
});

export const uploadBufferToObjectStorage = async (
  buffer,
  folder = 'prophetic-pathway',
  resourceType = 'auto',
  options = {}
) => {
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const contentType = options.contentType || defaultContentType(resourceType);
  const key = options.key || buildObjectKey(folder, resourceType, contentType, options.filename);
  const access = resolveAccess(folder, options);
  const cfg = assertStorageConfigured(access);
  const url = buildObjectUrl(cfg, key);
  const headers = signedHeadersFor({
    method: 'PUT',
    url,
    payloadHash: sha256Hex(body),
    contentType,
    access
  });
  const res = await fetch(url, { method: 'PUT', headers, body });
  if (!res.ok) {
    throw new Error(`R2 upload failed (${res.status}): ${await res.text()}`);
  }
  return toUploadResult({ key, url: getObjectPublicUrl(key, { access }), bytes: body.length, contentType });
};

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

export const uploadFileToObjectStorage = async (
  filePath,
  folder = 'prophetic-pathway',
  resourceType = 'auto',
  options = {}
) => {
  const stat = fs.statSync(filePath);
  const contentType = options.contentType || defaultContentType(resourceType);
  const key = options.key || buildObjectKey(folder, resourceType, contentType, options.filename || path.basename(filePath));
  const access = resolveAccess(folder, options);
  const cfg = assertStorageConfigured(access);
  const url = buildObjectUrl(cfg, key);
  const headers = signedHeadersFor({
    method: 'PUT',
    url,
    payloadHash: await sha256File(filePath),
    contentType,
    access
  });
  headers['Content-Length'] = String(stat.size);
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });
  if (!res.ok) {
    throw new Error(`R2 file upload failed (${res.status}): ${await res.text()}`);
  }
  return toUploadResult({ key, url: getObjectPublicUrl(key, { access }), bytes: stat.size, contentType });
};

export const deleteObjectStorage = async (key, options = {}) => {
  const access = options.access || 'public';
  const cfg = assertStorageConfigured(access);
  const url = buildObjectUrl(cfg, key);
  const payloadHash = sha256Hex('');
  const headers = signedHeadersFor({
    method: 'DELETE',
    url,
    payloadHash,
    contentType: '',
    access
  });
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed (${res.status}): ${await res.text()}`);
  }
  return { result: res.status === 404 ? 'not found' : 'ok', key };
};

export const parseObjectStorageUrl = (raw) => {
  const value = String(raw || '');
  if (!value.startsWith('r2://')) return null;
  const without = value.slice('r2://'.length);
  const [bucket, ...parts] = without.split('/');
  const key = parts.join('/');
  if (!bucket || !key) return null;
  return { bucket, key };
};

export const fetchObjectStorage = async (raw) => {
  const parsed = parseObjectStorageUrl(raw);
  if (!parsed) return null;
  const cfgBase = getStorageConfig();
  const access = parsed.bucket === cfgBase.privateBucket ? 'private' : 'public';
  const cfg = { ...assertStorageConfigured(access), bucket: parsed.bucket };
  const url = buildObjectUrl(cfg, parsed.key);
  const payloadHash = sha256Hex('');
  const headers = signedHeadersFor({
    method: 'GET',
    url,
    payloadHash,
    contentType: '',
    access
  });
  return fetch(url, { method: 'GET', headers });
};

// Backward-compatible names. These now use Cloudflare R2 / S3-compatible storage.
export const uploadBufferToCloudinary = uploadBufferToObjectStorage;
export const deleteCloudinary = deleteObjectStorage;

export default {
  objectStorageConfigured,
  uploadBufferToObjectStorage,
  uploadFileToObjectStorage,
  deleteObjectStorage,
  fetchObjectStorage,
  parseObjectStorageUrl,
  uploadBufferToCloudinary,
  deleteCloudinary,
  getObjectPublicUrl
};
