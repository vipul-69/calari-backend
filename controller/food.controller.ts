import type { Request, Response } from 'express';
import { validateFoodImage, analyzeFoodFromImage, analyzeFoodFromText, validateFoodTextInput } from '../services/food.service';

interface FoodAnalysisRequest {
  imageUrl: string;
  context?: {
    userInfo: string;
    totalMacros: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
    consumedMacros: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
}

interface TextAnalysisRequest {
  foodName: string;
  quantity: string;
  context?: {
    userInfo: string;
    totalMacros: { 
      calories: number; 
      protein: number; 
      carbs: number; 
      fat: number; 
    };
    consumedMacros: { 
      calories: number; 
      protein: number; 
      carbs: number; 
      fat: number; 
    };
  };
}


/**
 * Main food analysis controller (image-based)
 */
export const analyzeFoodImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl, context }: FoodAnalysisRequest = req.body;
    
    // Validate required fields
    if (!imageUrl) {
      res.status(400).json({
        success: false,
        error: 'Image URL is required'
      });
      return;
    }


    // Step 1: Check if image contains food
    const foodValidation = await validateFoodImage(imageUrl);
    if (!foodValidation.isFood) {
      res.status(400).json({
        success: false,
        error: 'Image does not contain food items. Please upload an image with visible food.',
        reason: foodValidation.reason,
        imageUrl: imageUrl,
        timestamp: new Date().toISOString()
      });
      return;
    }


    // Step 2: Analyze food image
    const analysis = await analyzeFoodFromImage(imageUrl, context);
    
    // Build response
    const responseData: any = {
      success: true,
      data: analysis,
      analysisType: 'image',
      contextProvided: !!context,
      imageUrl: imageUrl,
      timestamp: new Date().toISOString()
    };

    // Add context-specific metadata
    if (context && analysis.suggestion) {
      responseData.hasRecommendation = true;
      responseData.hasComplementaryFoods = !!(analysis.suggestion.mealCompletionSuggestions?.length);
      responseData.recommendsEating = analysis.suggestion.shouldEat;
    } else {
      responseData.hasRecommendation = false;
      responseData.hasComplementaryFoods = false;
    }


    res.json(responseData);
    
  } catch (error) {
    
    // Handle different types of errors
    if (error instanceof Error) {
      if (error.message.includes('URL')) {
        res.status(400).json({
          success: false,
          error: 'Invalid or inaccessible image URL',
          timestamp: new Date().toISOString()
        });
      } else if (error.message.includes('GROQ_API_KEY')) {
        res.status(500).json({
          success: false,
          error: 'Service configuration error',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message || 'Unknown error occurred',
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: 'Unknown error occurred',
        timestamp: new Date().toISOString()
      });
    }
  }
};

/**
 * Text-based food analysis controller
 */
export const analyzeFoodText = async (req: Request, res: Response): Promise<void> => {
  if (req.method !== 'POST') {
    res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      details: 'Only POST requests are supported'
    });
    return;
  }

  try {
    const { foodName, quantity, context }: TextAnalysisRequest = req.body;

    // Validate required fields
    if (!foodName || !quantity) {
      res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        details: 'Both foodName and quantity are required' 
      });
      return;
    }

    

    // Validate input format and content
    const validation = validateFoodTextInput(foodName, quantity);
    if (!validation.isValid) {
      res.status(400).json({ 
        success: false,
        error: 'Invalid input', 
        details: validation.error || 'Input validation failed'
      });
      return;
    }

    
   
    const analysisStartTime = Date.now();
    
    const result = await analyzeFoodFromText(
      foodName.trim(), 
      quantity.trim(), 
      context
    );

    const analysisEndTime = Date.now();
    const analysisDuration = analysisEndTime - analysisStartTime;

   

    // Build response (matching image analysis format for consistency)
    const responseData: any = {
      success: true,
      data: result,
      analysisType: 'text',
      contextProvided: !!context,
      input: {
        foodName: foodName.trim(),
        quantity: quantity.trim()
      },
      timestamp: new Date().toISOString(),
    };

    // Add context-specific metadata
    if (context && result.suggestion) {
      responseData.hasRecommendation = true;
      responseData.hasComplementaryFoods = !!(result.suggestion.mealCompletionSuggestions?.length);
      responseData.recommendsEating = result.suggestion.shouldEat;
    } else {
      responseData.hasRecommendation = false;
      responseData.hasComplementaryFoods = false;
    }
    console.log(responseData)
    res.json(responseData);

  } catch (error: any) {
   

    // Handle specific error types
    if (error.message && error.message.includes('API key')) {
      res.status(503).json({ 
        success: false,
        error: 'Service configuration error', 
        details: 'AI analysis service is temporarily unavailable'
      });
      return;
    }

    if (error.message && error.message.includes('rate limit')) {
      res.status(429).json({ 
        success: false,
        error: 'Rate limit exceeded', 
        details: 'Please wait a moment before making another request'
      });
      return;
    }

    if (error.message && error.message.includes('timeout')) {
      res.status(504).json({ 
        success: false,
        error: 'Analysis timeout', 
        details: 'The analysis took too long. Please try again with simpler input.'
      });
      return;
    }

    // Generic error response
    res.status(500).json({ 
      success: false,
      error: 'Analysis failed', 
      details: error.message || 'Unknown error occurred during analysis'
    });
  }
};

