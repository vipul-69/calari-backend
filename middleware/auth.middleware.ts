// middleware/clerkAuth.ts
import { clerkMiddleware, getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../config/db';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    plan: string;
    profile: any;
  };
}

/**
 * Middleware to attach user data from your database after Clerk auth
 */
export const attachUserData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
      return;
    }

    // Find user in your database using Clerk userId
    // Option 1: If you store Clerk userId in your users table
    const userQuery = `
      SELECT id, email, plan, profile
      FROM users 
      WHERE clerk_id = $1
    `;

    const result = await pool.query(userQuery, [userId]);

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'User not found in database'
      });
      return;
    }

    const user = result.rows[0];

    // Parse profile safely (same as your existing code)
    try {
      user.profile = typeof user.profile === 'string' 
        ? JSON.parse(user.profile) 
        : user.profile || {};
    } catch {
      user.profile = {};
    }

    // Attach user to request
    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      plan: user.plan || 'basic',
      profile: user.profile
    };

    next();

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user data'
    });
  }
};
