import { Router } from 'express';
import { analyzeFoodImage, analyzeFoodText, suggestMacros } from '../controller/food.controller';

const router = Router();

router.post('/image', analyzeFoodImage);
router.post('/text', analyzeFoodText)
router.post('/suggest', suggestMacros)
export default router;
