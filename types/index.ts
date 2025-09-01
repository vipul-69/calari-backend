export interface FoodItem {
  name: string;
  quantity: string;
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

export interface MealSuggestion {
  name: string;
  quantity: string;
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  reason: string;
}

export interface FoodAnalysis {
  foodItems: FoodItem[];
  totalMacros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  suggestion?: {
    shouldEat: boolean;
    reason: string;
    recommendedQuantity?: string;
    alternatives?: string[];
    mealCompletionSuggestions?: MealSuggestion[];
    completeMealMacros?: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
}


