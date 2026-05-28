// =============================
// FULL FIXED EXPRESS + POSTGRESQL APP
// (ALL ROUTES INCLUDED + SQL FIXED)
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

// ================= DATABASE =================
const db = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false },
    family: 4
});

db.on('connect', () => console.log('PostgreSQL connecté'));

// ================= GLOBAL ERRORS =================
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
    secret: 'KJH789@#SUPER_SECRET_2026_FAMILLE',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// ================= ADMIN =================
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === "admin") return next();
    return res.send("Accès refusé");
}

// ================= SOCKET.IO =================
io.on('connection', (socket) => {
    socket.on('chat-message', (msg) => {
        io.emit('chat-message', {
            user: socket.id,
            message: xss(msg)
        });
    });
});

// ================= HOME =================
app.get('/', (req, res) => {
    db.query("SELECT * FROM posts ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('index', { user: req.session.user, posts: result.rows });
    });
});

// ================= AUTH PAGES =================
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// ================= REGISTER =================
app.post('/register', async (req, res) => {
    try {
        const { nom, email, telephone, profession, branche, description, password } = req.body;
        const hash = await bcrypt.hash(password, 10);

        db.query(
            `INSERT INTO users (nom,email,telephone,profession,branche,description,password)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [nom,email,telephone,profession,branche,description,hash],
            (err) => {
                if (err) return res.status(500).send(err.message);
                res.redirect('/login');
            }
        );
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ================= LOGIN =================
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query("SELECT * FROM users WHERE email=$1", [email], async (err, result) => {
        if (err) return res.status(500).send(err.message);
        if (result.rows.length === 0) return res.send("Utilisateur introuvable");

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);

        if (!valid) return res.send("Mot de passe incorrect");

        req.session.user = user;
        res.redirect('/dashboard');
    });
});

// ================= DASHBOARD =================
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    db.query("SELECT * FROM posts ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('dashboard', { user: req.session.user, posts: result.rows });
    });
});

// ================= GALERIE =================
app.get('/galerie', (req, res) => {
    db.query("SELECT * FROM galerie ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('galerie', { images: result.rows, user: req.session.user });
    });
});

// ================= MEMBRES =================
app.get('/membres', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    db.query("SELECT * FROM users ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('membres', { membres: result.rows, user: req.session.user });
    });
});

// ================= EVENTS =================
app.get('/events', (req, res) => {
    db.query("SELECT * FROM events ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('events', { events: result.rows, user: req.session.user });
    });
});

// ================= MESSAGES =================
let messages = [];
app.get('/messages', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('messages', { user: req.session.user, messages });
});

// ================= CHAT =================
app.get('/chat', (req, res) => {
    res.render('chat', { user: req.session.user });
});

// ================= LOGOUT =================
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// ================= ADMIN =================
app.get('/admin', isAdmin, async (req, res) => {
    const users = await db.query("SELECT COUNT(*) FROM users");
    const posts = await db.query("SELECT COUNT(*) FROM posts");
    const events = await db.query("SELECT COUNT(*) FROM events");

    res.render('admin', {
        stats: {
            users: users.rows[0].count,
            posts: posts.rows[0].count,
            events: events.rows[0].count
        }
    });
});
app.get('/delete-post/:id', isAdmin, (req, res) => {

    db.query(
        "DELETE FROM posts WHERE id = $1",
        [req.params.id],
        (err) => {

            if (err) {
                console.log(err);
                return res.send("Erreur suppression");
            }

            res.redirect('/admin/posts');
        }
    );
});
app.post('/delete-user/:id', isAdmin, (req, res) => {

    db.query(
        "DELETE FROM users WHERE id = $1",
        [req.params.id],
        (err) => {

            if (err) {
                console.log(err);
                return res.send("Erreur suppression");
            }

            res.redirect('/admin/membres');
        }
    );
});
app.get('/delete-image/:id', isAdmin, (req, res) => {

    const id = req.params.id;

    db.query(
        "SELECT * FROM galerie WHERE id = $1",
        [id],
        (err, results) => {

            if (err) return res.send("Erreur base de données");
            if (results.length === 0) return res.send("Image introuvable");

            const imagePath = results[0].image;

            db.query(
                "DELETE FROM galerie WHERE id = $1",
                [id],
                (err2) => {

                    if (err2) return res.send("Erreur suppression DB");

                    const fullPath = path.join(__dirname, "public", imagePath);

                    fs.unlink(fullPath, () => {});

                    res.redirect('/galerie');
                }
            );
        }
    );
});
app.get('/admin/membres', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM users ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log(err);
                return res.send("Erreur membres");
            }

            res.render('admin-users', {
                users: results,
                user: req.session.user
            });
        }
    );
});
app.get('/admin/events', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM events ORDER BY id DESC",
        (err, results) => {

            if (err) return res.send("Erreur events");

            res.render('admin-events', {
                events: results
            });
        }
    );
});
app.get('/admin/gallery', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM galerie ORDER BY id DESC",
        (err, results) => {

            if (err) return res.send("Erreur galerie");

            res.render('admin-gallery', {
                images: results
            });
        }
    );
});
app.get('/admin/messages', isAdmin, (req, res) => {
    res.render('admin-messages', { messages });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Serveur lancé"));
