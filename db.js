const { Pool } = require('pg');

const pool = new Pool({
  host: 'db.xxxxxxxxx.supabase.co',
  user: 'postgres',
  password: 'TON_MOT_DE_PASSE',
  database: 'postgres',
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;