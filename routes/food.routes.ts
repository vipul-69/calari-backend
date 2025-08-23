import { Router } from 'express';
import { analyzeFoodImage, analyzeFoodText, extractFoodFromPrompt, suggestMacros } from '../controller/food.controller';

const router = Router();

router.post('/image', analyzeFoodImage);
router.post('/text', analyzeFoodText)
router.post('/suggest', suggestMacros)
router.post('/voice', extractFoodFromPrompt)
export default router;
