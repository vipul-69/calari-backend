import Groq from 'groq-sdk';
import { config } from 'dotenv';

config();

export const createGroqClient = (): Groq => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY environment variable is required");
  }

  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
};
