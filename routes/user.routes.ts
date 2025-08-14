import { Router } from "express";
import { upsertUser , getUser } from "../controller/user.controller";

const router = Router();

router.post("/", upsertUser);
router.get("/:email", getUser)

export default router;
