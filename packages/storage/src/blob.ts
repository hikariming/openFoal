import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, join, resolve, sep } from "node:path";

declare const Buffer: any;
declare const process: any;

export interface BlobStore {
  getText(key: string): Promise<string | undefined>;
  putText(key: string, content: string): Promise<void>;
  head(key: string): Promise<{ size: number; updatedAt?: string } | undefined>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export interface MinioBlobStoreOptions {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  forcePathStyle?: boolean;
}

export class FsBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async getText(key: string): Promise<string | undefined> {
    const path = this.resolve(key);
    try {
      const data = await readFileUtf8(path);
      return data;
    } catch {
      return undefined;
    }
  }

  async putText(key: string, content: string): Promise<void> {
    const path = this.resolve(key);
    mkdirSync(dirname(path), { recursive: true });
    await writeFileUtf8(path, content);
  }

  async head(key: string): Promise<{ size: number; updatedAt?: string } | undefined> {
    const path = this.resolve(key);
    try {
      const stats = statSync(path);
      return {
        size: stats.size,
        updatedAt: stats.mtime.toISOString()
      };
    } catch {
      return undefined;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const absolute = this.resolve(prefix);
    if (!existsSync(absolute)) {
      return [];
    }
    const output: string[] = [];
    walkDirectory(absolute, (filePath) => {
      output.push(toPosixPath(relativeUnder(this.root, filePath)));
    });
    return output.sort((a, b) => a.localeCompare(b));
  }

  async remove(key: string): Promise<void> {
    const path = this.resolve(key);
    try {
      unlinkSync(path);
    } catch {
      // ignore missing file
    }
  }

  private resolve(key: string): string {
    const target = resolve(this.root, key);
    const normalizedRoot = toPosixPath(this.root);
    const normalizedTarget = toPosixPath(target);
    if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)) {
      return target;
    }
    throw new Error(`blob key escapes root: ${key}`);
  }
}

export class MinioBlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private ensureBucketPromise?: Promise<void>;

  constructor(options: MinioBlobStoreOptions = {}) {
    const endpoint = options.endpoint ?? process?.env?.OPENFOAL_MINIO_ENDPOINT ?? "http://127.0.0.1:9000";
    const region = options.region ?? process?.env?.OPENFOAL_MINIO_REGION ?? "us-east-1";
    const accessKeyId = options.accessKeyId ?? process?.env?.OPENFOAL_MINIO_ACCESS_KEY ?? "openfoal";
    const secretAccessKey = options.secretAccessKey ?? process?.env?.OPENFOAL_MINIO_SECRET_KEY ?? "openfoal123";
    this.bucket = options.bucket ?? process?.env?.OPENFOAL_MINIO_BUCKET ?? "openfoal-enterprise";
    this.client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: options.forcePathStyle ?? true
    });
  }

  async getText(key: string): Promise<string | undefined> {
    await this.ensureBucket();
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: sanitizeKey(key)
        })
      );
      return await bodyToString(result.Body);
    } catch {
      return undefined;
    }
  }

  async putText(key: string, content: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: sanitizeKey(key),
        Body: content,
        ContentType: "text/plain; charset=utf-8"
      })
    );
  }

  async head(key: string): Promise<{ size: number; updatedAt?: string } | undefined> {
    await this.ensureBucket();
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: sanitizeKey(key)
        })
      );
      return {
        size: Number(result.ContentLength ?? 0),
        ...(result.LastModified ? { updatedAt: result.LastModified.toISOString() } : {})
      };
    } catch {
      return undefined;
    }
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureBucket();
    const output: string[] = [];
    let continuationToken: string | undefined;
    const normalizedPrefix = sanitizeKey(prefix);

    while (true) {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalizedPrefix,
          ContinuationToken: continuationToken
        })
      );
      const contents = Array.isArray(result.Contents) ? result.Contents : [];
      for (const item of contents) {
        if (typeof item.Key === "string") {
          output.push(item.Key);
        }
      }
      if (!result.IsTruncated || !result.NextContinuationToken) {
        break;
      }
      continuationToken = result.NextContinuationToken;
    }

    return output.sort((a, b) => a.localeCompare(b));
  }

  async remove(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: sanitizeKey(key)
      })
    );
  }

  async putFile(localPath: string, key: string, contentType = "application/octet-stream"): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: sanitizeKey(key),
        Body: createReadStream(localPath),
        ContentType: contentType
      })
    );
  }

  private async ensureBucket(): Promise<void> {
    if (this.ensureBucketPromise) {
      await this.ensureBucketPromise;
      return;
    }
    this.ensureBucketPromise = (async () => {
      try {
        await this.client.send(
          new HeadBucketCommand({
            Bucket: this.bucket
          })
        );
      } catch {
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucket
          })
        );
      }
    })();
    await this.ensureBucketPromise;
  }
}

export async function syncLocalDirectoryToMinio(input: {
  localRoot: string;
  keyPrefix: string;
  store?: MinioBlobStore;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
}): Promise<{ uploaded: number; scanned: number }> {
  const store =
    input.store ??
    new MinioBlobStore({
      endpoint: input.endpoint,
      region: input.region,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      bucket: input.bucket
    });

  const root = resolve(input.localRoot);
  if (!existsSync(root)) {
    return {
      uploaded: 0,
      scanned: 0
    };
  }

  const files: string[] = [];
  walkDirectory(root, (path) => {
    files.push(path);
  });

  let uploaded = 0;
  for (const filePath of files) {
    const relative = toPosixPath(relativeUnder(root, filePath));
    const key = joinKey(input.keyPrefix, relative);
    const head = await store.head(key);
    const stats = statSync(filePath);
    if (head && head.size === stats.size) {
      continue;
    }
    await store.putFile(filePath, key, guessContentType(filePath));
    uploaded += 1;
  }

  return {
    uploaded,
    scanned: files.length
  };
}

export async function mirrorBlobPrefixToFs(input: {
  store: BlobStore;
  prefix: string;
  fsRoot: string;
}): Promise<{ written: number; total: number }> {
  const keys = await input.store.list(input.prefix);
  let written = 0;
  for (const key of keys) {
    const content = await input.store.getText(key);
    if (content === undefined) {
      continue;
    }
    const relative = key.startsWith(input.prefix) ? key.slice(input.prefix.length).replace(/^\/+/, "") : key;
    const targetPath = resolve(input.fsRoot, relative);
    mkdirSync(dirname(targetPath), { recursive: true });
    await writeFileUtf8(targetPath, content);
    written += 1;
  }
  return {
    written,
    total: keys.length
  };
}

function sanitizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function joinKey(prefix: string, suffix: string): string {
  const p = sanitizeKey(prefix).replace(/\/+$/, "");
  const s = sanitizeKey(suffix).replace(/^\/+/, "");
  return p.length > 0 ? `${p}/${s}` : s;
}

function walkDirectory(root: string, onFile: (path: string) => void): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(entryPath, onFile);
      continue;
    }
    if (entry.isFile()) {
      onFile(entryPath);
    }
  }
}

function relativeUnder(root: string, target: string): string {
  const normalizedRoot = toPosixPath(resolve(root));
  const normalizedTarget = toPosixPath(resolve(target));
  if (normalizedTarget === normalizedRoot) {
    return "";
  }
  if (!normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`path is not under root: ${target}`);
  }
  return normalizedTarget.slice(normalizedRoot.length + 1);
}

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function guessContentType(path: string): string {
  if (path.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  if (path.endsWith(".json")) {
    return "application/json";
  }
  if (path.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) {
    return "";
  }
  const candidate = body as {
    transformToString?: (encoding?: string) => Promise<string>;
    [Symbol.asyncIterator]?: () => AsyncIterator<any>;
  };
  if (typeof candidate.transformToString === "function") {
    return await candidate.transformToString("utf-8");
  }
  if (typeof candidate[Symbol.asyncIterator] === "function") {
    const chunks: any[] = [];
    for await (const chunk of candidate as AsyncIterable<any>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return String(body);
}

function readFileUtf8(path: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path, { encoding: "utf8" });
    let output = "";
    stream.on("data", (chunk) => {
      output += String(chunk);
    });
    stream.on("error", rejectPromise);
    stream.on("end", () => {
      resolvePromise(output);
    });
  });
}

function writeFileUtf8(path: string, content: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = createWriteStream(path, { encoding: "utf8" });
    stream.on("error", rejectPromise);
    stream.on("finish", () => resolvePromise());
    stream.end(content);
  });
}
