// controllers/dailyMealsController.ts
import type { Request, Response } from 'express';
import { pool } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

// Type definitions based on your user store structure
interface FoodEntry {
  id: string;
  foodName: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  analysisType: 'image' | 'text';
  imageUrl?: string;
  analysisData?: any;
  createdAt: string;
}

interface DailyMealData {
  totalMacros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  foodEntries: FoodEntry[];
  lastModified: string;
}

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    plan: string;
    profile: any;
  };
}

/**
 * Get daily meal data for a specific date
 */
export const getDailyMeals = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { date } = req.params; // Format: YYYY-MM-DD

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
      return;
    }

    const query = `
      SELECT id, food_details, created_at, updated_at
      FROM daily_meals 
      WHERE user_id = $1 AND date = $2
    `;

    const result = await pool.query(query, [userId, date]);

    if (result.rows.length === 0) {
      // Return empty structure for new day
      res.status(200).json({
        success: true,
        data: { 
          date,
          totalMacros: {
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0
          },
          foodEntries: [],
          lastModified: new Date().toISOString()
        }
      });
      return;
    }

    const dailyMeal = result.rows[0];
    
    res.status(200).json({
      success: true,
      data: {
        id: dailyMeal.id,
        date,
        ...dailyMeal.food_details,
        lastModified: dailyMeal.updated_at.toISOString()
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch daily meal data'
    });
  }
};

/**
 * Add a food entry to today's meals
 */
export const addFoodEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { 
      date,
      foodName, 
      quantity, 
      calories, 
      protein, 
      carbs, 
      fat, 
      analysisType = 'text',
      imageUrl,
      analysisData 
    } = req.body;

    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
      return;
    }

    // Validate required fields
    if (!date || !foodName || !quantity || calories === undefined || protein === undefined || carbs === undefined || fat === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: date, foodName, quantity, calories, protein, carbs, fat'
      });
      return;
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get existing daily meal data
      const existingQuery = `
        SELECT id, food_details
        FROM daily_meals 
        WHERE user_id = $1 AND date = $2
      `;
      
      const existingResult = await client.query(existingQuery, [userId, date]);
      
      const newFoodEntry: FoodEntry = {
        id: uuidv4(),
        foodName,
        quantity,
        calories: Number(calories),
        protein: Number(protein),
        carbs: Number(carbs),
        fat: Number(fat),
        analysisType,
        imageUrl,
        analysisData,
        createdAt: new Date().toISOString()
      };

      let updatedFoodDetails: DailyMealData;

      if (existingResult.rows.length === 0) {
        // Create new daily meal record
        updatedFoodDetails = {
          totalMacros: {
            calories: newFoodEntry.calories,
            protein: newFoodEntry.protein,
            carbs: newFoodEntry.carbs,
            fat: newFoodEntry.fat
          },
          foodEntries: [newFoodEntry],
          lastModified: new Date().toISOString()
        };

        const insertQuery = `
          INSERT INTO daily_meals (user_id, date, food_details, created_at, updated_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `;
        
        await client.query(insertQuery, [userId, date, JSON.stringify(updatedFoodDetails)]);
      } else {
        // Update existing daily meal record
        const existingData = existingResult.rows[0].food_details as DailyMealData;
        
        updatedFoodDetails = {
          totalMacros: {
            calories: existingData.totalMacros.calories + newFoodEntry.calories,
            protein: existingData.totalMacros.protein + newFoodEntry.protein,
            carbs: existingData.totalMacros.carbs + newFoodEntry.carbs,
            fat: existingData.totalMacros.fat + newFoodEntry.fat
          },
          foodEntries: [...existingData.foodEntries, newFoodEntry],
          lastModified: new Date().toISOString()
        };

        const updateQuery = `
          UPDATE daily_meals 
          SET food_details = $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2 AND date = $3
        `;
        
        await client.query(updateQuery, [JSON.stringify(updatedFoodDetails), userId, date]);
      }

      await client.query('COMMIT');
      res.json({
        success: true,
        data: {
          date,
          ...updatedFoodDetails,
          newEntryId: newFoodEntry.id
        }
      });
    } catch (error:any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add food entry'
    });
  }
};

/**
 * Update/sync entire day's meal data
 */
export const syncDailyMeals = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { date, totalMacros, foodEntries } = req.body;


    // Validate date format first
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
      return;
    }

    // Validate required fields
    if (!totalMacros || !foodEntries) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: date, totalMacros, foodEntries'
      });
      return;
    }

    const foodDetails: DailyMealData = {
      totalMacros,
      foodEntries: foodEntries.map((entry: any) => ({
        ...entry,
        id: entry.id || uuidv4(), // Ensure each entry has an ID
        createdAt: entry.createdAt || new Date().toISOString()
      })),
      lastModified: new Date().toISOString()
    };

    const query = `
      INSERT INTO daily_meals (user_id, date, food_details, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, date)
      DO UPDATE SET 
        food_details = EXCLUDED.food_details,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, updated_at
    `;

    const result = await pool.query(query, [userId, date, JSON.stringify(foodDetails)]);
    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        date,
        ...foodDetails,
        lastModified: result.rows[0].updated_at.toISOString()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to sync daily meal data'
    });
  }
};

/**
 * Remove a specific food entry from a day
 */
export const removeFoodEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { date, entryId } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
      return;
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get existing daily meal data
      const existingQuery = `
        SELECT id, food_details
        FROM daily_meals 
        WHERE user_id = $1 AND date = $2
      `;
      
      const existingResult = await client.query(existingQuery, [userId, date]);
      
      if (existingResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No meal data found for this date'
        });
        return;
      }

      const existingData = existingResult.rows[0].food_details as DailyMealData;
      const entryToRemove = existingData.foodEntries.find(entry => entry.id === entryId);
      
      if (!entryToRemove) {
        res.status(404).json({
          success: false,
          error: 'Food entry not found'
        });
        return;
      }

      // Remove the entry and update totals
      const updatedFoodDetails: DailyMealData = {
        totalMacros: {
          calories: existingData.totalMacros.calories - entryToRemove.calories,
          protein: existingData.totalMacros.protein - entryToRemove.protein,
          carbs: existingData.totalMacros.carbs - entryToRemove.carbs,
          fat: existingData.totalMacros.fat - entryToRemove.fat
        },
        foodEntries: existingData.foodEntries.filter(entry => entry.id !== entryId),
        lastModified: new Date().toISOString()
      };

      const updateQuery = `
        UPDATE daily_meals 
        SET food_details = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2 AND date = $3
        RETURNING updated_at
      `;
      
      const updateResult = await client.query(updateQuery, [JSON.stringify(updatedFoodDetails), userId, date]);

      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          date,
          ...updatedFoodDetails,
          lastModified: updateResult.rows[0].updated_at.toISOString()
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to remove food entry'
    });
  }
};

/**
 * Get meal data for a date range (for analytics/history)
 */
export const getMealHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate, limit = 30 } = req.query;

    let query = `
      SELECT date, food_details, updated_at
      FROM daily_meals 
      WHERE user_id = $1
    `;
    
    const params: any[] = [userId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY date DESC LIMIT $${paramIndex}`;
    params.push(Number(limit));

    const result = await pool.query(query, params);

    const mealHistory = result.rows.map(row => ({
      date: row.date,
      ...row.food_details,
      lastModified: row.updated_at.toISOString()
    }));

    res.json({
      success: true,
      data: mealHistory
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch meal history'
    });
  }
};

/**
 * Get nutrition analytics (totals, averages, etc.)
 */
export const getNutritionAnalytics = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { days = 7 } = req.query;

    const query = `
      SELECT 
        date,
        (food_details->>'totalMacros')::jsonb as total_macros
      FROM daily_meals 
      WHERE user_id = $1 
        AND date >= CURRENT_DATE - INTERVAL '${Number(days)} days'
      ORDER BY date DESC
    `;

    const result = await pool.query(query, [userId]);

    const analytics = {
      totalDays: result.rows.length,
      averageMacros: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0
      },
      totalMacros: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0
      },
      dailyData: result.rows.map(row => ({
        date: row.date,
        macros: row.total_macros
      }))
    };

    // Calculate totals and averages
    analytics.dailyData.forEach(day => {
      analytics.totalMacros.calories += day.macros.calories;
      analytics.totalMacros.protein += day.macros.protein;
      analytics.totalMacros.carbs += day.macros.carbs;
      analytics.totalMacros.fat += day.macros.fat;
    });

    if (analytics.totalDays > 0) {
      analytics.averageMacros.calories = analytics.totalMacros.calories / analytics.totalDays;
      analytics.averageMacros.protein = analytics.totalMacros.protein / analytics.totalDays;
      analytics.averageMacros.carbs = analytics.totalMacros.carbs / analytics.totalDays;
      analytics.averageMacros.fat = analytics.totalMacros.fat / analytics.totalDays;
    }

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch nutrition analytics'
    });
  }
};

export const getMealCount = async(req:AuthenticatedRequest, res:Response)=>{
    try{
        const userId = req.user.id
        console.log(userId)
        const query = `
        SELECT meals_scanned 
            FROM daily_meals
            WHERE user_id = $1 AND date = CURRENT_DATE;
        `

        const result = await pool.query(query,[userId])
        console.log(result.rows[0])
        res.status(200).json({
            success:true,
            data: result.rows[0].meals_scanned
        })
    }
    catch{
        res.status(500).json({
            success:false,
        })
    }
}