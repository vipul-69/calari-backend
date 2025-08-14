// server.ts
import express from "express";
import cors from "cors";
import userRoutes from "./routes/user.routes";
import foodRoutes from './routes/food.routes'
import uploadRoutes from './routes/upload.routes'
import mealRoutes from './routes/meals.routes'
import { clerkMiddleware, requireAuth } from "@clerk/express";
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware())
app.use(requireAuth())

app.use("/users", userRoutes);
app.use('/food', foodRoutes);
app.use('/upload', uploadRoutes);
app.use('/meals', mealRoutes)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
});
