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
 * Fix mathematical expressions in JSON strings (e.g., "1.01+2.03" becomes "3.04")
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
 * Check if image contains food using Groq SDK
 */
export const validateFoodImage = async (imageUrl: string): Promise<{ isFood: boolean; reason: string }> => {
  try {
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

    // Convert URL to base64
    console.log('Converting image to base64...');
    const base64Image = await urlToBase64(imageUrl);
    console.log('Base64 conversion successful, length:', base64Image.length);

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
    console.log('Groq validation response:', response);
    
    // Fix any mathematical expressions before parsing
    const fixedResponse = fixMacrosInJsonString(response);
    
    const jsonMatch = fixedResponse.match(/\{[\s\S]*\}/);
    console.log(jsonMatch)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isFood: parsed.containsFood === true,
        reason: parsed.reason || "No reason provided"
      };
    }
    
    return {
      isFood: false,
      reason: "Unable to analyze image content"
    };
  } catch (error: any) {
    console.error('Food validation error:', error);
    return {
      isFood: false,
      reason: `Error occurred during food validation: ${error.message}`
    };
  }
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
- Must return valid, parseable JSON
- No extra text outside the JSON structure
- Use only numeric values for macros, never strings or expressions`;

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
  } else {
    prompt += `

## Focus Mode
No user context provided - concentrate on accurate food identification and nutritional analysis only. Skip recommendations and complementary foods.`;
  }

  return prompt;
};

/**
 * Parse food analysis response with enhanced error handling and mathematical expression fixing
 */
const parseFoodAnalysisResponse = (response: string, hasContext: boolean): FoodAnalysis => {
  try {
    // First, fix any mathematical expressions in the response
    const fixedResponse = fixMacrosInJsonString(response);
    console.log('Fixed response applied');
    
    const jsonMatch = fixedResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in response");
    }
    
    console.log('JSON match found:', jsonMatch[0]);
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.foodItems || !Array.isArray(parsed.foodItems)) {
      throw new Error("Invalid foodItems format");
    }
    
    if (!parsed.totalMacros || typeof parsed.totalMacros !== 'object') {
      throw new Error("Invalid totalMacros format");
    }

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
    
  } catch (error) {
    console.error("Error parsing analysis response:", error);
    
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
        reason: "I couldn't analyze this image properly. Could you try taking another photo or entering the food manually?",
        alternatives: ["Try uploading a clearer image", "Enter the food details manually"]
      } : undefined
    };
  }
};

/**
 * Main food analysis function using Groq SDK
 */
export const analyzeFoodFromImage = async (
  imageUrl: string,
  context?: FoodAnalysisContext
): Promise<FoodAnalysis> => {
  try {
    const groq = createGroqClient();
    const analysisPrompt = createFoodAnalysisPrompt(context);
    
    console.log('Converting image to base64 for analysis...');
    const base64Image = await urlToBase64(imageUrl);
    console.log('Base64 conversion successful, proceeding with analysis...');

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
      temperature: 0.2, // Slightly higher for more natural language
      max_tokens: 3000, // More tokens for detailed recommendations
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log('Analysis complete, parsing response...');
    
    return parseFoodAnalysisResponse(response, !!context);
    
  } catch (error: any) {
    console.error('Food analysis failed:', error);
    throw new Error(`Food analysis failed: ${error.message}`);
  }
};

/**
 * Enhanced text-based food analysis with conversational recommendations
 */
export const analyzeFoodFromText = async (
  foodName: string,
  quantity: string,
  context?: FoodAnalysisContext
): Promise<FoodAnalysis> => {
  try {
    const groq = createGroqClient();
    
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
- Return only valid JSON`;

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

    console.log('Analyzing text input:', { foodName, quantity });

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
    console.log('Text analysis complete, parsing response...');
    
    return parseFoodAnalysisResponse(response, !!context);
    
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
