// routes/dailyMealsRoutes.ts
import express from 'express';
import { 
  getDailyMeals, 
  addFoodEntry, 
  syncDailyMeals,
  removeFoodEntry,
  getMealHistory,
  getNutritionAnalytics,
  getMealCount
} from '../controller/meals.controller';
import { attachUserData } from '../middleware/auth.middleware';



const router = express.Router();

router.use(attachUserData)

router.get('/day/:date', getDailyMeals as any);

router.post('/add-food', addFoodEntry as any);

router.post('/sync', syncDailyMeals as any);

router.delete('/day/:date/entry/:entryId', removeFoodEntry as any);
router.get('/history', getMealHistory as any);

router.get('/analytics', getNutritionAnalytics as any);

router.get('/count', getMealCount as any)
export default router;
