import Groq from "groq-sdk";
import type {
  FoodAnalysis,
  FoodAnalysisContext,
  MacroSuggestion,
  ExtractedFood,
} from "../types/food";
import { createGroqClient } from "../config/groq";
import {
  createFoodAnalysisPrompt,
  createFoodExtractionPrompt,
  createMacroSuggestionPrompt,
  createTextFoodAnalysisPrompt,
} from "../utils/templates";

import {
  fixMacrosInJsonString,
  repairJsonString,
  sanitizeNumericValue,
  urlToBase64,
} from "../utils/food";

export const parseFoodAnalysisResponseWithRetry = async (
  response: string,
  hasContext: boolean,
  maxRetries: number = 3,
  groqClient: Groq,
  analysisPrompt: string,
  base64Image?: string,
  isTextAnalysis: boolean = false,
  foodName?: string,
  quantity?: string,
): Promise<FoodAnalysis> => {
  const fixAndParseJson = (jsonStr: string): any => {
    // Apply math expression fixes
    let fixed = fixMacrosInJsonString(jsonStr);
    // Apply JSON repair
    fixed = repairJsonString(fixed);

    const jsonMatch = fixed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON structure found");
    }

    return JSON.parse(jsonMatch[0]);
  };

  // Try to parse the current response first
  for (let parseAttempt = 0; parseAttempt < maxRetries; parseAttempt++) {
    try {
      const parsed = fixAndParseJson(response);

      // Validate required structure
      if (!parsed.foodItems || !Array.isArray(parsed.foodItems)) {
        throw new Error("Invalid foodItems format");
      }

      if (!parsed.totalMacros || typeof parsed.totalMacros !== "object") {
        throw new Error("Invalid totalMacros format");
      }

      // Successfully parsed - build result
      const result: FoodAnalysis = {
        foodItems: parsed.foodItems.map((item: any) => ({
          name: item.name || "Unknown food",
          quantity: item.quantity || "Unknown quantity",
          macros: {
            calories: sanitizeNumericValue(item.macros?.calories || 0),
            protein: sanitizeNumericValue(item.macros?.protein || 0),
            carbs: sanitizeNumericValue(item.macros?.carbs || 0),
            fat: sanitizeNumericValue(item.macros?.fat || 0),
          },
        })),
        totalMacros: {
          calories: sanitizeNumericValue(parsed.totalMacros.calories || 0),
          protein: sanitizeNumericValue(parsed.totalMacros.protein || 0),
          carbs: sanitizeNumericValue(parsed.totalMacros.carbs || 0),
          fat: sanitizeNumericValue(parsed.totalMacros.fat || 0),
        },
      };

      // Add suggestion if context provided
      if (hasContext && parsed.suggestion) {
        result.suggestion = {
          shouldEat: Boolean(parsed.suggestion.shouldEat),
          reason: parsed.suggestion.reason || "No specific advice provided",
          recommendedQuantity: parsed.suggestion.recommendedQuantity,
          alternatives: Array.isArray(parsed.suggestion.alternatives)
            ? parsed.suggestion.alternatives
            : [],
        };

        if (
          parsed.suggestion.complementaryFoods &&
          Array.isArray(parsed.suggestion.complementaryFoods)
        ) {
          result.suggestion.mealCompletionSuggestions =
            parsed.suggestion.complementaryFoods.map((food: any) => ({
              name: food.name || "Unknown food",
              quantity: food.quantity || "Unknown quantity",
              macros: {
                calories: sanitizeNumericValue(food.macros?.calories || 0),
                protein: sanitizeNumericValue(food.macros?.protein || 0),
                carbs: sanitizeNumericValue(food.macros?.carbs || 0),
                fat: sanitizeNumericValue(food.macros?.fat || 0),
              },
              reason: food.reason || "Complements your meal",
            }));
        }

        if (parsed.suggestion.completeMealMacros) {
          result.suggestion.completeMealMacros = {
            calories: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.calories || 0,
            ),
            protein: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.protein || 0,
            ),
            carbs: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.carbs || 0,
            ),
            fat: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.fat || 0,
            ),
          };
        }
      }

      return result;
    } catch (parseError) {
      console.warn(`Parse attempt ${parseAttempt + 1} failed:`, parseError);

      // If this was the last parse attempt, try to get a new response from Groq
      if (parseAttempt === maxRetries - 1) {
        break;
      }

      // Try basic string repairs for next attempt
      response = repairJsonString(response);
    }
  }

  // If parsing failed, retry with new Groq calls
  for (let retryAttempt = 0; retryAttempt < maxRetries; retryAttempt++) {
    try {
      const retryPrompt =
        analysisPrompt +
        `

**IMPORTANT**: The previous response had JSON formatting issues. Please ensure your response:
1. Contains ONLY valid JSON with no text before or after
2. Uses calculated numbers, never mathematical expressions like "1+2"
3. All macro values must be plain numbers (e.g., 3.04, not 1.01+2.03)
4. No trailing commas in objects or arrays
5. All keys are properly quoted
6. Return only the JSON object, nothing else

CRITICAL: Calculate all mathematical expressions before including them in the JSON.`;

      let completion;
      if (isTextAnalysis && foodName && quantity) {
        // Text-based retry
        completion = await groqClient.chat.completions.create({
          model: "meta-llama/llama-4-maverick-17b-128e-instruct",
          messages: [
            {
              role: "user",
              content: `${retryPrompt}

**Food**: ${foodName}
**Quantity**: ${quantity}`,
            },
          ],
          temperature: 0.1, // Lower temperature for more consistent output
          max_tokens: 3000,
        });
      } else {
        // Image-based retry
        if (!base64Image) {
          throw new Error("Base64 image required for image analysis retry");
        }

        completion = await groqClient.chat.completions.create({
          model: "meta-llama/llama-4-maverick-17b-128e-instruct",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: retryPrompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: base64Image,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 3000,
        });
      }

      const newResponse = completion.choices[0]?.message?.content || "";

      // Try to parse the new response
      const parsed = fixAndParseJson(newResponse);

      // Validate and build result (same validation logic as above)
      if (!parsed.foodItems || !Array.isArray(parsed.foodItems)) {
        throw new Error("Invalid foodItems format in retry response");
      }

      if (!parsed.totalMacros || typeof parsed.totalMacros !== "object") {
        throw new Error("Invalid totalMacros format in retry response");
      }

      // Build successful result
      const result: FoodAnalysis = {
        foodItems: parsed.foodItems.map((item: any) => ({
          name: item.name || "Unknown food",
          quantity: item.quantity || "Unknown quantity",
          macros: {
            calories: sanitizeNumericValue(item.macros?.calories || 0),
            protein: sanitizeNumericValue(item.macros?.protein || 0),
            carbs: sanitizeNumericValue(item.macros?.carbs || 0),
            fat: sanitizeNumericValue(item.macros?.fat || 0),
          },
        })),
        totalMacros: {
          calories: sanitizeNumericValue(parsed.totalMacros.calories || 0),
          protein: sanitizeNumericValue(parsed.totalMacros.protein || 0),
          carbs: sanitizeNumericValue(parsed.totalMacros.carbs || 0),
          fat: sanitizeNumericValue(parsed.totalMacros.fat || 0),
        },
      };

      // Add suggestions if context provided (same logic as above)
      if (hasContext && parsed.suggestion) {
        result.suggestion = {
          shouldEat: Boolean(parsed.suggestion.shouldEat),
          reason: parsed.suggestion.reason || "No specific advice provided",
          recommendedQuantity: parsed.suggestion.recommendedQuantity,
          alternatives: Array.isArray(parsed.suggestion.alternatives)
            ? parsed.suggestion.alternatives
            : [],
        };

        if (
          parsed.suggestion.complementaryFoods &&
          Array.isArray(parsed.suggestion.complementaryFoods)
        ) {
          result.suggestion.mealCompletionSuggestions =
            parsed.suggestion.complementaryFoods.map((food: any) => ({
              name: food.name || "Unknown food",
              quantity: food.quantity || "Unknown quantity",
              macros: {
                calories: sanitizeNumericValue(food.macros?.calories || 0),
                protein: sanitizeNumericValue(food.macros?.protein || 0),
                carbs: sanitizeNumericValue(food.macros?.carbs || 0),
                fat: sanitizeNumericValue(food.macros?.fat || 0),
              },
              reason: food.reason || "Complements your meal",
            }));
        }

        if (parsed.suggestion.completeMealMacros) {
          result.suggestion.completeMealMacros = {
            calories: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.calories || 0,
            ),
            protein: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.protein || 0,
            ),
            carbs: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.carbs || 0,
            ),
            fat: sanitizeNumericValue(
              parsed.suggestion.completeMealMacros.fat || 0,
            ),
          };
        }
      }

      return result;
    } catch (retryError) {
      console.error(`Retry attempt ${retryAttempt + 1} failed:`, retryError);

      // If this was the last retry, fall through to fallback
      if (retryAttempt === maxRetries - 1) {
        console.error("All retry attempts failed, returning fallback response");
        break;
      }

      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Fallback response if all retries failed
  console.error("All parsing and retry attempts failed, returning fallback");
  return {
    foodItems: [
      {
        name: "Analysis failed",
        quantity: "Unknown",
        macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      },
    ],
    totalMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    suggestion: hasContext
      ? {
          shouldEat: false,
          reason:
            "I couldn't analyze this properly after multiple attempts. Could you try uploading a clearer image or entering the food details manually?",
          alternatives: [
            "Try uploading a clearer image",
            "Enter the food details manually",
            "Contact support if this issue persists",
          ],
        }
      : undefined,
  };
};

export const convertNutritionLabelToFoodAnalysis = (
  labelData: any,
  context?: FoodAnalysisContext,
): FoodAnalysis => {
  const nutritionalInfo = labelData.nutritionalInfo || {};

  // Create more descriptive food name
  const productName = labelData.productName || "Product";
  const servingSize = labelData.servingSize || "1 serving";
  const foodName =
    productName !== "Product"
      ? `${productName} (${servingSize})`
      : `Product (${servingSize})`;

  // Enhanced macro calculation with better fallbacks
  const calories = sanitizeNumericValue(nutritionalInfo.calories || 0);
  const protein = sanitizeNumericValue(nutritionalInfo.protein || 0);
  const carbs = sanitizeNumericValue(nutritionalInfo.totalCarbs || 0);
  const fat = sanitizeNumericValue(nutritionalInfo.fat || 0);

  const result: FoodAnalysis = {
    foodItems: [
      {
        name: foodName,
        quantity: servingSize,
        macros: { calories, protein, carbs, fat },
      },
    ],
    totalMacros: { calories, protein, carbs, fat },
  };

  // Enhanced contextual suggestions
  if (context) {
    const remaining = {
      calories: Math.max(
        0,
        context.totalMacros.calories - context.consumedMacros.calories,
      ),
      protein: Math.max(
        0,
        context.totalMacros.protein - context.consumedMacros.protein,
      ),
      carbs: Math.max(
        0,
        context.totalMacros.carbs - context.consumedMacros.carbs,
      ),
      fat: Math.max(0, context.totalMacros.fat - context.consumedMacros.fat),
    };

    const fitsCalories = calories <= remaining.calories;
    const portionAdvice = fitsCalories
      ? "full serving"
      : `${Math.round((remaining.calories / calories) * 100)}% of the serving`;

    result.suggestion = {
      shouldEat: fitsCalories && calories > 0,
      reason: fitsCalories
        ? `Perfect! This ${servingSize} fits within your remaining ${remaining.calories} calories. It provides ${protein}g protein, ${carbs}g carbs, and ${fat}g fat.`
        : `This serving has ${calories} calories, which exceeds your remaining ${remaining.calories} calories. Consider having ${portionAdvice} instead.`,
      recommendedQuantity: portionAdvice,
      alternatives: fitsCalories
        ? []
        : [
            `Have ${portionAdvice} of the serving`,
            "Save some for tomorrow",
            "Pair with lighter foods today",
          ],
    };

    // Smart meal completion based on missing macros
    const suggestions = [];
    if (remaining.protein > protein + 15) {
      suggestions.push({
        name: "Greek yogurt",
        quantity: "1 cup",
        macros: { calories: 100, protein: 17, carbs: 6, fat: 0 },
        reason: "Boost protein to reach your daily target",
      });
    }

    if (remaining.carbs > carbs + 20 && remaining.calories > 150) {
      suggestions.push({
        name: "Brown rice",
        quantity: "1/2 cup cooked",
        macros: { calories: 110, protein: 3, carbs: 23, fat: 1 },
        reason: "Add healthy carbs for energy",
      });
    }

    if (suggestions.length > 0) {
      result.suggestion.mealCompletionSuggestions = suggestions;
      const totalAddedCalories = suggestions.reduce(
        (sum, item) => sum + item.macros.calories,
        0,
      );
      const totalAddedProtein = suggestions.reduce(
        (sum, item) => sum + item.macros.protein,
        0,
      );
      const totalAddedCarbs = suggestions.reduce(
        (sum, item) => sum + item.macros.carbs,
        0,
      );
      const totalAddedFat = suggestions.reduce(
        (sum, item) => sum + item.macros.fat,
        0,
      );

      result.suggestion.completeMealMacros = {
        calories: calories + totalAddedCalories,
        protein: protein + totalAddedProtein,
        carbs: carbs + totalAddedCarbs,
        fat: fat + totalAddedFat,
      };
    }
  }

  return result;
};

export const suggestMacrosWithGroq = async (
  userDetailsString: string,
  age: number,
  maxRetries: number = 3,
): Promise<MacroSuggestion> => {
  const groqClient = createGroqClient();
  const macroPrompt = createMacroSuggestionPrompt(userDetailsString, age);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: "meta-llama/llama-4-maverick-17b-128e-instruct",
        messages: [
          {
            role: "user",
            content: macroPrompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistent, accurate calculations
        max_tokens: 1000,
      });

      const response = completion.choices[0]?.message?.content || "";

      // Fix any mathematical expressions before parsing
      const fixedResponse = fixMacrosInJsonString(response);
      const repairedResponse = repairJsonString(fixedResponse);

      // Extract JSON from response
      const jsonMatch = repairedResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        return {
          calories: sanitizeNumericValue(parsed.calories || 2000),
          protein: sanitizeNumericValue(parsed.protein || 150),
          carbs: sanitizeNumericValue(parsed.carbs || 250),
          fat: sanitizeNumericValue(parsed.fat || 60),
          explanation:
            parsed.explanation || "Macro suggestions based on your profile",
        };
      }

      throw new Error("Unable to parse macro suggestions from response");
    } catch (error: any) {
      console.error(`Macro suggestion attempt ${attempt + 1} failed:`, error);

      if (attempt === maxRetries - 1) {
        throw new Error(
          `Failed to get macro suggestions after ${maxRetries} attempts: ${error.message}`,
        );
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  throw new Error(
    `Failed to get macro suggestions after ${maxRetries} attempts`,
  );
};

export const parseUserDetailsString = (
  userDetailsString: string,
): Record<string, string> => {
  const details: Record<string, string> = {};

  // Simple parsing logic - you can enhance this based on your string format
  const pairs = userDetailsString.split(",").map((pair) => pair.trim());

  pairs.forEach((pair) => {
    const [key, value] = pair.split(":").map((item) => item.trim());
    if (key && value) {
      details[key.toLowerCase()] = value;
    }
  });

  return details;
};

export const extractFoodNameQuantityFromPrompt = async (
  prompt: string,
  maxRetries: number = 3,
): Promise<ExtractedFood | undefined> => {
  try {
    const groq = createGroqClient();
    const extractionPrompt = createFoodExtractionPrompt(prompt);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const completion = await groq.chat.completions.create({
          model: "meta-llama/llama-4-maverick-17b-128e-instruct",
          messages: [
            {
              role: "user",
              content: extractionPrompt,
            },
          ],
          temperature: 0.1, // Low temperature for consistent parsing
          max_tokens: 200,
          response_format: { type: "json_object" }, // Ensure JSON response
        });

        const response = completion.choices[0]?.message?.content || "";

        // Parse the JSON response
        const parsed = JSON.parse(response);

        // Handle undefined case
        if (parsed.undefined === true) {
          return undefined;
        }

        // Validate required name field
        if (!parsed.name || typeof parsed.name !== "string") {
          throw new Error("Invalid or missing name field");
        }

        // Build result object
        const result: ExtractedFood = {
          name: parsed.name.trim(),
        };

        // Add quantity if present and valid
        if (
          parsed.quantity &&
          typeof parsed.quantity === "string" &&
          parsed.quantity.trim().length > 0
        ) {
          result.quantity = parsed.quantity.trim();
        }

        return result;
      } catch (error: any) {
        console.error(`Food extraction attempt ${attempt + 1} failed:`, error);

        if (attempt === maxRetries - 1) {
          console.error("All extraction attempts failed, returning undefined");
          return undefined;
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return undefined;
  } catch (error: any) {
    console.error("Food name/quantity extraction failed:", error);
    return undefined;
  }
};

export const analyzeFoodFromImage = async (
  imageUrl: string,
  context?: FoodAnalysisContext,
): Promise<FoodAnalysis> => {
  try {
    console.log("Regular food image detected, proceeding with visual analysis");

    const groq = createGroqClient();
    const analysisPrompt = createFoodAnalysisPrompt(context);

    const base64Image = await urlToBase64(imageUrl);

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-maverick-17b-128e-instruct",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: analysisPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: base64Image,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const response = completion.choices[0]?.message?.content || "";

    return await parseFoodAnalysisResponseWithRetry(
      response,
      !!context,
      3, // maxRetries
      groq,
      analysisPrompt,
      base64Image,
      false, // isTextAnalysis
    );
  } catch (error: any) {
    console.error("Food analysis failed:", error);
    throw new Error(`Food analysis failed: ${error.message}`);
  }
};

export const analyzeFoodFromText = async (
  foodName: string,
  quantity: string,
  context?: FoodAnalysisContext,
): Promise<FoodAnalysis> => {
  try {
    const groq = createGroqClient();
    const textAnalysisPrompt = createTextFoodAnalysisPrompt(
      foodName,
      quantity,
      context,
    );

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-maverick-17b-128e-instruct",
      messages: [
        {
          role: "user",
          content: textAnalysisPrompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const response = completion.choices[0]?.message?.content || "";

    return await parseFoodAnalysisResponseWithRetry(
      response,
      !!context,
      3, // maxRetries
      groq,
      textAnalysisPrompt,
      undefined, // no base64Image for text analysis
      true, // isTextAnalysis
      foodName,
      quantity,
    );
  } catch (error: any) {
    console.error("Text food analysis failed:", error);
    throw new Error(`Text food analysis failed: ${error.message}`);
  }
};
