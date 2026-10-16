const cloudinary = require('cloudinary').v2;

const isConfigured = () => {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

if (isConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true
  });
}

/**
 * Uploads a buffer to Cloudinary using upload_stream
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadStream = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      return reject(new Error('Cloudinary is not configured. Missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET.'));
    }

    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    stream.end(buffer);
  });
};

/**
 * Uploads user avatar buffer with auto-format and optimization
 * @param {Buffer} buffer - Avatar image buffer
 * @param {string} [userId] - Optional user ID for public_id naming
 * @returns {Promise<Object>} { secure_url, public_id }
 */
const uploadAvatarStream = (buffer, userId) => {
  const options = {
    folder: 'freelancehub/avatars',
    public_id: userId ? `avatar_${userId}_${Date.now()}` : undefined,
    overwrite: true,
    resource_type: 'image',
    transformation: [
      { width: 300, height: 300, crop: 'fill', gravity: 'face' },
      { fetch_format: 'auto', quality: 'auto' }
    ]
  };
  return uploadStream(buffer, options);
};

/**
 * Uploads project attachment buffer
 * @param {Buffer} buffer - Attachment file buffer
 * @param {string} originalName - Original filename
 * @returns {Promise<Object>} { secure_url, public_id }
 */
const uploadAttachmentStream = (buffer, originalName) => {
  const sanitizedName = (originalName || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
  const options = {
    folder: 'freelancehub/attachments',
    resource_type: 'auto',
    public_id: `${Date.now()}_${sanitizedName}`
  };
  return uploadStream(buffer, options);
};

/**
 * Deletes a Cloudinary resource by public ID
 * @param {string} publicId - Cloudinary public ID
 * @param {string} [resourceType='image'] - 'image', 'raw', or 'video'
 * @returns {Promise<Object>}
 */
const deleteResource = async (publicId, resourceType = 'image') => {
  if (!publicId || !isConfigured()) return;
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error(`[Cloudinary delete error for ${publicId}]:`, err.message);
  }
};

module.exports = {
  cloudinary,
  isConfigured,
  uploadStream,
  uploadAvatarStream,
  uploadAttachmentStream,
  deleteResource
};
