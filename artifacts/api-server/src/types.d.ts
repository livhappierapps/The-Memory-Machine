declare namespace Express {
  interface Request {
    /** User ID used for data rows and field encryption (may be a legacy ID). */
    userId?: string;
    /** The signed-in Clerk user ID (for Clerk API calls). */
    clerkUserId?: string;
  }
}
