// routes/uploadRoutes.ts
import express from 'express';
import { uploadFoodImageController } from '../controller/upload.controller';

const router = express.Router();

router.post('/', uploadFoodImageController);

export default router;
