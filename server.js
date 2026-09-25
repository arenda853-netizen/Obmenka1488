const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздаем статические файлы (HTML, CSS, JS) из корневой папки
app.use(express.static(path.join(__dirname)));

// Автоматический перенос с главной страницы на интерфейс
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'obmenka-improved.html'));
});

// Путь к файлу пользователей для локальной авторизации
const USERS_FILE = path.join(__dirname, 'users.json');

function readUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }
    const users = readUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: 'Пользователь уже существует' });
    }
    users.push({ username, password });
    writeUsers(users);
    res.json({ success: true, message: 'Регистрация успешна' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(400).json({ success: false, message: 'Неверный логин или пароль' });
    }
    res.json({ success: true, message: 'Вход выполнен успешно' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
