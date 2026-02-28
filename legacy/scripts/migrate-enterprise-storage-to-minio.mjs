import { syncLocalDirectoryToMinio } from "../packages/storage/dist/index.js";

const localRoot = process.env.OPENFOAL_ENTERPRISE_STORAGE_ROOT ?? "/data/openfoal";
const keyPrefix = process.env.OPENFOAL_MINIO_KEY_PREFIX ?? "";

const report = await syncLocalDirectoryToMinio({
  localRoot,
  keyPrefix,
  endpoint: process.env.OPENFOAL_MINIO_ENDPOINT,
  region: process.env.OPENFOAL_MINIO_REGION,
  accessKeyId: process.env.OPENFOAL_MINIO_ACCESS_KEY,
  secretAccessKey: process.env.OPENFOAL_MINIO_SECRET_KEY,
  bucket: process.env.OPENFOAL_MINIO_BUCKET
});

console.log(
  JSON.stringify(
    {
      ok: true,
      localRoot,
      keyPrefix,
      uploaded: report.uploaded,
      scanned: report.scanned,
      at: new Date().toISOString()
    },
    null,
    2
  )
);
