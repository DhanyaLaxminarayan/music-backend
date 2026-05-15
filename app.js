const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("ECS Backend is running ");
});

app.listen(80, () => {
  console.log("Server running on port 80");
});