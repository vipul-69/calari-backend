import { Router } from 'express';
import { analyzeFoodImage, analyzeFoodText } from '../controller/food.controller';
import { verifyPaymentController } from '../controller/payments.controller';

const router = Router();

router.post('/', verifyPaymentController);

export default router;
