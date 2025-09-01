export const urlToBase64 = async (url: string): Promise<string> => {
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

export const fixMacrosInJsonString = (jsonStr: string): string => {
  // Handle addition: 1.01+2.03 → 3.04
  let fixed = jsonStr.replace(/(\d+\.?\d*)\+(\d+\.?\d*)/g, (_, num1, num2) => {
    const sum = parseFloat(num1) + parseFloat(num2);
    return sum.toFixed(2);
  });
  
  // Handle subtraction: 5.5-1.2 → 4.30
  fixed = fixed.replace(/(\d+\.?\d*)-(\d+\.?\d*)/g, (_, num1, num2) => {
    const diff = parseFloat(num1) - parseFloat(num2);
    return Math.max(0, diff).toFixed(2);
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

export const repairJsonString = (jsonStr: string): string => {
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

export const sanitizeNumericValue = (value: any): number => {
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.max(0, num);
  }
  const num = Number(value);
  return isNaN(num) ? 0 : Math.max(0, num);
};

