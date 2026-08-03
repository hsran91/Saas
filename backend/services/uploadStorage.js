const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { S3Client, PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");

const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || "local").trim().toLowerCase();
const LOCAL_UPLOAD_DIR = path.join(__dirname, "..", "uploads");

function ensureLocalUploadDir() {
  if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
    fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
  }
}

function getExtension(originalName = "") {
  return path.extname(originalName) || "";
}

function buildObjectKey(prefix, originalName) {
  return `${prefix}/${Date.now()}-${randomUUID()}${getExtension(originalName)}`;
}

function getS3Config() {
  return {
    bucket: process.env.OBJECT_STORAGE_BUCKET,
    region: process.env.OBJECT_STORAGE_REGION,
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true"
  };
}

function createS3Client() {
  const config = getS3Config();
  if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("S3 storage is not fully configured");
  }

  return {
    config,
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  };
}

function buildS3PublicUrl(config, objectKey) {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/${objectKey}`;
  }

  if (config.endpoint) {
    return `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${objectKey}`;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${objectKey}`;
}

async function saveUploadedFile(file, options = {}) {
  if (!file) return null;

  const prefix = options.prefix || "uploads";

  if (STORAGE_DRIVER === "s3") {
    const { client, config } = createS3Client();
    const objectKey = buildObjectKey(prefix, file.originalname);

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype
    }));

    return buildS3PublicUrl(config, objectKey);
  }

  ensureLocalUploadDir();
  const fileName = `${Date.now()}-${randomUUID()}${getExtension(file.originalname)}`;
  const filePath = path.join(LOCAL_UPLOAD_DIR, fileName);
  await fsPromises.writeFile(filePath, file.buffer);
  return `/uploads/${fileName}`;
}

async function checkStorageReadiness() {
  if (STORAGE_DRIVER === "s3") {
    try {
      const { client, config } = createS3Client();
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { ready: true, driver: "s3" };
    } catch (err) {
      return { ready: false, driver: "s3", error: err.message };
    }
  }

  try {
    ensureLocalUploadDir();
    return { ready: true, driver: "local" };
  } catch (err) {
    return { ready: false, driver: "local", error: err.message };
  }
}

function shouldServeLocalUploads() {
  return STORAGE_DRIVER !== "s3";
}

function getLocalUploadDir() {
  ensureLocalUploadDir();
  return LOCAL_UPLOAD_DIR;
}

module.exports = {
  saveUploadedFile,
  checkStorageReadiness,
  shouldServeLocalUploads,
  getLocalUploadDir
};