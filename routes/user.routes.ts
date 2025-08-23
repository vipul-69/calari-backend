import { Router } from "express";
import { upsertUser , getUser, getUserSubscriptions } from "../controller/user.controller";

const router = Router();

router.post("/", upsertUser);
router.get("/:email", getUser)
router.get('/subscriptions', getUserSubscriptions)

export default router;
