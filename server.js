// server.js
const http = require("http");

const server = http.createServer((req, res) => {
  res.end("Serveur OK !");
});

server.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});
app.get('/chat/:user', (req, res) => {
    res.render('chat', {
        user: req.session.user,
        receiver: req.params.user
    });
});