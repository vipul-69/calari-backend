import type { Request, Response } from "express";
import {
  analyzeFoodFromImage,
  analyzeFoodFromText,
} from "../services/food.service";
import { suggestMacrosWithGroq } from "../services/food.service";

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
export const analyzeFoodImage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { imageUrl, context }: FoodAnalysisRequest = req.body;

    // Validate required fields
    if (!imageUrl) {
      res.status(400).json({
        success: false,
        error: "Image URL is required",
      });
      return;
    }

    // Step 1: Check if image contains food
    const foodValidation = await validateFoodImage(imageUrl);
    if (!foodValidation.isFood) {
      res.status(400).json({
        success: false,
        error:
          "Image does not contain food items. Please upload an image with visible food.",
        reason: foodValidation.reason,
        imageUrl: imageUrl,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Step 2: Analyze food image
    const analysis = await analyzeFoodFromImage(imageUrl, context);

    // Build response
    const responseData: any = {
      success: true,
      data: analysis,
      analysisType: "image",
      contextProvided: !!context,
      imageUrl: imageUrl,
      timestamp: new Date().toISOString(),
    };

    // Add context-specific metadata
    if (context && analysis.suggestion) {
      responseData.hasRecommendation = true;
      responseData.hasComplementaryFoods =
        !!analysis.suggestion.mealCompletionSuggestions?.length;
      responseData.recommendsEating = analysis.suggestion.shouldEat;
    } else {
      responseData.hasRecommendation = false;
      responseData.hasComplementaryFoods = false;
    }

    res.json(responseData);
  } catch (error) {
    // Handle different types of errors
    if (error instanceof Error) {
      if (error.message.includes("URL")) {
        res.status(400).json({
          success: false,
          error: "Invalid or inaccessible image URL",
          timestamp: new Date().toISOString(),
        });
      } else if (error.message.includes("GROQ_API_KEY")) {
        res.status(500).json({
          success: false,
          error: "Service configuration error",
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message || "Unknown error occurred",
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: "Unknown error occurred",
        timestamp: new Date().toISOString(),
      });
    }
  }
};

/**
 * Text-based food analysis controller
 */
export const analyzeFoodText = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      error: "Method not allowed",
      details: "Only POST requests are supported",
    });
    return;
  }

  try {
    const { foodName, quantity, context }: TextAnalysisRequest = req.body;
    console.log(foodName, quantity, context);
    // Validate required fields
    if (!foodName || !quantity) {
      res.status(400).json({
        success: false,
        error: "Missing required fields",
        details: "Both foodName and quantity are required",
      });
      return;
    }

    // Validate input format and content
    const validation = validateFoodTextInput(foodName, quantity);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        error: "Invalid input",
        details: validation.error || "Input validation failed",
      });
      return;
    }

    const analysisStartTime = Date.now();

    const result = await analyzeFoodFromText(
      foodName.trim(),
      quantity.trim(),
      context,
    );

    const analysisEndTime = Date.now();
    const analysisDuration = analysisEndTime - analysisStartTime;

    // Build response (matching image analysis format for consistency)
    const responseData: any = {
      success: true,
      data: result,
      analysisType: "text",
      contextProvided: !!context,
      input: {
        foodName: foodName.trim(),
        quantity: quantity.trim(),
      },
      timestamp: new Date().toISOString(),
    };

    // Add context-specific metadata
    if (context && result.suggestion) {
      responseData.hasRecommendation = true;
      responseData.hasComplementaryFoods =
        !!result.suggestion.mealCompletionSuggestions?.length;
      responseData.recommendsEating = result.suggestion.shouldEat;
    } else {
      responseData.hasRecommendation = false;
      responseData.hasComplementaryFoods = false;
    }
    res.json(responseData);
  } catch (error: any) {
    // Handle specific error types
    if (error.message && error.message.includes("API key")) {
      res.status(503).json({
        success: false,
        error: "Service configuration error",
        details: "AI analysis service is temporarily unavailable",
      });
      return;
    }

    if (error.message && error.message.includes("rate limit")) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        details: "Please wait a moment before making another request",
      });
      return;
    }

    if (error.message && error.message.includes("timeout")) {
      res.status(504).json({
        success: false,
        error: "Analysis timeout",
        details:
          "The analysis took too long. Please try again with simpler input.",
      });
      return;
    }

    // Generic error response
    res.status(500).json({
      success: false,
      error: "Analysis failed",
      details: error.message || "Unknown error occurred during analysis",
    });
  }
};

interface MacroSuggestionRequest {
  userDetails: string;
  age: number;
}

export const suggestMacros = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      error: "Method not allowed",
      details: "Only POST requests are supported",
    });
    return;
  }

  try {
    const { userDetails, age } = req.body;
    // Validate required fields
    if (!userDetails || age === undefined || age === null) {
      res.status(400).json({
        success: false,
        error: "Missing required fields",
        details: "Both userDetails (string) and age (number) are required",
      });
      return;
    }

    // Track analysis time
    const analysisStartTime = Date.now();

    // Get macro suggestions from Groq AI
    const macroSuggestions = await suggestMacrosWithGroq(userDetails, age);

    const analysisEndTime = Date.now();
    const analysisDuration = analysisEndTime - analysisStartTime;

    // Build successful response
    const responseData = {
      success: true,
      data: {
        macros: {
          calories: macroSuggestions.calories,
          protein: macroSuggestions.protein,
          carbs: macroSuggestions.carbs,
          fat: macroSuggestions.fat,
        },
        explanation: macroSuggestions.explanation,
        breakdown: {
          proteinPercentage: Math.round(
            ((macroSuggestions.protein * 4) / macroSuggestions.calories) * 100,
          ),
          carbsPercentage: Math.round(
            ((macroSuggestions.carbs * 4) / macroSuggestions.calories) * 100,
          ),
          fatPercentage: Math.round(
            ((macroSuggestions.fat * 9) / macroSuggestions.calories) * 100,
          ),
        },
      },
      analysisType: "macro_suggestion",
      input: {
        userDetails: userDetails.trim(),
        age: age,
      },
      metadata: {
        analysisDuration: `${analysisDuration}ms`,
        timestamp: new Date().toISOString(),
        aiModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
      },
    };

    res.json(responseData);
  } catch (error: any) {
    console.error("Macro suggestion error:", error);

    // Handle specific error types
    if (error.message && error.message.includes("GROQ_API_KEY")) {
      res.status(503).json({
        success: false,
        error: "Service configuration error",
        details: "AI analysis service is not properly configured",
      });
      return;
    }

    if (error.message && error.message.includes("API key")) {
      res.status(503).json({
        success: false,
        error: "Service configuration error",
        details: "AI analysis service is temporarily unavailable",
      });
      return;
    }

    if (error.message && error.message.includes("rate limit")) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        details: "Please wait a moment before making another request",
      });
      return;
    }

    if (error.message && error.message.includes("timeout")) {
      res.status(504).json({
        success: false,
        error: "Analysis timeout",
        details: "The macro calculation took too long. Please try again.",
      });
      return;
    }

    if (error.message && error.message.includes("parse")) {
      res.status(422).json({
        success: false,
        error: "AI response parsing failed",
        details:
          "Unable to process the AI response. Please try again with different details.",
      });
      return;
    }

    if (
      (error.message && error.message.includes("network")) ||
      error.message.includes("fetch")
    ) {
      res.status(503).json({
        success: false,
        error: "Network error",
        details:
          "Unable to connect to AI service. Please check your connection and try again.",
      });
      return;
    }

    // Generic error response
    res.status(500).json({
      success: false,
      error: "Macro suggestion failed",
      details:
        error.message || "Unknown error occurred during macro calculation",
      timestamp: new Date().toISOString(),
    });
  }
};

// controllers/foodExtract.controller.ts
import { extractFoodNameQuantityFromPrompt } from "../services/food.service";
import { validateFoodImage, validateFoodTextInput } from "../utils/validator";

/**
 * Controller to extract food name and quantity from a natural language prompt
 */
export const extractFoodFromPrompt = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      error: "Method not allowed",
      details: "Only POST requests are supported",
    });
    return;
  }

  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: "Missing or invalid prompt",
        details: "A valid non-empty prompt string is required",
      });
      return;
    }

    const extraction = await extractFoodNameQuantityFromPrompt(prompt);
    if (
      !extraction ||
      (typeof extraction !== "object" && extraction !== undefined)
    ) {
      res.status(422).json({
        success: false,
        error: "Could not extract food name from prompt",
        input: prompt,
      });
      return;
    }

    if (extraction === undefined) {
      res.status(200).json({
        success: true,
        extracted: null,
        message: "Food name could not be confidently extracted from prompt",
        input: prompt,
      });
      return;
    }

    res.status(200).json({
      success: true,
      extracted: extraction,
      input: prompt,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Extraction failed",
      details: error.message || "Unknown server error",
    });
  }
};
