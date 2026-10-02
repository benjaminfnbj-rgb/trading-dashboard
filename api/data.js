import { neon } from '@neondatabase/serverless';
import { createHandler } from '../lib/handler.js';

export default createHandler({
  getSql: () => neon(process.env.DATABASE_URL),
  getKey: () => process.env.DASHBOARD_KEY,
});
