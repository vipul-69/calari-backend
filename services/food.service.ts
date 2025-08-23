/* eslint-disable @typescript-eslint/no-explicit-any */
// services/foodAnalysis.ts
import Groq from 'groq-sdk';
import { type FoodAnalysis } from "../types";
import { config } from 'dotenv';

config();

interface FoodAnalysisContext {
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
}

/**
 * Initialize Groq client
 */
const createGroqClient = (): Groq => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY environment variable is required");
  }

  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
};

/**
 * Enhanced URL to base64 conversion
 */
const urlToBase64 = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    
    return `data:${contentType};base64,${base64}`;
  } catch (error: any) {
    throw new Error(`Failed to convert URL to base64: ${error.message}`);
  }
};

/**
 * Enhanced mathematical expressions fixing with better regex patterns
 */
const fixMacrosInJsonString = (jsonStr: string): string => {
  // Handle addition: 1.01+2.03 → 3.04
  let fixed = jsonStr.replace(/(\d+\.?\d*)\+(\d+\.?\d*)/g, (_, num1, num2) => {
    const sum = parseFloat(num1) + parseFloat(num2);
    return sum.toFixed(2);
  });
  
  // Handle subtraction: 5.5-1.2 → 4.30
  fixed = fixed.replace(/(\d+\.?\d*)-(\d+\.?\d*)/g, (_, num1, num2) => {
    const diff = parseFloat(num1) - parseFloat(num2);
    return Math.max(0, diff).toFixed(2); // Ensure non-negative for nutrition values
  });
  
  // Handle multiplication: 2*3.5 → 7.00
  fixed = fixed.replace(/(\d+\.?\d*)\*(\d+\.?\d*)/g, (_, num1, num2) => {
    const product = parseFloat(num1) * parseFloat(num2);
    return product.toFixed(2);
  });
  
  // Handle division: 10/2 → 5.00
  fixed = fixed.replace(/(\d+\.?\d*)\/(\d+\.?\d*)/g, (_, num1, num2) => {
    const divisor = parseFloat(num2);
    if (divisor === 0) return "0.00";
    const quotient = parseFloat(num1) / divisor;
    return quotient.toFixed(2);
  });
  
  return fixed;
};

/**
 * Enhanced JSON string repair function
 */
const repairJsonString = (jsonStr: string): string => {
  let repaired = jsonStr;
  
  // Remove trailing commas before closing brackets
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  
  // Remove control characters
  repaired = repaired.replace(/[\x00-\x1f]+/g, '');
  
  // Quote unquoted keys (basic implementation)
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  
  // Fix common string escaping issues
  repaired = repaired.replace(/\\'/g, "'");
  
  // Remove any extra text before the first { or after the last }
  const match = repaired.match(/\{[\s\S]*\}/);
  if (match) {
    repaired = match[0];
  }
  
  return repaired;
};

/**
 * Validate and clean numeric values in parsed JSON
 */
const sanitizeNumericValue = (value: any): number => {
  if (typeof value === 'string') {
    // Remove any remaining non-numeric characters except decimal point
    const cleaned = value.replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.max(0, num); // Ensure non-negative
  }
  const num = Number(value);
  return isNaN(num) ? 0 : Math.max(0, num);
};

/**
 * Check if image contains food using Groq SDK with retry logic
 */
export const validateFoodImage = async (imageUrl: string, maxRetries: number = 3): Promise<{ isFood: boolean; reason: string }> => {
  const groq = createGroqClient();
  
  const validationPrompt = `
You're a nutrition assistant helping someone track their food. Look at this image and determine if it contains actual food that can be eaten.

## Your Task
Tell me whether this image shows food or not, and briefly explain what you see.

## Response Format
Give me a JSON response like this:
{
  "containsFood": true/false,
  "reason": "what you see in the image"
}

## What Counts as Food
✓ Prepared meals, snacks, fruits, vegetables, beverages, desserts
✓ Ready-to-eat items like sandwiches, salads, cooked dishes
✓ Raw foods commonly eaten as-is (apples, carrots, nuts)

## What Doesn't Count
✗ Empty plates, cooking utensils, kitchen equipment
✗ People, pets, or non-food objects
✗ Raw ingredients that need cooking (raw meat, flour, etc.)
✗ Food packaging or wrappers without visible food

## CRITICAL RULES
- Return ONLY valid JSON with the exact format shown above
- No additional text, explanations, or formatting
- Use only boolean values (true/false), not strings

Be helpful but accurate - I'm counting on you to identify real food items correctly!`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      
      // Convert URL to base64
      const base64Image = await urlToBase64(imageUrl);

      // Make the API call with proper multimodal format
      const completion = await groq.chat.completions.create({
        model: "meta-llama/llama-4-maverick-17b-128e-instruct",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: validationPrompt,
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
        max_tokens: 1000,
      });

      const response = completion.choices[0]?.message?.content || "";
      
      // Fix any mathematical expressions and repair JSON
      const fixedResponse = fixMacrosInJsonString(response);
      const repairedResponse = repairJsonString(fixedResponse);
      
      const jsonMatch = repairedResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isFood: parsed.containsFood === true,
          reason: parsed.reason || "No reason provided"
        };
      }
      
      throw new Error("No valid JSON found in response");
      
    } catch (error: any) {
      console.error(`Food validation attempt ${attempt + 1} failed:`, error);
      
      if (attempt === maxRetries - 1) {
        return {
          isFood: false,
          reason: `Error occurred during food validation after ${maxRetries} attempts: ${error.message}`
        };
      }
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return {
    isFood: false,
    reason: "Unable to analyze image content after multiple attempts"
  };
};

/**
 * Create structured prompt for food analysis with conversational recommendations
 */
const createFoodAnalysisPrompt = (context?: FoodAnalysisContext): string => {
  let prompt = `
You're a personal nutrition coach helping someone track their food and make better eating decisions. Analyze this food image with accuracy and provide helpful, conversational advice.

## Your Mission
1. Identify all food items in the image with precise portions
2. Calculate accurate nutritional values using USDA standards
3. ${context ? 'Give personalized recommendations based on their daily goals and current intake' : 'Focus purely on nutritional analysis'}

## Response Format (Must be valid JSON)
{
  "foodItems": [
    {
      "name": "specific food name",
      "quantity": "realistic portion with units (e.g., '1 medium banana', '150g grilled chicken')",
      "macros": {
        "calories": number,
        "protein": number,
        "carbs": number,
        "fat": number
      }
    }
  ],
  "totalMacros": {
    "calories": total_calories_number,
    "protein": total_protein_grams,
    "carbs": total_carbs_grams,
    "fat": total_fat_grams
  }`;

  if (context) {
    prompt += `,
  "suggestion": {
    "shouldEat": boolean,
    "reason": "conversational advice as if you're talking to them personally",
    "recommendedQuantity": "portion suggestion that fits their goals",
    "alternatives": ["better food options if not recommended"],
    "complementaryFoods": [
      {
        "name": "food that pairs well",
        "quantity": "suggested serving size",
        "macros": {
          "calories": number,
          "protein": number,
          "carbs": number,
          "fat": number
        },
        "reason": "why this addition makes sense"
      }
    ],
    "completeMealMacros": {
      "calories": total_with_additions,
      "protein": total_with_additions,
      "carbs": total_with_additions,
      "fat": total_with_additions
    }
  }`;
  }

  prompt += `
}

## Critical Requirements
- Use PRECISE USDA nutritional values - accuracy is essential
- Estimate portions realistically based on visual cues
- **ALL MACRO VALUES MUST BE PLAIN NUMBERS - NEVER use mathematical expressions like "1+2" or "5.5-1.2"**
- **Calculate all values and return final numbers only (e.g., use 3.04, not 1.01+2.03)**
- Must return valid, parseable JSON with no extra text
- No text before or after the JSON structure
- Use only numeric values for macros, never strings or expressions
- No trailing commas in JSON objects or arrays`;

  if (context) {
    const remaining = {
      calories: Math.max(0, context.totalMacros.calories - context.consumedMacros.calories),
      protein: Math.max(0, context.totalMacros.protein - context.consumedMacros.protein),
      carbs: Math.max(0, context.totalMacros.carbs - context.consumedMacros.carbs),
      fat: Math.max(0, context.totalMacros.fat - context.consumedMacros.fat),
    };

    const consumedPercentages = {
      calories: Math.round((context.consumedMacros.calories / context.totalMacros.calories) * 100),
      protein: Math.round((context.consumedMacros.protein / context.totalMacros.protein) * 100),
      carbs: Math.round((context.consumedMacros.carbs / context.totalMacros.carbs) * 100),
      fat: Math.round((context.consumedMacros.fat / context.totalMacros.fat) * 100),
    };

    prompt += `

## Personal Context - Help Them Reach Their Goals
**User Profile**: ${context.userInfo}

**Today's Progress So Far:**
- Calories: ${context.consumedMacros.calories}/${context.totalMacros.calories} (${consumedPercentages.calories}% of daily goal)
- Protein: ${context.consumedMacros.protein}g/${context.totalMacros.protein}g (${consumedPercentages.protein}% of daily goal)
- Carbs: ${context.consumedMacros.carbs}g/${context.totalMacros.carbs}g (${consumedPercentages.carbs}% of daily goal)
- Fat: ${context.consumedMacros.fat}g/${context.totalMacros.fat}g (${consumedPercentages.fat}% of daily goal)

**What They Still Need Today:**
- ${remaining.calories} calories
- ${remaining.protein}g protein
- ${remaining.carbs}g carbs
- ${remaining.fat}g fat

## Your Coaching Instructions
1. **Assess if this food fits their remaining macro budget**
   - If it puts them over, suggest a smaller portion or better timing
   - If they're low on certain macros, highlight how this food helps
   
2. **Speak like a knowledgeable friend, not a robot**
   - "This looks great! The protein will help you hit your target."
   - "Hmm, this might push you over on calories, but you could have a smaller portion."
   - "Perfect timing - you're still low on carbs and this will help fuel your workout."

3. **Suggest 3-4 complementary foods that make sense**
   - Fill macro gaps (if low on protein, suggest protein-rich additions)
   - Create balanced meals (if they're eating just carbs, suggest protein + fat)
   - Consider what actually pairs well together
   - Focus on whole, nutritious foods

4. **Give specific, actionable portion advice**
   - "Try having about half of what's shown to stay on track"
   - "This portion size looks perfect for your remaining calories"
   - "You could easily fit the full serving and still have room for dinner"

5. **Calculate complete meal macros** including your suggested additions

Remember: Be encouraging, practical, and focus on helping them succeed with their goals!`;
  }

  return prompt;
};

/**
 * Enhanced text-based food analysis prompt creation
 */
const createTextFoodAnalysisPrompt = (foodName: string, quantity: string, context?: FoodAnalysisContext): string => {
  let textAnalysisPrompt = `
You're a personal nutrition coach helping someone track their food. They've told you about "${foodName}" in the quantity "${quantity}". Give them accurate nutritional info and helpful advice.

## Your Task
1. Calculate precise nutritional values for this food
2. ${context ? 'Provide personalized recommendations based on their daily goals' : 'Focus on nutritional analysis only'}

## Food Details
- **Food**: ${foodName}
- **Quantity**: ${quantity}

## Response Format (Must be valid JSON)
{
  "foodItems": [
    {
      "name": "normalized food name",
      "quantity": "standardized portion with clear units",
      "macros": {
        "calories": number,
        "protein": number,
        "carbs": number,
        "fat": number
      }
    }
  ],
  "totalMacros": {
    "calories": total_number,
    "protein": total_grams,
    "carbs": total_grams,
    "fat": total_grams
  }`;

  if (context) {
    textAnalysisPrompt += `,
  "suggestion": {
    "shouldEat": boolean,
    "reason": "friendly, conversational advice tailored to their goals",
    "recommendedQuantity": "portion suggestion that fits their remaining macros",
    "alternatives": ["better options if this doesn't fit their goals"],
    "complementaryFoods": [
      {
        "name": "food that pairs well and fills macro gaps",
        "quantity": "realistic serving size",
        "macros": {
          "calories": number,
          "protein": number,
          "carbs": number,
          "fat": number
        },
        "reason": "why this addition makes nutritional sense"
      }
    ],
    "completeMealMacros": {
      "calories": total_with_additions,
      "protein": total_with_additions,
      "carbs": total_with_additions,
      "fat": total_with_additions
    }
  }`;
  }

  textAnalysisPrompt += `
}

## Quality Standards
- Use USDA nutrition database accuracy
- If quantity is vague, make reasonable assumptions and mention them
- Handle food variations intelligently (e.g., "chicken" → assume grilled breast)
- **ALL MACRO VALUES MUST BE CALCULATED NUMBERS - NEVER use expressions like "1+2" or "5.5-1.2"**
- **Return final computed values only (e.g., use 3.04, not 1.01+2.03)**
- All numerical values must be numbers, not strings
- Return only valid JSON with no extra text
- No trailing commas in JSON objects or arrays`;

  if (context) {
    const remaining = {
      calories: Math.max(0, context.totalMacros.calories - context.consumedMacros.calories),
      protein: Math.max(0, context.totalMacros.protein - context.consumedMacros.protein),
      carbs: Math.max(0, context.totalMacros.carbs - context.consumedMacros.carbs),
      fat: Math.max(0, context.totalMacros.fat - context.consumedMacros.fat),
    };

    const consumedPercentages = {
      calories: Math.round((context.consumedMacros.calories / context.totalMacros.calories) * 100),
      protein: Math.round((context.consumedMacros.protein / context.totalMacros.protein) * 100),
      carbs: Math.round((context.consumedMacros.carbs / context.totalMacros.carbs) * 100),
      fat: Math.round((context.consumedMacros.fat / context.totalMacros.fat) * 100),
    };

    textAnalysisPrompt += `

## Personal Nutrition Context
**User**: ${context.userInfo}

**Today's Progress:**
- Calories: ${context.consumedMacros.calories}/${context.totalMacros.calories} (${consumedPercentages.calories}% complete)
- Protein: ${context.consumedMacros.protein}g/${context.totalMacros.protein}g (${consumedPercentages.protein}% complete)
- Carbs: ${context.consumedMacros.carbs}g/${context.totalMacros.carbs}g (${consumedPercentages.carbs}% complete)
- Fat: ${context.consumedMacros.fat}g/${context.totalMacros.fat}g (${consumedPercentages.fat}% complete)

**Remaining Budget:**
- ${remaining.calories} calories left
- ${remaining.protein}g protein needed
- ${remaining.carbs}g carbs available
- ${remaining.fat}g fat remaining

## Coaching Guidelines
1. **Check if this food fits their remaining macros**
   - Recommend appropriate portions to stay on track
   - If it exceeds their budget, suggest modifications or timing

2. **Use encouraging, conversational language**
   - "Great choice! This fits perfectly with your goals."
   - "This might be a bit much for your remaining calories, but you could have a smaller portion."
   - "Perfect - you're low on protein and this will help!"

3. **Suggest 3-4 smart food additions that:**
   - Fill gaps in their remaining macros
   - Create a more balanced meal
   - Actually pair well with their chosen food
   - Use whole, nutritious options

4. **Calculate complete meal totals** including your suggestions

Be helpful, specific, and focused on their success!`;
  }

  return textAnalysisPrompt;
};

/**
 * Enhanced JSON parsing with comprehensive retry mechanism
 */
const parseFoodAnalysisResponseWithRetry = async (
  response: string,
  hasContext: boolean,
  maxRetries: number = 3,
  groqClient: Groq,
  analysisPrompt: string,
  base64Image?: string,
  isTextAnalysis: boolean = false,
  foodName?: string,
  quantity?: string
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
      
      if (!parsed.totalMacros || typeof parsed.totalMacros !== 'object') {
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
            fat: sanitizeNumericValue(item.macros?.fat || 0)
          }
        })),
        totalMacros: {
          calories: sanitizeNumericValue(parsed.totalMacros.calories || 0),
          protein: sanitizeNumericValue(parsed.totalMacros.protein || 0),
          carbs: sanitizeNumericValue(parsed.totalMacros.carbs || 0),
          fat: sanitizeNumericValue(parsed.totalMacros.fat || 0)
        }
      };

      // Add suggestion if context provided
      if (hasContext && parsed.suggestion) {
        result.suggestion = {
          shouldEat: Boolean(parsed.suggestion.shouldEat),
          reason: parsed.suggestion.reason || "No specific advice provided",
          recommendedQuantity: parsed.suggestion.recommendedQuantity,
          alternatives: Array.isArray(parsed.suggestion.alternatives) 
            ? parsed.suggestion.alternatives 
            : []
        };

        if (parsed.suggestion.complementaryFoods && Array.isArray(parsed.suggestion.complementaryFoods)) {
          result.suggestion.mealCompletionSuggestions = parsed.suggestion.complementaryFoods.map((food: any) => ({
            name: food.name || "Unknown food",
            quantity: food.quantity || "Unknown quantity",
            macros: {
              calories: sanitizeNumericValue(food.macros?.calories || 0),
              protein: sanitizeNumericValue(food.macros?.protein || 0),
              carbs: sanitizeNumericValue(food.macros?.carbs || 0),
              fat: sanitizeNumericValue(food.macros?.fat || 0)
            },
            reason: food.reason || "Complements your meal"
          }));
        }

        if (parsed.suggestion.completeMealMacros) {
          result.suggestion.completeMealMacros = {
            calories: sanitizeNumericValue(parsed.suggestion.completeMealMacros.calories || 0),
            protein: sanitizeNumericValue(parsed.suggestion.completeMealMacros.protein || 0),
            carbs: sanitizeNumericValue(parsed.suggestion.completeMealMacros.carbs || 0),
            fat: sanitizeNumericValue(parsed.suggestion.completeMealMacros.fat || 0)
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
      
      const retryPrompt = analysisPrompt + `

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
      
      if (!parsed.totalMacros || typeof parsed.totalMacros !== 'object') {
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
            fat: sanitizeNumericValue(item.macros?.fat || 0)
          }
        })),
        totalMacros: {
          calories: sanitizeNumericValue(parsed.totalMacros.calories || 0),
          protein: sanitizeNumericValue(parsed.totalMacros.protein || 0),
          carbs: sanitizeNumericValue(parsed.totalMacros.carbs || 0),
          fat: sanitizeNumericValue(parsed.totalMacros.fat || 0)
        }
      };

      // Add suggestions if context provided (same logic as above)
      if (hasContext && parsed.suggestion) {
        result.suggestion = {
          shouldEat: Boolean(parsed.suggestion.shouldEat),
          reason: parsed.suggestion.reason || "No specific advice provided",
          recommendedQuantity: parsed.suggestion.recommendedQuantity,
          alternatives: Array.isArray(parsed.suggestion.alternatives) 
            ? parsed.suggestion.alternatives 
            : []
        };

        if (parsed.suggestion.complementaryFoods && Array.isArray(parsed.suggestion.complementaryFoods)) {
          result.suggestion.mealCompletionSuggestions = parsed.suggestion.complementaryFoods.map((food: any) => ({
            name: food.name || "Unknown food",
            quantity: food.quantity || "Unknown quantity",
            macros: {
              calories: sanitizeNumericValue(food.macros?.calories || 0),
              protein: sanitizeNumericValue(food.macros?.protein || 0),
              carbs: sanitizeNumericValue(food.macros?.carbs || 0),
              fat: sanitizeNumericValue(food.macros?.fat || 0)
            },
            reason: food.reason || "Complements your meal"
          }));
        }

        if (parsed.suggestion.completeMealMacros) {
          result.suggestion.completeMealMacros = {
            calories: sanitizeNumericValue(parsed.suggestion.completeMealMacros.calories || 0),
            protein: sanitizeNumericValue(parsed.suggestion.completeMealMacros.protein || 0),
            carbs: sanitizeNumericValue(parsed.suggestion.completeMealMacros.carbs || 0),
            fat: sanitizeNumericValue(parsed.suggestion.completeMealMacros.fat || 0)
          };
        }
      }

      return result;
      
    } catch (retryError) {
      console.error(`Retry attempt ${retryAttempt + 1} failed:`, retryError);
      
      // If this was the last retry, fall through to fallback
      if (retryAttempt === maxRetries - 1) {
        console.error('All retry attempts failed, returning fallback response');
        break;
      }
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Fallback response if all retries failed
  console.error("All parsing and retry attempts failed, returning fallback");
  return {
    foodItems: [
      {
        name: "Analysis failed",
        quantity: "Unknown",
        macros: { calories: 0, protein: 0, carbs: 0, fat: 0 }
      }
    ],
    totalMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    suggestion: hasContext ? {
      shouldEat: false,
      reason: "I couldn't analyze this properly after multiple attempts. Could you try uploading a clearer image or entering the food details manually?",
      alternatives: ["Try uploading a clearer image", "Enter the food details manually", "Contact support if this issue persists"]
    } : undefined
  };
};

/**
 * Main food analysis function using Groq SDK with enhanced retry logic
 */
export const analyzeFoodFromImage = async (
  imageUrl: string,
  context?: FoodAnalysisContext
): Promise<FoodAnalysis> => {
  try {
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
      false // isTextAnalysis
    );
    
  } catch (error: any) {
    console.error('Food analysis failed:', error);
    throw new Error(`Food analysis failed: ${error.message}`);
  }
};

/**
 * Enhanced text-based food analysis with conversational recommendations and retry logic
 */
export const analyzeFoodFromText = async (
  foodName: string,
  quantity: string,
  context?: FoodAnalysisContext
): Promise<FoodAnalysis> => {
  try {
    const groq = createGroqClient();
    const textAnalysisPrompt = createTextFoodAnalysisPrompt(foodName, quantity, context);
    

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
      quantity
    );
    
  } catch (error: any) {
    console.error('Text food analysis failed:', error);
    throw new Error(`Text food analysis failed: ${error.message}`);
  }
};

/**
 * Validate food name and quantity input
 */
export const validateFoodTextInput = (foodName: string, quantity: string): { isValid: boolean; error?: string } => {
  // Check if food name is provided
  if (!foodName || foodName.trim().length === 0) {
    return { isValid: false, error: "Please tell me what food you're eating" };
  }

  // Check if quantity is provided
  if (!quantity || quantity.trim().length === 0) {
    return { isValid: false, error: "Please specify how much you're having" };
  }

  // Check minimum length
  if (foodName.trim().length < 2) {
    return { isValid: false, error: "Food name needs to be at least 2 characters" };
  }

  // Check for potentially problematic inputs
  const problematicPatterns = [
    /^\d+$/, // Only numbers
    /^[^a-zA-Z]+$/, // No letters at all
  ];

  if (problematicPatterns.some(pattern => pattern.test(foodName.trim()))) {
    return { isValid: false, error: "Please provide a valid food name with letters" };
  }

  return { isValid: true };
};

/**
 * Suggest daily macronutrients using Groq SDK based on user details string and age with retry logic
 */
export const suggestMacrosWithGroq = async (
  userDetailsString: string,
  age: number,
  maxRetries: number = 3
): Promise<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  explanation?: string;
}> => {
  const groq = createGroqClient();

  const macroPrompt = `
You're a professional nutritionist AI using USDA standards and evidence-based guidelines. 

User Details: ${userDetailsString}
Age: ${age} years

Based on the provided information, calculate personalized daily macronutrient targets.

## Your Task
1. Parse the user details to extract gender, weight, height, activity level, and goals
2. Calculate appropriate daily macronutrient targets using standard nutrition formulas
3. Consider age-specific recommendations and activity adjustments

## Response Format (Must be valid JSON)
{
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "explanation": "brief reasoning for these recommendations"
}

## Calculation Guidelines
- Use Mifflin-St Jeor equation for BMR calculation
- Apply appropriate activity multipliers (sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9)
- Protein: 1.2-2.0g per kg body weight depending on activity and goals
- Fat: 20-35% of total calories (aim for 25%)
- Carbs: Fill remaining calories after protein and fat
- Adjust for goals (weight loss: -20%, weight gain: +15%)

## Age Considerations
- Ages 18-30: Standard calculations
- Ages 31-50: Slightly reduced metabolism (-2%)
- Ages 51+: Reduced metabolism (-5%), higher protein needs
- Under 18: Growing needs (+10-15%)

## Activity Level Interpretations
- sedentary: desk job, minimal exercise
- light: light exercise 1-3 days/week
- moderate: moderate exercise 3-5 days/week
- active: intense exercise 6-7 days/week
- very_active: very intense exercise, physical job

## Goal Adjustments
- maintain: TDEE calories
- lose/cut: TDEE - 20%
- gain/bulk: TDEE + 15%

**CRITICAL REQUIREMENTS:**
- Return ONLY valid JSON with numeric values
- ALL macro values must be final calculated numbers (no expressions like "100+50")
- Be realistic with portion recommendations
- Consider user's lifestyle and preferences mentioned in details string
- No trailing commas in JSON

Provide accurate, science-based recommendations that the user can realistically follow.`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {

      const completion = await groq.chat.completions.create({
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
          explanation: parsed.explanation || "Macro suggestions based on your profile"
        };
      }
      
      throw new Error("Unable to parse macro suggestions from response");
      
    } catch (error: any) {
      console.error(`Macro suggestion attempt ${attempt + 1} failed:`, error);
      
      if (attempt === maxRetries - 1) {
        throw new Error(`Failed to get macro suggestions after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  throw new Error(`Failed to get macro suggestions after ${maxRetries} attempts`);
};

/**
 * Validate user details string format
 */
export const validateUserDetailsString = (userDetailsString: string, age: number): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!userDetailsString || userDetailsString.trim().length === 0) {
    errors.push("User details string is required");
  }
  
  if (!age || age < 10 || age > 100) {
    errors.push("Age must be between 10 and 100 years");
  }
  
  // Check if essential information is present in the string
  const lowerDetails = userDetailsString.toLowerCase();
  
  if (!lowerDetails.includes('gender') && !lowerDetails.includes('male') && !lowerDetails.includes('female')) {
    errors.push("Gender information missing from user details");
  }
  
  if (!lowerDetails.includes('weight')) {
    errors.push("Weight information missing from user details");
  }
  
  if (!lowerDetails.includes('height')) {
    errors.push("Height information missing from user details");
  }
  
  if (!lowerDetails.includes('activity')) {
    errors.push("Activity level information missing from user details");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Parse user details string into structured format (optional helper)
 */
export const parseUserDetailsString = (userDetailsString: string): Record<string, string> => {
  const details: Record<string, string> = {};
  
  // Simple parsing logic - you can enhance this based on your string format
  const pairs = userDetailsString.split(',').map(pair => pair.trim());
  
  pairs.forEach(pair => {
    const [key, value] = pair.split(':').map(item => item.trim());
    if (key && value) {
      details[key.toLowerCase()] = value;
    }
  });
  
  return details;
};


/**
 * Extract food name and quantity from natural language prompt using Groq SDK with retry logic
 */
export const extractFoodNameQuantityFromPrompt = async (
  prompt: string,
  maxRetries: number = 3
): Promise<{ name?: string; quantity?: string } | undefined> => {
  try {
    const groq = createGroqClient();

    const extractionPrompt = `
You're a food parsing assistant. Analyze the natural language prompt and extract the food name and quantity if present.

## Your Task
Parse the user's prompt to identify:
1. The name of the food item
2. The quantity/amount (if mentioned)

## Response Format (Must be valid JSON)
Return one of these formats:

If both name and quantity are found:
{
  "name": "food name",
  "quantity": "amount with units"
}

If only name is found:
{
  "name": "food name"
}

If prompt is too vague or no food is mentioned:
{
  "undefined": true
}

## Parsing Guidelines
- Extract the main food item name (e.g., "chicken breast", "apple", "rice")
- Include quantity with units when available (e.g., "2 slices", "150g", "1 cup")
- Handle common quantity expressions (e.g., "half", "quarter", "a few")
- Ignore non-food words like "eat", "have", "take", "some"
- If multiple foods mentioned, focus on the primary one
- Be flexible with natural language variations

## Examples
- "I'm eating 2 slices of bread" → {"name": "bread", "quantity": "2 slices"}
- "Had some grilled chicken" → {"name": "grilled chicken"}
- "150g salmon for lunch" → {"name": "salmon", "quantity": "150g"}
- "Just water" → {"name": "water"}
- "eat" → {"undefined": true}
- "" → {"undefined": true}

**CRITICAL REQUIREMENTS:**
- Return ONLY valid JSON with no extra text
- Use exact field names: "name", "quantity", "undefined"
- All values must be strings (not numbers)
- No trailing commas in JSON
- If unsure, prefer returning {"undefined": true}

User prompt: "${prompt}"`;

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
        if (!parsed.name || typeof parsed.name !== 'string') {
          throw new Error("Invalid or missing name field");
        }
        
        // Build result object
        const result: { name: string; quantity?: string } = {
          name: parsed.name.trim()
        };
        
        // Add quantity if present and valid
        if (parsed.quantity && typeof parsed.quantity === 'string' && parsed.quantity.trim().length > 0) {
          result.quantity = parsed.quantity.trim();
        }
        
        return result;
        
      } catch (error: any) {
        console.error(`Food extraction attempt ${attempt + 1} failed:`, error);
        
        if (attempt === maxRetries - 1) {
          console.error('All extraction attempts failed, returning undefined');
          return undefined;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return undefined;
    
  } catch (error: any) {
    console.error('Food name/quantity extraction failed:', error);
    return undefined;
  }
};

/**
 * Validate natural language food prompt
 */
export const validateFoodPrompt = (prompt: string): { isValid: boolean; error?: string } => {
  if (!prompt || typeof prompt !== 'string') {
    return { isValid: false, error: "Prompt must be a non-empty string" };
  }
  
  const trimmed = prompt.trim();
  
  if (trimmed.length === 0) {
    return { isValid: false, error: "Prompt cannot be empty" };
  }
  
  if (trimmed.length < 2) {
    return { isValid: false, error: "Prompt too short - needs at least 2 characters" };
  }
  
  // Check for potentially problematic inputs
  if (/^\d+$/.test(trimmed)) {
    return { isValid: false, error: "Prompt cannot be only numbers" };
  }
  
  if (!/[a-zA-Z]/.test(trimmed)) {
    return { isValid: false, error: "Prompt must contain at least one letter" };
  }
  
  return { isValid: true };
};
