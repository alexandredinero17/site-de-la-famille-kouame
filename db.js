const { Pool } = require('pg');

const db = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false },
    max: 10,        // 🔥 important
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

db.on('connect', () => {
    console.log("PostgreSQL connecté");
});

module.exports = db;