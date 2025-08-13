const mongoose = require("mongoose");

// Create Schema
const Loginschema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true, // Ensure username is unique
  },
  password: {
    type: String,
    required: true,
  },
});

// collection part
const User = mongoose.model("users", Loginschema);

module.exports = { User, mongoose };

