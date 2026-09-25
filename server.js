// Простой бэкенд для хранения аккаунтов (ник + пароль) сайта obmenka.
// Эндпоинты соответствуют тому, что уже ждёт фронтенд (ACCOUNTS_API_URL в obmenka-improved.html):
//   GET  /accounts/:nickname  -> {nickname, password} или 404, если не найден
//   POST /accounts            -> body {nickname, password}, создаёт запись, 409 если ник занят

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, "users.json");

app.use(cors()); // разрешаем запросы с любого origin (в т.ч. с вашего Netlify-домена)
app.use(express.json());

// --- Работа с users.json как с простой базой ---
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Ошибка чтения users.json:", e);
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

// Проверка живости сервера (полезно для Render health-check)
app.get("/", (req, res) => {
  res.json({ ok: true, service: "obmenka-accounts-server" });
});

// Найти аккаунт по нику
app.get("/accounts/:nickname", (req, res) => {
  const nickname = (req.params.nickname || "").trim().toLowerCase();
  const users = readUsers();
  const account = users[nickname];
  if (!account) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(account);
});

// Создать новый аккаунт
app.post("/accounts", (req, res) => {
  const nickname = (req.body && req.body.nickname ? String(req.body.nickname) : "").trim().toLowerCase();
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!nickname || !password) {
    return res.status(400).json({ error: "nickname_and_password_required" });
  }

  const users = readUsers();
  if (users[nickname]) {
    return res.status(409).json({ error: "nickname_taken" });
  }

  users[nickname] = { nickname, password };
  writeUsers(users);
  res.status(201).json({ ok: true, nickname });
});

app.listen(PORT, () => {
  console.log(`Accounts server running on port ${PORT}`);
});
