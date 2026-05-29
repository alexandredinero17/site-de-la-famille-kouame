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


io.on("connection", (socket) => {

    console.log("Utilisateur connecté");

    // REJOINDRE ROOM
    socket.on("join", (roomId) => {

        socket.join(String(roomId));
    });

    // MESSAGE LIVE
    socket.on("message", async (data) => {

        try{

            const {
                conversationId,
                sender_username,
                message
            } = data;

            if(!conversationId || !message){
                return;
            }

            // SAUVEGARDE DB
            const result = await db.query(

                `INSERT INTO messages
                (conversation_id, sender_username, message)
                VALUES ($1,$2,$3)
                RETURNING *`,

                [
                    conversationId,
                    sender_username,
                    message
                ]
            );

            // ENVOI LIVE
            io.to(String(conversationId))
            .emit("message", result.rows[0]);

        }catch(err){

            console.log("SOCKET ERROR :", err);
        }
    });

    socket.on("disconnect", () => {

        console.log("Utilisateur déconnecté");
    });
});




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


async function getOrCreateConversation(user1, user2) {

    const existing = await db.query(
        `SELECT id FROM conversations
         WHERE (user1=$1 AND user2=$2)
         OR (user1=$2 AND user2=$1)
         LIMIT 1`,
        [user1, user2]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0].id;
    }

    const created = await db.query(
        `INSERT INTO conversations (user1, user2)
         VALUES ($1,$2)
         RETURNING id`,
        [user1, user2]
    );

    return created.rows[0].id;
}
const storage = multer.diskStorage({

destination: (req, file, cb) => {

    const dir = path.join(__dirname, 'public/uploads');

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    cb(null, dir);
},

filename: (req, file, cb) => {

    const unique =
        Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(
        null,
        unique + path.extname(file.originalname)
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
        "image/jpg",
        "image/webp"
    ];

    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Format image invalide"));
    }
}   
});


// ================= ADMIN =================

// ================= CONVERSATIONS =================

app.get('/conversations', async (req, res) => {

    try {

        if (!req.session.user) return res.redirect('/login');

        const myId = req.session.user.id;

        const result = await db.query(`
            SELECT
                c.id,
                u1.id AS u1_id,
                u2.id AS u2_id,
                u1.username AS u1_username,
                u2.username AS u2_username,
                u1.nom AS u1_nom,
                u2.nom AS u2_nom,
                u1.photo AS u1_photo,
                u2.photo AS u2_photo
            FROM conversations c
            JOIN users u1 ON c.user1 = u1.id
            JOIN users u2 ON c.user2 = u2.id
            WHERE c.user1=$1 OR c.user2=$1
            ORDER BY c.created_at DESC
        `, [myId]);

        const convs = result.rows.map(c => {

            const isMeUser1 = c.u1_id === myId;

            return {
                id: c.id,
                other: isMeUser1 ? {
                    id: c.u2_id,
                    username: c.u2_username,
                    nom: c.u2_nom,
                    photo: c.u2_photo
                } : {
                    id: c.u1_id,
                    username: c.u1_username,
                    nom: c.u1_nom,
                    photo: c.u1_photo
                }
            };
        });

        res.render("conversations", {
            conversations: convs,
            user: req.session.user
        });

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur conversations");
    }
});

// ================= CHAT PRIVÉ =================

app.get('/chat/:username', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    const username = req.params.username;

    db.query(
        "SELECT * FROM users WHERE username = $1",
        [username],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.send("Erreur serveur");
            }

            if (result.rows.length === 0) {
                return res.send("Utilisateur introuvable");
            }

            const membre = result.rows[0];

            res.render('chat', {
                membre,
                user: req.session.user
            });

        }
    );

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
app.post('/delete-post/:id', async (req, res) => {

    try {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        const postId = req.params.id;

        // option sécurité : vérifier propriétaire
        const post = await db.query(
            "SELECT * FROM posts WHERE id=$1",
            [postId]
        );

        if (!post.rows.length) {
            return res.send("Post introuvable");
        }

        await db.query(
            "DELETE FROM posts WHERE id=$1",
            [postId]
        );

        res.redirect('/dashboard');

    } catch (err) {

        console.log(err);
        res.status(500).send("Erreur suppression post");
    }
});

// ================= AUTH PAGES =================
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// ================= REGISTER =================
app.post('/register', upload.single('photo'), async (req, res) => {

    try {

        const { nom, username, email, telephone, profession, branche, description, password } = req.body;

        // 🔒 validation minimale
        if (!nom || !email || !password) {
            return res.status(400).send("Nom, email et mot de passe obligatoires");
        }

        // 🔒 vérifier si email existe déjà
        const check = await db.query(
            "SELECT id FROM users WHERE email=$1",
            [email]
        );

        if (check.rows.length > 0) {
            return res.status(400).send("Email déjà utilisé");
        }

        // 🔐 hash password
        const hash = await bcrypt.hash(password, 10);

        // 📸 photo safe (ANTI-CRASH)
        let photo = "/images/default.png";

        if (req.file && req.file.filename) {
            photo = "/uploads/" + req.file.filename;
        }

        // 💾 insert user
        await db.query(
            `INSERT INTO users 
            (nom, username, email, telephone, profession, branche, description, password, photo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                nom,
                username,
                email,
                telephone || null,
                profession || null,
                branche || null,
                description || null,
                hash,
                photo
            ]
        );

        return res.redirect('/dashboard');

    } catch (err) {

        console.log("🔥 REGISTER ERROR:", err);

        return res.status(500).send("Erreur interne serveur register");
    }
});
// ================= LOGIN =================
app.post('/login', async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await db.query(
            "SELECT id, nom, email, password, role FROM users WHERE email = $1 or username = $1 LIMIT 1",
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
app.post("/profile/photo", upload.single("photo"), async (req, res) => {

    try {

        const photo = "/uploads/" + req.file.filename;

        await db.query(
            "UPDATE users SET photo=$1 WHERE id=$2",
            [photo, req.session.user.id]
        );

        req.session.user.photo = photo;

        res.redirect("/dashboard");

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur photo profil");
    }
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

    if (!req.session.user) {
        return res.redirect('/login');
    }

    db.query(
        "SELECT * FROM users ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL MEMBRES:", err);
                return res.send("Erreur chargement membres");
            }

            console.log(results.rows);

            res.render('membres', {
                membres: results.rows,
                user: req.session.user
            });

        }
    );

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
// ================= CONVERSATIONS =================
app.get('/conversations', async (req, res) => {

    try {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        const myId = req.session.user.id;

        const result = await db.query(
            `
            SELECT

                conversations.id,

                u1.id AS user1_id,
                u1.nom AS user1_nom,
                u1.username AS user1_username,
                u1.photo AS user1_photo,

                u2.id AS user2_id,
                u2.nom AS user2_nom,
                u2.username AS user2_username,
                u2.photo AS user2_photo

            FROM conversations

            JOIN users u1
            ON conversations.user1 = u1.id

            JOIN users u2
            ON conversations.user2 = u2.id

            WHERE
            conversations.user1 = $1
            OR
            conversations.user2 = $1

            ORDER BY conversations.created_at DESC
            `,
            [myId]
        );

        // construire vrai interlocuteur
        const conversations = result.rows.map(conv => {

            let otherUser;

            if (conv.user1_id === myId) {

                otherUser = {
                    id: conv.user2_id,
                    nom: conv.user2_nom,
                    username: conv.user2_username,
                    photo: conv.user2_photo
                };

            } else {

                otherUser = {
                    id: conv.user1_id,
                    nom: conv.user1_nom,
                    username: conv.user1_username,
                    photo: conv.user1_photo
                };
            }

            return {
                id: conv.id,
                otherUser
            };
        });

        res.render('conversations', {
            conversations,
            user: req.session.user
        });

    } catch (err) {

        console.log("CONVERSATIONS ERROR:", err);

        res.status(500).send("Erreur conversations");
    }
});
// ================= PRIVATE CHAT =================
app.get('/chat/:username', async (req, res) => {

    try {

        // utilisateur connecté
        if (!req.session.user) {
            return res.redirect('/login');
        }

        const me = req.session.user;

        // username cible
        const username = req.params.username;

        // chercher utilisateur
        const userResult = await db.query(
            `
            SELECT *
            FROM users
            WHERE username=$1
            LIMIT 1
            `,
            [username]
        );

        // utilisateur inexistant
        if (userResult.rows.length === 0) {

            return res.send(
                "Utilisateur introuvable"
            );
        }

        const other = userResult.rows[0];

        // empêcher chat avec soi-même
        if (other.id === me.id) {

            return res.redirect('/membres');
        }

        // chercher conversation existante
        let conv = await db.query(
            `
            SELECT *
            FROM conversations

            WHERE
            (
                user1=$1
                AND
                user2=$2
            )

            OR

            (
                user1=$2
                AND
                user2=$1
            )

            LIMIT 1
            `,
            [me.id, other.id]
        );

        let conversationId;

        // conversation existe déjà
        if (conv.rows.length > 0) {

            conversationId = conv.rows[0].id;

        } else {

            // créer nouvelle conversation privée
            const created = await db.query(
                `
                INSERT INTO conversations
                (
                    user1,
                    user2,
                    created_at
                )

                VALUES ($1,$2,NOW())

                RETURNING id
                `,
                [me.id, other.id]
            );

            conversationId = created.rows[0].id;
        }

        // récupérer uniquement messages privés
        const messages = await db.query(
            `
            SELECT *
            FROM messages

            WHERE conversation_id=$1

            ORDER BY id ASC
            `,
            [conversationId]
        );

        // ouvrir chat privé
        res.render('chat', {

            roomId: conversationId,

            messages: messages.rows,

            user: me,

            otherUser: other
        });

    } catch (err) {

        console.log("PRIVATE CHAT ERROR:", err);

        res.status(500).send(
            "Erreur chat privé"
        );
    }
});

// ================= ADMIN MIDDLEWARE =================

function isAdmin(req, res, next){

    if(
        req.session.user &&
        req.session.user.role === "admin"
    ){
        return next();
    }

    return res.status(403).send("Accès refusé");
}


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
app.post('/delete-image/:id', isAdmin, async (req, res) => {

    const id = req.params.id;

    try {

        const result = await db.query(
            "SELECT image FROM galerie WHERE id = $1",
            [id]
        );

        // si image inexistante → on sort proprement
        if (!result.rows || result.rows.length === 0) {
            return res.redirect('/admin/gallery');
        }

        const imagePath = result.rows[0].image;

        // suppression DB (priorité)
        await db.query(
            "DELETE FROM galerie WHERE id = $1",
            [id]
        );

        // réponse immédiate (ULTRA RAPIDE)
        res.redirect('/admin/gallery');

        // suppression fichier en arrière-plan (SAFE)
        if (imagePath) {
            const fullPath = path.join(__dirname, "public", imagePath);

            fs.unlink(fullPath, (err) => {
                if (err) {
                    console.log("Image déjà supprimée ou introuvable");
                }
            });
        }

    } catch (err) {
        console.log("DELETE IMAGE ERROR:", err);

        // jamais de crash utilisateur
        return res.redirect('/admin/gallery');
    }
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
app.get('/admin/messages', isAdmin, async (req, res) => {
    res.render('admin-messages', {
        messages: []
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
