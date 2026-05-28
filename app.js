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
const { v4: uuidv4 } = require('uuid');
const xss = require('xss');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
require('dotenv').config();

// ================= SECURITY =================
app.use(
    helmet({
        contentSecurityPolicy: false
    })
);
app.use(morgan('dev'));

// ================= MYSQL =================

const db = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

app.get('/users', async (req, res) => {

    try {

        const result = await db.query('SELECT * FROM users');

        res.json(result.rows);

    } catch(err) {

        console.log(err);

        res.status(500).send('Erreur serveur');

    }

});

db.on('connect', () => {
    console.log('PostgreSQL pool prêt');
});
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
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24
}
}));


// ================= GLOBAL VARIABLES =================

// ================= ADMIN MIDDLEWARE =================
function isAdmin(req, res, next) {

    if (req.session.user && req.session.user.role === "admin") {
        return next();
    }

    return res.send("Accès refusé");
}

// ================= HOME =================
app.get('/', (req, res) => {

    db.query("SELECT * FROM posts ORDER BY id DESC", (err, results) => {

        if (err) {
            console.log("ERREUR POSTGRESQL HOME:", err); // IMPORTANT
            return res.status(500).send(err.message);
        }

        res.render('index', {
            user: req.session.user,
            posts: results
        });

    });

});

app.get('/galerie', (req, res) => {

    db.query(
        "SELECT * FROM galerie ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL GALERIE:", err);
                return res.send("Erreur chargement galerie");
            }

            res.render('galerie', {
                images: results || [],
                user: req.session.user || null
            });
        }
    );
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

            res.render('membres', {
                membres: results,
                user: req.session.user
            });
        }
    );
});


// ================= REGISTER =================
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {

    try {

       const {
    nom,
    email,
    telephone,
    profession,
    branche,
    description,
    password
} = req.body;

const branchesAutorisees = [
    "fils",
    "fille",
    "petit-fils",
    "petite-fille",
    "cousin",
    "neveu",
    "oncle",
    "frere",
    "soeur"
];

if (!branchesAutorisees.includes(branche)) {
    return res.send("Branche invalide");
}

        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users
            (nom, email, telephone, profession, branche, description, password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                nom,
                email,
                telephone,
                profession,
                branche,
                description,
                hashedPassword
            ],
            (err) => {

                if (err) {
                    console.log("ERREUR POSTGRESQL INSCRIPTION:", err);
                    return res.send("Erreur inscription");
                }

                res.redirect('/login');
            }
        );

    } catch (error) {
        console.log(error);
        res.send("Erreur serveur");
    }
});


// ================= LOGIN =================

const loginLimiter = rateLimit({

    windowMs: 15 * 60 * 1000, // 15 minutes

    max: 5, // 5 tentatives max

    message: "Trop de tentatives, réessayez plus tard."

});
app.use('/login', loginLimiter);

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {

    const { email, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE email = ?",
        [email],
        async (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL LOGIN:", err);
                return res.send("Erreur serveur");
            }

            if (results.length === 0) {
                return res.send("Utilisateur introuvable");
            }

            const user = results[0];

            const valid = await bcrypt.compare(password, user.password);

            if (!valid) {
                return res.send("Mot de passe incorrect");
            }

            req.session.user = user;

            res.redirect('/dashboard');
        }
    );
});

// ================= DASHBOARD =================
app.get('/dashboard', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    db.query(
        "SELECT * FROM posts ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL DASHBOARD:", err);
                return res.send("Erreur chargement posts");
            }

            res.render('dashboard', {
                user: req.session.user,
                posts: results
            });
        }
    );
});

// ================= POSTS =================
app.post('/post', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }
    const contenu = xss(req.body.contenu);

    const sql = `
        INSERT INTO posts (auteur, contenu, date)
        VALUES (?, ?, ?)
    `;

    db.query(
        sql,
        [
            req.session.user.nom,
            req.body.contenu,
            new Date()
        ],
        (err) => {

            if (err) {
                console.log("ERREUR POSTGRESQL PUBLICATION:", err);
                return res.send("Erreur publication");
            }

            res.redirect('/dashboard');
        }
    );
});

// ================= EVENTS =================
app.get("/events", (req, res) => {

    db.query(
        "SELECT * FROM events ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL EVENTS:", err);
                return res.send("Erreur chargement events");
            }

            res.render("events", {
                events: results,
                user: req.session.user
            });
        }
    );
});

app.post("/add-event", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const { title, description } = req.body;

    const sql = `
        INSERT INTO events (user, title, description, date)
        VALUES (?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            req.session.user.nom,
            title,
            description,
            new Date()
        ],
        (err) => {

            if (err) {
                console.log("ERREUR POSTGRESQL ADD-EVENT:", err);
                return res.send("Erreur ajout event");
            }

            res.redirect("/events");
        }
    );
});

// ================= MULTER =================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "public/uploads");
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname).toLowerCase());
    }
});

// FILTER
const upload = multer({

    storage,

    fileFilter: (req, file, cb) => {

        const allowedMimeTypes = [
            'image/png',
            'image/jpeg',
            'image/jpg'
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(null, false); // ❗ refuse sans crash
        }
    },

    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    }
});

app.post('/upload-image', upload.single('image'), (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (!req.file) {
        return res.send("Aucune image envoyée");
    }

    const user = req.session.user.nom;
    const image = "/uploads/" + req.file.filename;

    db.query(
        "INSERT INTO galerie (user, image, date) VALUES (?, ?, ?)",
        [user, image, new Date()],
        (err) => {

            if (err) {
                console.log("ERREUR POSTGRESQL UPLOAD:", err);
                return res.send("Erreur upload");
            }

            res.redirect('/galerie');
        }
    );
});

// ================= MESSAGES =================
let messages = [];
app.get('/messages', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    res.render('messages', {
        user: req.session.user,
        messages
    });
});

// ================= ADMIN =================
app.get('/admin', isAdmin, (req, res) => {

    const stats = {};

    db.query(
        "SELECT COUNT(*) AS totalUsers FROM users",
        (err, usersResult) => {

            if (err) {
                console.log("ERREUR POSTGRESQL ADMIN:", err);
                return res.send("Erreur users");
            }

            stats.users = usersResult[0].totalUsers;

            db.query(
                "SELECT COUNT(*) AS totalPosts FROM posts",
                (err, postsResult) => {

                    if (err) {
                        console.log("ERREUR POSTGRESQL ADMIN:", err);
                        return res.send("Erreur posts");
                    }

                    stats.posts = postsResult[0].totalPosts;

                    db.query(
                        "SELECT COUNT(*) AS totalEvents FROM events",
                        (err, eventsResult) => {

                            if (err) {
                                console.log("ERREUR POSTGRESQL ADMIN:", err);
                                return res.send("Erreur events");
                            }

                            stats.events = eventsResult[0].totalEvents;

                            db.query(
                                "SELECT COUNT(*) AS totalImages FROM galerie",
                                (err, galerieResult) => {

                                    if (err) {
                                        console.log("ERREUR POSTGRESQL ADMIN:", err);
                                        return res.send("Erreur galerie");
                                    }

                                    stats.images = galerieResult[0].totalImages;

                                    // AJOUT IMPORTANT
                                    db.query(
                                        "SELECT * FROM users ORDER BY id DESC",
                                        (err, users) => {

                                            if (err) {
                                                console.log("ERREUR POSTGRESQL ADMIN:", err);
                                                return res.send("Erreur chargement utilisateurs");
                                            }

                                            res.render("admin", {
                                                stats,
                                                users,
                                                user: req.session.user
                                            });

                                        }
                                    );

                                }
                            );

                        }
                    );

                }
            );

        }
    );

});
// ================= ADMIN USERS =================
app.get('/admin/membres', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM users ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL MEMBRES:", err);
                return res.send("Erreur membres");
            }

            res.render('admin-users', {
                users: results,
                user: req.session.user
            });

        }
    );

});

// ================= DELETE USER =================
app.post('/delete-user/:id', isAdmin, (req, res) => {

    db.query(
        "DELETE FROM users WHERE id = ?",
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

// ================= ADMIN POSTS =================
app.get('/admin/posts', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM posts ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL ADMIN:", err);
                return res.send("Erreur posts");
            }

            res.render('admin-posts', {
                posts: results
            });
        }
    );
});
const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg'];

    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Format non autorisé"));
    }
};

// ================= DELETE POST =================
app.get('/delete-post/:id', isAdmin, (req, res) => {

    db.query(
        "DELETE FROM posts WHERE id = ?",
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

// ================= ADMIN EVENTS =================
app.get('/admin/events', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM events ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log("ERREUR POSTGRESQL EVENTS:", err);
                return res.send("Erreur events");
            }

            res.render('admin-events', {
                events: results
            });
        }
    );
});

// ================= ADMIN GALLERY =================
app.get('/admin/gallery', isAdmin, (req, res) => {

    db.query(
        "SELECT * FROM galerie ORDER BY id DESC",
        (err, results) => {

            if (err) {
                console.log(err);
                return res.send("Erreur galerie");
            }

            res.render('admin-gallery', {
                images: results
            });
        }
    );
});

app.get('/delete-image/:id', isAdmin, (req, res) => {

    const id = req.params.id;

    // 1. On récupère l'image avant suppression
    db.query(
        "SELECT * FROM galerie WHERE id = ?",
        [id],
        (err, results) => {

            if (err) {
                console.log(err);
                return res.send("Erreur base de données");
            }

            if (results.length === 0) {
                return res.send("Image introuvable");
            }

            const imagePath = results[0].image;

            // 2. Suppression en base
            db.query(
                "DELETE FROM galerie WHERE id = ?",
                [id],
                (err2) => {

                    if (err2) {
                        console.log(err2);
                        return res.send("Erreur suppression DB");
                    }

                    // 3. Suppression fichier physique
                    const fullPath = path.join(__dirname, "public", imagePath);

                    fs.unlink(fullPath, (err3) => {
                        if (err3) {
                            console.log("Fichier déjà supprimé ou introuvable");
                        }
                    });

                    res.redirect('/galerie');
                }
            );
        }
    );
});

// ================= ADMIN MESSAGES =================
app.get('/admin/messages', isAdmin, (req, res) => {

    res.render('admin-messages', {
        messages
    });
});

// ================= SOCKET.IO =================

io.use((socket, next) => {

    const session = socket.request.session;

    if (session && session.user) {
        next();
    } else {
        next(new Error("Non autorisé"));
    }

});
// ================= LOGOUT =================
app.get('/logout', (req, res) => {

    req.session.destroy(() => {
        res.redirect('/');
    });
});

// ================= GLOBAL ERRORS =================
process.on("uncaughtException", (err) => {
    console.log("Erreur :", err);
});

// ================= START SERVER =================

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log('Serveur lancé');
});