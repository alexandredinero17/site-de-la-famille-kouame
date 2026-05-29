// server.js
const http = require("http");

const server = http.createServer((req, res) => {
  res.end("Serveur OK !");
});

server.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});
io.on("connection", (socket) => {

    socket.on("delete_message", async ({ messageId }) => {

        await db.query(`
            UPDATE messages
            SET is_deleted=true
            WHERE id=$1
        `, [messageId]);

        io.emit("message_deleted", { messageId });
    });

});
app.get('/chat/:user', (req, res) => {
    res.render('chat', {
        user: req.session.user,
        receiver: req.params.user
    });
});