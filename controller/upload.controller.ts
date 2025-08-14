// controllers/uploadFoodImageController.ts
import type { Request, Response } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

const runMulterMiddleware = (req: Request, res: Response): Promise<void> => {
  return new Promise((resolve, reject) => {
    upload.single('image')(req, res, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Helper function to upload to Cloudinary
const uploadToCloudinary = (fileBuffer: Buffer, originalName: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'food-images',
        resource_type: 'image',
        format: 'jpg',
        quality: 'auto:good',
        fetch_format: 'auto',
        public_id: `food-${Date.now()}-${originalName.split('.')[0]}`,
        transformation: [
          { width: 1000, height: 1000, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    
    uploadStream.end(fileBuffer);
  });
};

export const uploadFoodImageController = async (req: Request, res: Response) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate Cloudinary configuration
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error('Cloudinary configuration missing. Please check environment variables.');
    }

    await runMulterMiddleware(req, res);

    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

   
    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(file.buffer, file.originalname);

    // Also create base64 version for direct use (optional)
    const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;


    // Generate response data
    const responseData = {
      success: true,
      fileId: uploadResult.public_id,
      hostableLink: uploadResult.secure_url,
      fileName: file.originalname,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      // Optional: Include base64 for direct use
      base64: base64Image, // Can be used directly with Groq SDK
      cloudinaryData: {
        public_id: uploadResult.public_id,
        secure_url: uploadResult.secure_url,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
      }
    };

    res.status(200).json(responseData);

  } catch (error: any) {
    
    if (error.message === 'Only image files are allowed') {
      return res.status(400).json({ 
        error: 'Invalid file type', 
        details: 'Only image files (JPEG, PNG, GIF, WebP) are allowed' 
      });
    }
    
    if (error.message && error.message.includes('File too large')) {
      return res.status(400).json({ 
        error: 'File too large', 
        details: 'File size must be less than 10MB' 
      });
    }

    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message || 'Unknown error occurred during upload'
    });
  }
};
