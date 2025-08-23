import type { Request, Response } from "express"
import { pool } from "../config/db"
import { v4 as uuidv4 } from "uuid"
import { getAuth } from '@clerk/express'

const ALLOWED_PLANS = ["basic", "pro", "creator"] as const
type Plan = (typeof ALLOWED_PLANS)[number]

const validatePlan = (plan: string): plan is Plan => {
  return ALLOWED_PLANS.includes(plan as Plan)
}

const handleDatabaseError = (error: any, res: Response) => {

  switch (error.code) {
    case "23505":
      return res.status(409).json({ error: "Email already exists" })
    case "23502":
      return res.status(400).json({ error: "Required field missing" })
    default:
      return res.status(500).json({ error: "Internal server error" })
  }
}

// Updated upsert user with Clerk integration
export const upsertUser = async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req) // Get Clerk user ID
    const { email, plan = "basic", profile = {} } = req.body
    
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" })
    }
    
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" })
    }

    if (!validatePlan(plan)) {
      return res.status(400).json({
        error: "Invalid plan value",
        allowedPlans: ALLOWED_PLANS,
      })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if user exists by email OR clerk_id
    const existingUserQuery = `
      SELECT id, clerk_id, email, plan, profile
      FROM users 
      WHERE email = $1 OR clerk_id = $2
    `

    const existingUser = await pool.query(existingUserQuery, [normalizedEmail, userId])

    if (existingUser.rows.length > 0) {
      // Update existing user and ensure clerk_id is set
      const updateQuery = `
        UPDATE users 
        SET 
          clerk_id = $1,
          email = $2,
          plan = $3,
          profile = $4
        WHERE id = $5
        RETURNING id, clerk_id, email, plan, profile
      `

      const result = await pool.query(updateQuery, [
        userId, 
        normalizedEmail, 
        plan, 
        JSON.stringify(profile), 
        existingUser.rows[0].id
      ])
      
      // Parse profile JSON safely
      const user = result.rows[0]
      try {
        user.profile = JSON.parse(user.profile || "{}")
      } catch {
        user.profile = {}
      }

      return res.status(200).json({
        ...user,
        isNew: false,
      })
    } else {
      // Create new user with Clerk ID
      const id = uuidv4()
      const insertQuery = `
        INSERT INTO users (id, clerk_id, email, plan, profile)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, clerk_id, email, plan, profile
      `

      const result = await pool.query(insertQuery, [
        id, 
        userId, 
        normalizedEmail, 
        plan, 
        JSON.stringify(profile)
      ])
      
      // Parse profile JSON safely
      const user = result.rows[0]
      try {
        user.profile = JSON.parse(user.profile || "{}")
      } catch {
        user.profile = {}
      }

      return res.status(201).json({
        ...user,
        isNew: true,
      })
    }
  } catch (error: any) {
    return handleDatabaseError(error, res)
  }
}

// Updated getUser with Clerk integration
export const getUser = async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req) // Get Clerk user ID
    const { email } = req.params
    

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" })
    }

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email format" })
    }

    const normalizedEmail = email.toLowerCase().trim()
    
    // Query by email AND verify it belongs to the authenticated user
    const query = `
      SELECT id, clerk_id, email, plan, profile
      FROM users 
      WHERE email = $1 AND clerk_id = $2
    `

    const result = await pool.query(query, [normalizedEmail, userId])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found or access denied" })
    }

    const user = result.rows[0]
    res.json(user)
  } catch (error: any) {
    return handleDatabaseError(error, res)
  }
}


// Get user subscriptions
export const getUserSubscriptions = async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req) // Get Clerk user ID
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" })
    }

    // First get the internal user id from users table using clerk_id
    const getUserQuery = `
      SELECT id FROM users WHERE clerk_id = $1
    `

    const userResult = await pool.query(getUserQuery, [userId])

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    const userDbId = userResult.rows[0].id
    
    // Get all subscriptions for the user
    const getSubscriptionsQuery = `
    SELECT id, user_id, plan, start_date, end_date, status, created_at
    FROM user_subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
    `
    
    const subscriptionsResult = await pool.query(getSubscriptionsQuery, [userDbId])
    console.log(subscriptionsResult.rows)

    return res.status(200).json({ 
      subscriptions: subscriptionsResult.rows 
    })

    
  } catch (error: any) {
    return handleDatabaseError(error, res)
  }
}
