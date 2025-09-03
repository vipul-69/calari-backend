// controllers/recipesController.ts
import type { Request, Response } from "express";
import { pool } from "../config/db";
import { v4 as uuidv4 } from "uuid";

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    plan: string;
    profile: any;
  };
}

/**
 * Utility to safely extract recipes array
 */
const extractRecipes = (row: any) =>
  row?.recipes && Array.isArray(row.recipes) ? row.recipes : [];

/**
 * Get all recipes for a user
 */
export const getRecipes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const query = `
      SELECT recipes
      FROM recipes
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);
    const recipes = extractRecipes(result.rows[0]).slice(
      Number(offset),
      Number(offset) + Number(limit),
    );

    res.json({ success: true, data: recipes });
  } catch (error) {
    console.error("Get recipes error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch recipes" });
  }
};

/**
 * Get a single recipe by ID
 */
export const getRecipeById = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const { recipeId } = req.params;

    const result = await pool.query(
      `SELECT recipes FROM recipes WHERE user_id = $1`,
      [userId],
    );
    const recipes = extractRecipes(result.rows[0]);
    const recipe = recipes.find((r: any) => r.id === recipeId);

    if (!recipe) {
      res.status(404).json({ success: false, error: "Recipe not found" });
      return;
    }

    res.json({ success: true, data: recipe });
  } catch (error) {
    console.error("Get recipe by ID error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch recipe" });
  }
};

/**
 * Create a new recipe (append to array)
 */
export const createRecipe = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const { name, ...recipeData } = req.body;

    if (!name) {
      res
        .status(400)
        .json({ success: false, error: "Missing required field: name" });
      return;
    }

    const newRecipe = {
      id: uuidv4(),
      name,
      ...recipeData,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    const query = `
      INSERT INTO recipes (user_id, recipes, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET recipes = recipes.recipes || $2, updated_at = CURRENT_TIMESTAMP
      RETURNING recipes
    `;

    const result = await pool.query(query, [
      userId,
      JSON.stringify([newRecipe]),
    ]);

    res.status(201).json({ success: true, data: newRecipe });
  } catch (error) {
    console.error("Create recipe error:", error);
    res.status(500).json({ success: false, error: "Failed to create recipe" });
  }
};

/**
 * Update an existing recipe inside array
 */
export const updateRecipe = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const { recipeId } = req.params;
    const { name, ...updateData } = req.body;

    const result = await pool.query(
      `SELECT recipes FROM recipes WHERE user_id = $1`,
      [userId],
    );
    const recipes = extractRecipes(result.rows[0]);

    const index = recipes.findIndex((r: any) => r.id === recipeId);
    if (index === -1) {
      res.status(404).json({ success: false, error: "Recipe not found" });
      return;
    }

    const updatedRecipe = {
      ...recipes[index],
      ...updateData,
      name: name || recipes[index].name,
      lastModified: new Date().toISOString(),
    };
    recipes[index] = updatedRecipe;

    await pool.query(
      `UPDATE recipes SET recipes = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [JSON.stringify(recipes), userId],
    );

    res.json({ success: true, data: updatedRecipe });
  } catch (error) {
    console.error("Update recipe error:", error);
    res.status(500).json({ success: false, error: "Failed to update recipe" });
  }
};

/**
 * Delete a recipe from array
 */
export const deleteRecipe = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const { recipeId } = req.params;

    const result = await pool.query(
      `SELECT recipes FROM recipes WHERE user_id = $1`,
      [userId],
    );
    const recipes = extractRecipes(result.rows[0]);
    const newRecipes = recipes.filter((r: any) => r.id !== recipeId);

    if (newRecipes.length === recipes.length) {
      res.status(404).json({ success: false, error: "Recipe not found" });
      return;
    }

    await pool.query(
      `UPDATE recipes SET recipes = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [JSON.stringify(newRecipes), userId],
    );

    res.json({ success: true, data: { id: recipeId, deleted: true } });
  } catch (error) {
    console.error("Delete recipe error:", error);
    res.status(500).json({ success: false, error: "Failed to delete recipe" });
  }
};

/**
 * Sync multiple recipes (overwrite user's recipes array)
 */
export const syncRecipes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { recipes } = req.body;

    if (!Array.isArray(recipes)) {
      res
        .status(400)
        .json({ success: false, error: "Recipes must be an array" });
      return;
    }

    const normalized = recipes.map((r) => ({
      ...r,
      id: r.id || uuidv4(),
      lastModified: new Date().toISOString(),
      createdAt: r.createdAt || new Date().toISOString(),
    }));

    await pool.query(
      `
      INSERT INTO recipes (user_id, recipes, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET recipes = EXCLUDED.recipes, updated_at = CURRENT_TIMESTAMP
    `,
      [userId, JSON.stringify(normalized)],
    );

    res.json({
      success: true,
      data: { syncedCount: normalized.length, recipes: normalized },
    });
  } catch (error) {
    console.error("Sync recipes error:", error);
    res.status(500).json({ success: false, error: "Failed to sync recipes" });
  }
};

/**
 * Basic analytics on recipes array
 */
export const getRecipeAnalytics = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT recipes FROM recipes WHERE user_id = $1`,
      [userId],
    );
    const recipes = extractRecipes(result.rows[0]);

    const totalRecipes = recipes.length;

    const avgMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    let count = 0;
    const tagUsage: Record<string, number> = {};

    recipes.forEach((r: any) => {
      if (r.totalMacros) {
        avgMacros.calories += Number(r.totalMacros.calories || 0);
        avgMacros.protein += Number(r.totalMacros.protein || 0);
        avgMacros.carbs += Number(r.totalMacros.carbs || 0);
        avgMacros.fat += Number(r.totalMacros.fat || 0);
        count++;
      }
      (r.tags || []).forEach((tag: string) => {
        tagUsage[tag] = (tagUsage[tag] || 0) + 1;
      });
    });

    if (count > 0) {
      avgMacros.calories /= count;
      avgMacros.protein /= count;
      avgMacros.carbs /= count;
      avgMacros.fat /= count;
    }

    const popularTags = Object.entries(tagUsage)
      .map(([tag, usage_count]) => ({ tag, usage_count }))
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, 10);

    res.json({
      success: true,
      data: { totalRecipes, averageMacros: avgMacros, popularTags },
    });
  } catch (error) {
    console.error("Recipe analytics error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch recipe analytics" });
  }
};

/**
 * Add recipe to meal - flexible ingredient handling
 */
export const addRecipeToMeal = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user.id;
    const { recipeId } = req.params;
    const { date, servings = 1 } = req.body;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res
        .status(400)
        .json({ success: false, error: "Invalid date format. Use YYYY-MM-DD" });
      return;
    }

    const result = await pool.query(
      `SELECT recipes FROM recipes WHERE user_id = $1`,
      [userId],
    );
    const recipes = extractRecipes(result.rows[0]);
    const recipe = recipes.find((r: any) => r.id === recipeId);

    if (!recipe) {
      res.status(404).json({ success: false, error: "Recipe not found" });
      return;
    }

    const ingredients = recipe.ingredients || [];
    const originalServings = recipe.servings || 1;
    const portionMultiplier = servings / originalServings;

    const foodEntries = ingredients.map((ingredient: any, index: number) => ({
      id: uuidv4(),
      foodName: `${recipe.name} - ${ingredient.name || `Ingredient ${index + 1}`}`,
      quantity: `${parseFloat(ingredient.quantity || "1") * portionMultiplier}`,
      calories: Math.round((ingredient.calories || 0) * portionMultiplier),
      protein: Math.round((ingredient.protein || 0) * portionMultiplier),
      carbs: Math.round((ingredient.carbs || 0) * portionMultiplier),
      fat: Math.round((ingredient.fat || 0) * portionMultiplier),
      analysisType: "text" as const,
      imageUrl: recipe.imageUrl,
      analysisData: {
        recipeId: recipe.id,
        originalServings,
        actualServings: servings,
        originalRecipeData: recipe,
      },
      createdAt: new Date().toISOString(),
    }));

    res.json({
      success: true,
      data: {
        recipe: { id: recipe.id, name: recipe.name },
        foodEntries,
        servings,
        date,
      },
    });
  } catch (error) {
    console.error("Add recipe to meal error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to add recipe to meal" });
  }
};
