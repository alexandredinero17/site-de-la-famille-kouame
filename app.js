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
        maxAge: 1000 * 60 * 60 * 24 * 30
    }
}));

// ================= ADMIN =================
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === "admin") return next();
    return res.send("Accès refusé");
}

// ================= SOCKET.IO =================
io.on("connection", (socket) => {

    socket.on("joinRoom", (roomId) => {
        socket.join(roomId);
    });

    socket.on("sendMessage", async (data) => {

        const { roomId, message, sender } = data;
const roomId = String(data.roomId);
        if (!roomId || !message) return;

        try {

            // 🔥 1. SAUVEGARDE OBLIGATOIRE
            await db.query(
                `INSERT INTO messages (conversation_id, sender, message)
                 VALUES ($1, $2, $3)`,
                [roomId, sender, message]
            );

            // 🔥 2. BROADCAST
            io.to(roomId).emit("newMessage", {
                sender,
                message
            });

        } catch (err) {
            console.log("SAVE MESSAGE ERROR:", err);
        }
    });
});
const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        const uploadPath = path.join(__dirname, 'public/uploads');

        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() + "-" + Math.round(Math.random() * 1E9);

        cb(
            null,
            uniqueName + path.extname(file.originalname)
        );
    }
});

const upload = multer({

    storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/jpg"
        ];

        if (allowed.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(new Error("Format image invalide"));
        }
    }
});
app.get('/conversations', async (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {

        const user = req.session.user.nom;

        const result = await db.query(
            `SELECT * FROM conversations 
             WHERE user1 = $1 OR user2 = $1 
             ORDER BY created_at DESC`,
            [user]
        );

        res.render('conversations', {
            conversations: result.rows,
            user: req.session.user
        });

    } catch (err) {
        console.log("CONVERSATIONS ERROR:", err);
        res.status(500).send("Erreur conversations");
    }
});

// ================= HOME =================
app.get('/', (req, res) => {
    db.query("SELECT * FROM posts ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('index', { user: req.session.user, posts: result.rows });
    });
});
app.post('/post', async (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {

        const contenu = xss(req.body.contenu);

        await db.query(
            `INSERT INTO posts (auteur, contenu, date)
             VALUES ($1, $2, $3)`,
            [
                req.session.user.nom,
                contenu,
                new Date()
            ]
        );

        res.redirect('/dashboard');

    } catch (err) {

        console.log("POST ERROR:", err);

        res.status(500).send("Erreur publication");
        console.log(err);
    }
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
app.post('/login', async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await db.query(
            "SELECT id, nom, email, password, role FROM users WHERE email = $1 LIMIT 1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.send("Utilisateur introuvable");
        }

        const user = result.rows[0];

        const valid = await bcrypt.compare(password, user.password);

        if (!valid) {
            return res.send("Mot de passe incorrect");
        }

        req.session.user = user;

        res.redirect('/dashboard');

    } catch (err) {
        console.log("LOGIN ERROR:", err);
        res.status(500).send("Erreur serveur");
    }
    app.set('trust proxy', 1);
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
app.post('/upload-image', upload.single('image'), async (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {

        if (!req.file) {
            return res.send("Aucune image envoyée");
        }

        const user = req.session.user.nom;

        const image = "/uploads/" + req.file.filename;

        await db.query(
            `INSERT INTO galerie (user, image, date, description)
             VALUES ($1, $2, $3, $4)`,
            [
                req.session.user.nom,
                image,
                new Date(),
                req.body.description || ""
            ]
        );

        res.redirect('/galerie');

    } catch (err) {

        console.log("UPLOAD ERROR:", err);

        res.status(500).send("Erreur upload image");
    }
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
app.post("/add-event", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    try {

        const { title, description } = req.body;

        await db.query(
            `
            INSERT INTO events
            (user_name, title, description, date)
            VALUES ($1, $2, $3, $4)
            `,
            [
                req.session.user.nom,
                title,
                description,
                new Date()
            ]
        );

        res.redirect("/events");

    } catch (err) {

        console.log("EVENT ERROR :", err);

        res.status(500).send("ERREUR AJOUT EVENEMENT");
    }
});
app.get('/events', (req, res) => {
    db.query("SELECT * FROM events ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.render('events', { events: result.rows, user: req.session.user });
    });
});

// ================= MESSAGES =================


// ================= CHAT =================
app.get('/chat', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    res.render('chat', {
        user: req.session.user,
        messages: [],
        roomId: null
    });
    setTimeout(() => {
    window.scrollTo(0, document.body.scrollHeight);
}, 100);
});
app.get('/chat/:id', async (req, res) => {

    if (!req.session.user) return res.redirect('/login');

    try {

      const roomId = String(req.params.id);

        const result = await db.query(
            `SELECT * FROM messages 
             WHERE conversation_id = $1 
             ORDER BY id ASC`,
            [roomId]
        );

        res.render("chat", {
            messages: result.rows,
            roomId,
            user: req.session.user
        });

    } catch (err) {
        console.log("CHAT ERROR:", err);
        res.status(500).send("Erreur chat serveur");
    }
});
// ================= LOGOUT =================
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// ================= ADMIN =================
app.get('/admin', isAdmin, async (req, res) => {

    try {

        const usersResult = await db.query("SELECT COUNT(*) FROM users");
        const postsResult = await db.query("SELECT COUNT(*) FROM posts");
        const eventsResult = await db.query("SELECT COUNT(*) FROM events");
        const galleryResult = await db.query("SELECT COUNT(*) FROM galerie");
        const usersList = await db.query("SELECT * FROM users ORDER BY id DESC");

        const stats = {
            users: usersResult.rows[0].count,
            posts: postsResult.rows[0].count,
            events: eventsResult.rows[0].count,
            images: galleryResult.rows[0].count
        };

        res.render("admin", {
            stats,
            users: usersList.rows,
            user: req.session.user
        });

    } catch (err) {
        console.log("ADMIN ERROR:", err);
        res.status(500).send("Erreur serveur admin");
    }
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
app.get('/delete-user/:id', isAdmin, async (req, res) => {

    try {

        await db.query(
            "DELETE FROM users WHERE id = $1",
            [req.params.id]
        );

        res.redirect('/admin/membres');

    } catch (err) {

        console.log("DELETE USER ERROR:", err);

        res.status(500).send("Erreur suppression utilisateur");
    }
});
app.post('/delete-event/:id', isAdmin, async (req, res) => {

    try {

        await db.query(
            "DELETE FROM events WHERE id = $1",
            [req.params.id]
        );

        res.redirect('/admin/events');

    } catch (err) {

        console.log("DELETE EVENT ERROR :", err);

        res.status(500).send("Erreur suppression événement");
    }
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
app.get('/admin/membres', isAdmin, async (req, res) => {

    try {

        const result = await db.query(
            "SELECT * FROM users ORDER BY id DESC"
        );

        res.render('admin-users', {
            users: result.rows,
            user: req.session.user
        });

    } catch (err) {

        console.log("ADMIN USERS ERROR:", err);

        res.status(500).send("Erreur chargement utilisateurs");
    }
});
app.get('/admin/events', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM events ORDER BY id DESC",
        (err, results) => {

            if (err) return res.send("Erreur events");

            res.render('admin-events', {
                events: results.rows,
                user: req.session.user
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
                images: results.rows,
                user: req.session.user
            });
        }
    );
});
app.get('/admin/chats', isAdmin, async (req, res) => {

    const conv = await db.query(
        "SELECT * FROM conversations ORDER BY id DESC"
    );

    res.render('admin-chats', {
        conversations: conv.rows,
        user: req.session.user
    });
});
app.get('/admin/chat/:id', isAdmin, async (req, res) => {

    try {

        const result = await db.query(
            "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY id ASC",
            [req.params.id]
        );

        res.render('admin-chat-view', {
            messages: result.rows,
            convId: req.params.id,
            user: req.session.user
        });

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur chat admin");
    }
});
app.post('/admin/delete-conversation/:id', isAdmin, async (req, res) => {

    try {

        const id = req.params.id;

        await db.query(
            "DELETE FROM messages WHERE conversation_id=$1",
            [id]
        );

        await db.query(
            "DELETE FROM conversations WHERE id=$1",
            [id]
        );

        res.redirect('/admin/chats');

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur suppression conversation");
    }
});
app.get('/admin/posts', isAdmin, async (req, res) => {

    try {

        const result = await db.query(
            "SELECT * FROM posts ORDER BY id DESC"
        );

        res.render('admin-posts', {
            posts: result.rows,
            user: req.session.user
        });

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur posts admin");
    }
});
app.post(
    '/upload-image',
    upload.single('image'),
    async (req, res) => {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        try {

            if (!req.file) {
                return res.send("Aucune image");
            }

            const imagePath =
                "/uploads/" + req.file.filename;

            await db.query(
                `
                INSERT INTO galerie
                (user_name, image, description, date)
                VALUES ($1, $2, $3, $4)
                `,
                [
                    req.session.user.nom,
                    imagePath,
                    req.body.description || null,
                    new Date()
                ]
            );

            res.redirect('/galerie');

        } catch (err) {

            console.log("UPLOAD ERROR :", err);

            res.status(500).send(
                "Erreur interne du serveur lors upload"
            );
        }
    }
);

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Serveur lancé"));
