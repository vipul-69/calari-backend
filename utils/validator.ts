import { createGroqClient } from '../config/groq';
import { urlToBase64 } from './food';
import { createFoodValidationPrompt } from './templates';
import { fixMacrosInJsonString, repairJsonString } from './food';
import type { ValidationResult, FoodValidationResult } from '../types/food';

export const validateFoodImage = async (imageUrl: string, maxRetries: number = 3): Promise<FoodValidationResult> => {
  const groq = createGroqClient();
  
  const validationPrompt = createFoodValidationPrompt();

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

export const validateFoodTextInput = (foodName: string, quantity: string): ValidationResult => {
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

export const validateFoodPrompt = (prompt: string): ValidationResult => {
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
