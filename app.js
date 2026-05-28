// =============================
// CLEAN EXPRESS + POSTGRESQL APP
// =============================

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const multer = require("multer");
const helmet = require("helmet");
const xss = require('xss');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ================= SECURITY =================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));

// ================= DB (POSTGRESQL) =================
const db = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false },
    family: 4
});

db.on('connect', () => {
    console.log('PostgreSQL connecté');
});

// ================= GLOBAL ERROR LOG =================
process.on("unhandledRejection", err => console.log("PROMISE ERROR:", err));
process.on("uncaughtException", err => console.log("FATAL ERROR:", err));

// ================= MIDDLEWARE =================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
    secret: 'SECRET_2026_FAMILLE_APP',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// ================= RATE LIMIT LOGIN =================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Trop de tentatives, réessayez plus tard"
});
app.use('/login', loginLimiter);

// ================= ADMIN MIDDLEWARE =================
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === "admin") return next();
    return res.send("Accès refusé");
}

// ================= HOME =================
app.get('/', (req, res) => {
    db.query("SELECT * FROM posts ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);

        res.render('index', {
            user: req.session.user,
            posts: result.rows
        });
    });
});

// ================= REGISTER =================
app.post('/register', async (req, res) => {
    try {
        const { nom, email, telephone, profession, branche, description, password } = req.body;

        const hash = await bcrypt.hash(password, 10);

        db.query(
            `INSERT INTO users (nom, email, telephone, profession, branche, description, password)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [nom, email, telephone, profession, branche, description, hash],
            (err) => {
                if (err) return res.status(500).send(err.message);
                res.redirect('/login');
            }
        );

    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ================= LOGIN =================
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE email = $1",
        [email],
        async (err, result) => {
            if (err) return res.status(500).send(err.message);

            if (result.rows.length === 0) return res.send("Utilisateur introuvable");

            const user = result.rows[0];
            const valid = await bcrypt.compare(password, user.password);

            if (!valid) return res.send("Mot de passe incorrect");

            req.session.user = user;
            res.redirect('/dashboard');
        }
    );
});

// ================= DASHBOARD =================
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    db.query("SELECT * FROM posts ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);

        res.render('dashboard', {
            user: req.session.user,
            posts: result.rows
        });
    });
});

// ================= POST =================
app.post('/post', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const contenu = xss(req.body.contenu);

    db.query(
        "INSERT INTO posts (auteur, contenu, date) VALUES ($1,$2,$3)",
        [req.session.user.nom, contenu, new Date()],
        (err) => {
            if (err) return res.status(500).send(err.message);
            res.redirect('/dashboard');
        }
    );
});

// ================= EVENTS =================
app.post('/add-event', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const { title, description } = req.body;

    db.query(
        "INSERT INTO events (user, title, description, date) VALUES ($1,$2,$3,$4)",
        [req.session.user.nom, title, description, new Date()],
        (err) => {
            if (err) return res.status(500).send(err.message);
            res.redirect('/events');
        }
    );
});

// ================= EVENTS PAGE =================
app.get('/events', (req, res) => {
    db.query("SELECT * FROM events ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);

        res.render('events', {
            events: result.rows,
            user: req.session.user
        });
    });
});

// ================= USERS LIST =================
app.get('/membres', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    db.query("SELECT * FROM users ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);

        res.render('membres', {
            membres: result.rows,
            user: req.session.user
        });
    });
});

// ================= LOGOUT =================
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("Serveur lancé sur port " + PORT);
});