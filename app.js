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
io.on("connection", (socket) => {

    console.log("Utilisateur connecté");

    // ================= JOIN =================
    socket.on("join_conversation", (conversationId) => {
        socket.join("conv_" + conversationId);
    });

    socket.on("join_user", (userId) => {
        socket.join("user_" + userId);
    });

    // ================= SEND MESSAGE =================
    socket.on("send_message", async (data) => {
        try {

            const { conversation_id, sender_id, message, image, audio, reply_to } = data;

            if ((!message || message.trim() === "") && !image && !audio) return;

            const result = await db.query(
                `INSERT INTO messages
                (conversation_id, sender_id, message, image, audio, reply_to, seen)
                VALUES ($1,$2,$3,$4,$5,$6,false)
                RETURNING *`,
                [
                    conversation_id,
                    sender_id,
                    message || null,
                    image || null,
                    audio || null,
                    reply_to || null
                ]
            );

            const newMessage = result.rows[0];

            io.to("conv_" + conversation_id)
              .emit("receive_message", newMessage);

            // notification receiver
            const receiver = await db.query(
                `SELECT user_id FROM conversation_users
                 WHERE conversation_id=$1 AND user_id != $2 LIMIT 1`,
                [conversation_id, sender_id]
            );

            if (receiver.rows.length > 0) {
                io.to("user_" + receiver.rows[0].user_id)
                  .emit("new_notification", {
                      conversation_id,
                      sender_id,
                      message: message || "📎 Fichier"
                  });
            }

        } catch (err) {
            console.log("SEND MESSAGE ERROR:", err);
        }
    });
  socket.on("delete_message", async ({ message_id }) => {
    try {

        await db.query(
            `UPDATE messages
             SET deleted=true, message='Message supprimé'
             WHERE id=$1`,
            [message_id]
        );

        io.emit("message_deleted", {
            message_id
        });

    } catch (err) {
        console.log("DELETE ERROR:", err);
    }
});
socket.on("edit_message", async ({ message_id, new_text }) => {
    try {

        await db.query(
            `UPDATE messages
             SET message=$1, edited=true, edited_at=NOW()
             WHERE id=$2`,
            [new_text, message_id]
        );

        io.emit("message_edited", {
            message_id,
            new_text
        });

    } catch (err) {
        console.log("EDIT ERROR:", err);
    }
});

    // ================= MARK SEEN =================
   socket.on("mark_seen", async ({ conversationId, userId }) => {

    try {

        await db.query(
            `UPDATE messages
             SET seen=true, seen_at=NOW()
             WHERE conversation_id=$1
             AND sender_id != $2`,
            [conversationId, userId]
        );

        io.to("conv_" + conversationId)
          .emit("messages_seen", {
              conversationId,
              userId
          });

    } catch (err) {
        console.log(err);
    }

});
socket.on("voice_message", async (data) => {
    try {

        const { conversation_id, sender_id, audio_url } = data;

        const result = await db.query(
            `INSERT INTO messages
             (conversation_id, sender_id, audio, seen)
             VALUES ($1,$2,$3,false)
             RETURNING *`,
            [conversation_id, sender_id, audio_url]
        );

        io.to("conv_" + conversation_id)
          .emit("receive_message", result.rows[0]);

    } catch (err) {
        console.log("VOICE ERROR:", err);
    }
});
    // ================= TYPING =================
    socket.on("typing", (data) => {
        socket.to("conv_" + data.conversation_id)
              .emit("typing");
    });

    socket.on("stop_typing", (data) => {
        socket.to("conv_" + data.conversation_id)
              .emit("stop_typing");
    });

    // ================= ONLINE =================
    socket.on("user_online", async (userId) => {
        await db.query(
            `UPDATE users SET online=true, last_seen=NOW() WHERE id=$1`,
            [userId]
        );

        io.emit("user_status", { userId, online: true });
    });

    socket.on("user_offline", async (userId) => {
        await db.query(
            `UPDATE users SET online=false, last_seen=NOW() WHERE id=$1`,
            [userId]
        );

        io.emit("user_status", { userId, online: false });
    });

});

// ================= SECURITY =================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));



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
const cloudinary = require('cloudinary').v2;


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

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


// =================  CHAT-IMG =================
app.post('/upload-chat-image', upload.single('image'), async (req, res) => {

    try {

        const {
            conversation_id,
            sender_id,
            message
        } = req.body;

        const result = await cloudinary.uploader.upload(
            req.file.path,
            { folder: "chat-images" }
        );

        fs.unlinkSync(req.file.path);

        const imageUrl = result.secure_url;

        const newMsg = await db.query(
            `
            INSERT INTO messages
            (conversation_id, sender_id, message, image, seen)
            VALUES ($1,$2,$3,$4,false)
            RETURNING *
            `,
            [
                conversation_id,
                sender_id,
                message || "",
                imageUrl
            ]
        );

        io.to("conv_" + conversation_id)
        .emit("receive_message", newMsg.rows[0]);

        res.sendStatus(200);

    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur upload image");
    }

});

// ================= CONVERSATIONS =================
app.get('/conversations', async (req, res) => {

    try {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        const currentUserId = req.session.user.id;

        const result = await db.query(

            `
            SELECT

                c.id AS conversation_id,

                u.id AS other_id,
                u.nom,
                u.username,
                u.photo,
                u.online

            FROM conversations c

            INNER JOIN conversation_users cu1
                ON cu1.conversation_id = c.id

            INNER JOIN conversation_users cu2
                ON cu2.conversation_id = c.id

            INNER JOIN users u
                ON u.id = cu2.user_id

            WHERE cu1.user_id = $1
            AND cu2.user_id != $1

            ORDER BY c.id DESC
            `,

            [currentUserId]

        );

        const conversations = result.rows.map(row => ({

            id: row.conversation_id,

            other: {

                id: row.other_id,
                nom: row.nom,
                username: row.username,
                photo: row.photo,
                online: row.online

            }

        }));

        res.render('conversations', {

            conversations,
            user: req.session.user

        });

    } catch (err) {

        console.log(err);

        res.send("Erreur conversations");

    }

});
// ================= CHAT PRIVÉ =================

// ================= HOME =================
app.use((req, res, next) => {

    res.locals.user = req.session.user || null;

    res.locals.successMessage =
        req.session.successMessage || null;

    delete req.session.successMessage;

    next();

});
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

if (req.file) {

    const result = await cloudinary.uploader.upload(
        req.file.path,
        {
            folder: 'famille-kouame/profils'
        }
    );
    fs.unlinkSync(req.file.path);

    photo = result.secure_url;
    const publicId = result.public_id;

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

       req.session.successMessage =
"Votre inscription a été effectuée avec succès. Bienvenue dans la Grande Famille Kouamé !";

res.redirect('/');

    } catch (err) {

        console.log("🔥 REGISTER ERROR:", err);

        return res.status(500).send("Erreur interne serveur register");
    }
});
// ================= LOGIN =================
app.post('/login', async (req, res) => {

const identifier = req.body.email;

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

       const result = await cloudinary.uploader.upload(
    req.file.path,
    {
        folder: 'famille-kouame'
    }
);

fs.unlinkSync(req.file.path);
const photo = result.secure_url;
const publicId = result.public_id;

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
app.get('/messages', async (req, res) => {

    try {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        const currentUserId = req.session.user.id;

        const sql = `
            SELECT
                c.id AS conversation_id,
                u.id AS user_id,
                u.nom,
                u.username,
                u.photo,
                u.online

            FROM conversations c

            INNER JOIN conversation_users cu1
                ON cu1.conversation_id = c.id

            INNER JOIN conversation_users cu2
                ON cu2.conversation_id = c.id

            INNER JOIN users u
                ON u.id = cu2.user_id

            WHERE cu1.user_id = $1
            AND cu2.user_id != $1

            ORDER BY c.id DESC
        `;

        const result = await db.query(sql, [currentUserId]);

        const conversations = result.rows.map(row => ({

            id: row.conversation_id,

            other: {

                id: row.user_id,
                nom: row.nom,
                username: row.username,
                photo: row.photo,
                online: row.online

            }

        }));

        res.render('messages', {

            conversations,
            user: req.session.user

        });

    } catch (err) {

        console.log("ERREUR CONVERSATIONS :", err);

        res.status(500).send("Erreur conversations");

    }

});

// ================= CONVERSATIONS =================
// ================= PRIVATE CHAT =================
app.get('/chat/:username', async (req, res) => {

    try {

        if (!req.session.user) {
            return res.redirect('/login');
        }

        const currentUser = req.session.user;

        const username = req.params.username;

        // utilisateur cible
        const userResult = await db.query(
            `
            SELECT *
            FROM users
            WHERE username = $1
            LIMIT 1
            `,
            [username]
        );

        // utilisateur introuvable
        if (userResult.rows.length === 0) {
            return res.send("Utilisateur introuvable");
        }

        const membre = userResult.rows[0];

        // empêche de parler avec soi-même
        if (membre.id === currentUser.id) {
            return res.redirect('/membres');
        }

        // recherche conversation existante
        const convResult = await db.query(
            `
            SELECT c.id

            FROM conversations c

            INNER JOIN conversation_users cu1
                ON cu1.conversation_id = c.id

            INNER JOIN conversation_users cu2
                ON cu2.conversation_id = c.id

            WHERE cu1.user_id = $1
            AND cu2.user_id = $2

            LIMIT 1
            `,
            [
                currentUser.id,
                membre.id
            ]
        );

        let conversationId;

        // créer conversation si inexistante
        if (convResult.rows.length === 0) {

            const newConv = await db.query(
                `
                INSERT INTO conversations(created_at)
                VALUES(NOW())
                RETURNING id
                `
            );

            conversationId = newConv.rows[0].id;

            await db.query(
                `
                INSERT INTO conversation_users
                (
                    conversation_id,
                    user_id
                )
                VALUES
                ($1,$2),
                ($1,$3)
                `,
                [
                    conversationId,
                    currentUser.id,
                    membre.id
                ]
            );

        } else {

            conversationId = convResult.rows[0].id;

        }

        // récupération messages
        const messagesResult = await db.query(
            `
            SELECT *
            FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC
            `,
            [conversationId]
        );

        res.render('chat', {

            membre,
            user: currentUser,
            conversationId,
            messages: messagesResult.rows

        });

    } catch (err) {

        console.log("ERREUR CHAT :", err);

        res.status(500).send("Erreur interne du serveur");

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

           const result = await cloudinary.uploader.upload(
    req.file.path,
    {
        folder: 'famille-kouame/galerie'
    }
);
fs.unlinkSync(req.file.path);

const imagePath = result.secure_url;
const publicId = result.public_id;

            await db.query(
`INSERT INTO galerie
(user_name,image,public_id,description,date)
VALUES($1,$2,$3,$4,$5)`,
[
    req.session.user.nom,
    imagePath,
    publicId,
    req.body.description,
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
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Serveur démarré sur le port " + PORT);
});