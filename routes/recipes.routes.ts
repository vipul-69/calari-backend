// routes/recipes.ts
import express from "express";
import {
  getRecipes,
  getRecipeById,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  syncRecipes,
  getRecipeAnalytics,
  addRecipeToMeal,
} from "../controller/recipes.controller";
import { attachUserData } from "../middleware/auth.middleware";

const router = express.Router();

// All routes require authentication
router.use(attachUserData);
router.get("/", getRecipes as any);
router.get("/analytics", getRecipeAnalytics as any);
router.get("/:recipeId", getRecipeById as any);
router.post("/", createRecipe as any);
router.put("/:recipeId", updateRecipe as any);
router.delete("/:recipeId", deleteRecipe as any);
router.post("/sync", syncRecipes as any);
router.post("/:recipeId/add-to-meal", addRecipeToMeal as any);

export default router;
