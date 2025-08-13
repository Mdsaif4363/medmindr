const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { User } = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60
  })
}));

const DATA_FILE = "medicine_schedule.json";
let medicineSchedule = [];
let reminderIntervals = {};

function requireLogin(req, res, next) {
  if (req.session.loggedIn) next();
  else res.redirect("/sign_in");
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    const data = fs.readFileSync(DATA_FILE);
    return JSON.parse(data);
  }
  return [];
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function sendEmailReminder(subject, message, toEmail) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject,
    text: message,
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error(err);
    else console.log("Email sent:", info.response);
  });
}

// Routes
app.get("/", (req, res) => {
  res.render("index", { loggedIn: req.session.loggedIn });
});

app.get("/add_medicine", requireLogin, (req, res) => {
  res.render("add_medicine", { loggedIn: req.session.loggedIn });
});

app.post("/add_medicine", requireLogin, (req, res) => {
  medicineSchedule = loadData();
  const n = parseInt(req.body.n);

  for (let i = 0; i < n; i++) {
    const medicine = {
      medicine_name: req.body[`medicine_name_${i}`],
      dosage: req.body[`dosage_${i}`],
      frequency: parseInt(req.body[`frequency_${i}`]),
      duration_type: req.body[`duration_type_${i}`],
      start_date: req.body[`start_date_${i}`],
      recipient_email: req.body[`recipient_email_${i}`],
      reminder_set: false,
    };

    if (medicine.duration_type === "days") {
      const duration = parseInt(req.body[`duration_${i}`]);
      const endDate = new Date(medicine.start_date);
      endDate.setDate(endDate.getDate() + duration);
      medicine.end_date = endDate.toISOString().slice(0, 16);
    }

    medicineSchedule.unshift(medicine);
  }

  saveData(medicineSchedule);
  res.redirect("/show_details");
});

app.post("/set_reminder", requireLogin, (req, res) => {
  const medicineName = req.body.medicine_name;
  medicineSchedule = loadData();
  const medicine = medicineSchedule.find((m) => m.medicine_name === medicineName);
  if (!medicine) return res.redirect("/show_details");

  if (medicine.reminder_set) {
    clearInterval(reminderIntervals[medicineName]);
    medicine.reminder_set = false;
  } else {
    medicine.reminder_set = true;
    const interval = setInterval(() => {
      const now = new Date();
      const start = new Date(medicine.start_date);
      const end = medicine.end_date ? new Date(medicine.end_date) : null;

      if (end && now > end) {
        clearInterval(interval);
        return;
      }

      const nextDose = new Date(start.getTime() + medicine.frequency * 1000);
      if (nextDose <= now) {
        const msg = `Reminder: Time to take your medicine '${medicine.medicine_name}' - Dosage: ${medicine.dosage}`;
        console.log(msg);
        if (medicine.recipient_email) {
          sendEmailReminder("Medicine Reminder", msg, medicine.recipient_email);
        }
        medicine.start_date = nextDose.toISOString().slice(0, 16);
        saveData(medicineSchedule);
      }
    }, 1000);

    reminderIntervals[medicineName] = interval;
  }

  saveData(medicineSchedule);
  res.redirect("/show_details");
});

app.post("/remove_medicine", requireLogin, (req, res) => {
  const medicineName = req.body.medicine_name;
  medicineSchedule = loadData();
  medicineSchedule = medicineSchedule.filter((m) => m.medicine_name !== medicineName);
  if (reminderIntervals[medicineName]) {
    clearInterval(reminderIntervals[medicineName]);
    delete reminderIntervals[medicineName];
  }
  saveData(medicineSchedule);
  res.redirect("/show_details");
});

app.get("/show_details", requireLogin, (req, res) => {
  const medicineSchedule = loadData();
  res.render("show_details", {
    medicine_schedule: medicineSchedule,
    loggedIn: req.session.loggedIn,
  });
});

app.post("/sign_up", async (req, res) => {
  try {
    const { username, password } = req.body;
    const existingUser = await User.findOne({ name: username });
    if (existingUser) return res.send("User already exists. Please choose a different username.");

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name: username, password: hashedPassword });
    console.log("Signup successful:", newUser);
    return res.send('Signup successful! You can now <a href="/sign_in">login</a>.');
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error during signup.");
  }
});

app.post("/sign_in", async (req, res) => {
  try {
    const user = await User.findOne({ name: req.body.username });
    if (!user) return res.send("Username not found");

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) return res.send("Wrong password");

    req.session.loggedIn = true;
    return res.redirect("/");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Login error");
  }
});

app.get("/sign_in", (req, res) => {
  res.render("sign_in", { loggedIn: req.session.loggedIn });
});

app.get("/sign_up", (req, res) => {
  res.render("sign_up", { loggedIn: req.session.loggedIn });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", requireLogin, (req, res) => {
  const schedule = loadData();
  const totalMedicines = schedule.length;
  const activeReminders = schedule.filter(m => m.reminder_set).length;

  res.render("dashboard", {
    totalMedicines,
    activeReminders,
    loggedIn: req.session.loggedIn,
  });
});

async function startServer() {
  try {
    mongoose.connect(process.env.MONGO_URI);
    console.log("Database Connected Successfully");

    medicineSchedule = loadData();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Database cannot be Connected", err);
    process.exit(1);
  }
}

startServer();
