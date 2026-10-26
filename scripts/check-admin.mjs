import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const admins = await pool.query("SELECT u.id, u.username_normalized, r.role FROM xland.user_identities u JOIN xland.user_roles r ON r.user_id = u.id WHERE r.role = 'admin'");
  console.log('Admins found:', admins.rows);
  const sampleProp = await pool.query("SELECT id, code, title FROM xland.properties LIMIT 3");
  console.log('Sample properties:', sampleProp.rows);
} catch (e) {
  console.error('Error:', e);
} finally {
  await pool.end();
}
