import { Router } from 'express';
import { analyzeFoodImage, analyzeFoodText } from '../controller/food.controller';

const router = Router();

router.post('/image', analyzeFoodImage);
router.post('/text', analyzeFoodText)

export default router;
