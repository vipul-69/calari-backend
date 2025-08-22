import fetch from "node-fetch";
import type { Request, Response } from "express";
import { config } from "dotenv";
import { pool } from "../config/db";

config();

export const verifyPaymentController = async (req: Request, res: Response) => {
  const { paymentId, userId } = req.body;

  if (!paymentId || !userId) {
    return res.status(400).json({ error: "paymentId and userId are required" });
  }

  try {
    // 1. Verify payment with Dodo
    const response = await fetch(`https://live.dodopayments.com/payments/${paymentId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Dodo API error: ${response.statusText}`);
    }

    const data = await response.json();
    const success = data.status === "succeeded";

    // 2. Verify that the payment time is within last 5 minutes
    if (success) {
      const paymentTime = new Date(data.created_at).getTime();
      const now = Date.now();
      const diffMs = now - paymentTime;
      const fiveMinutesMs = 5 * 60 * 1000;

      if (diffMs > fiveMinutesMs) {
        return res.status(400).json({ 
          error: "Payment is older than 5 minutes and cannot be verified" 
        });
      }
    }

    if (success) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 3a. Expire previous active subscriptions
        await client.query(
          `
          UPDATE user_subscriptions
          SET status = 'expired'
          WHERE user_id = $1 AND status = 'active'
          `,
          [userId]
        );

        // 3b. Insert a new active subscription (30-day pro)
        await client.query(
          `
          INSERT INTO user_subscriptions (user_id, plan, start_date, end_date, status)
          VALUES ($1, 'pro', NOW(), NOW() + INTERVAL '30 days', 'active')
          `,
          [userId]
        );

        // 3c. Update the user's plan in the users table
        await client.query(
          `
          UPDATE users
          SET plan = 'pro'
          WHERE id = $1
          `,
          [userId]
        );

        await client.query("COMMIT");
      } catch (dbErr) {
        await client.query("ROLLBACK");
        throw dbErr;
      } finally {
        client.release();
      }
    }

    // 4. Send response back
    return res.json({
      userId,
      paymentId,
      success,
      paymentData: data
    });
  } catch (err: any) {
    console.error("Payment verification error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
