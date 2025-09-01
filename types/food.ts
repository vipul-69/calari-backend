export interface FoodAnalysis {
  foodItems: FoodItem[];
  totalMacros: Macros;
  suggestion?: FoodSuggestion;
}

export interface FoodItem {
  name: string;
  quantity: string;
  macros: Macros;
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodSuggestion {
  shouldEat: boolean;
  reason: string;
  recommendedQuantity?: string;
  alternatives?: string[];
  mealCompletionSuggestions?: FoodItem[];
  completeMealMacros?: Macros;
}

export interface FoodAnalysisContext {
  userInfo: string;
  totalMacros: Macros;
  consumedMacros: Macros;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  errors?: string[];
}

export interface FoodValidationResult {
  isFood: boolean;
  reason: string;
}

export interface MacroSuggestion {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  explanation?: string;
}

export interface FoodValidationResult {
  isFood: boolean;
  reason: string;
}

export interface ExtractedFood {
  name?: string;
  quantity?: string;
}