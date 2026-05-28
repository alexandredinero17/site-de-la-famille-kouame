// server.js
const http = require("http");

const server = http.createServer((req, res) => {
  res.end("Serveur OK !");
});

server.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});