const multer = require("multer");

const MAX_UPLOAD_FILE_SIZE_BYTES = Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES || 5 * 1024 * 1024);

const imageFileFilter = (req, file, cb) => {
  if (!file) {
    return cb(null, false);
  }

  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();
  const looksLikeImage = mime.startsWith("image/") || /\.(png|jpe?g|jfif|gif|webp|bmp|heic|heif|avif|tiff?|ico)$/i.test(name);

  if (!looksLikeImage) {
    return cb(new Error("Unsupported file type. Please upload an image file."));
  }

  cb(null, true);
};

module.exports = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: 1
  }
});
