# План внедрения входа через Google (Этап A: Веб)

**Цель:** Добавить «Войти через Google» в веб-приложение, создавая/связывая пользователя и сессию точно так же, как существующий вход по паролю — без изменений в Socket.IO и игровой логике.

**Архитектура:** Поток ID-токена Google Identity Services (GIS). Браузер получает подписанный JWT (`credential`) от Google; фронтенд отправляет его на `POST /api/auth/google`; бэкенд проверяет его через `google-auth-library`, создаёт/обновляет `User` и выставляет `req.session.userId` — ту же сессию, которой уже доверяет остальное приложение (и `io.use(wrap(sessionMiddleware))`). Без redirect-URI, без client secret.

**Стек:** Express 5, `express-session`+`connect-redis`, Mongoose, `google-auth-library` (новый), Jest+supertest (есть), клиентский JS GIS (хостится Google).

**Оценка времени:** 10 задач × ~5 мин ≈ 60 мин (веб). Android (Этап B) — отдельная задача на ~40 мин.

---

## Предварительные требования

- [ ] **Google Cloud Console** (вручную): создать проект → *OAuth consent screen* (External) → *Credentials* → **Create OAuth Client ID → Web application**.
- [ ] Authorized JavaScript origins: `https://playquor.org`, `http://localhost:3000`.
- [ ] У вас есть значение `GOOGLE_CLIENT_ID` (публичное).
- [ ] Задать env: добавить `GOOGLE_CLIENT_ID=<your-id>` в `.env` (и в прод/Cloudflare env). Без него роут вернёт 500, а кнопка не отрисуется.
- [ ] Подтвердите допущения этого плана, прочитав `src/server.js:181-289` (auth-роуты), `src/models/User.js`, `frontend/login.html`, `tests/server-api.test.js:11-96` (паттерн мока User).

> Примечание: тесты мокают `google-auth-library`, поэтому набор проходит **без** реального client id. Сквозной поток можно проверить только вручную с настоящим id.

---

## Этап 1 — Бэкенд

### Задача 1: Добавить зависимость

**Файлы:**
- Изменить: `package.json` / `package-lock.json` (через npm)

**Шаг 1: Установить**

```bash
npm install google-auth-library
```

**Шаг 2: Проверить**

```bash
node -e "require('google-auth-library'); console.log('ok')"
```

Ожидается: `ok`

**Шаг 3: Коммит**

```bash
git add package.json package-lock.json
git commit -m "chore(auth): add google-auth-library dependency"
```

---

### Задача 2: Расширить модель User

**Файлы:**
- Изменить: `src/models/User.js:12-35` (блок email/passwordHash)

**Шаг 1: Правка**

Заменить поле `passwordHash` и добавить OAuth-поля:

```js
// src/models/User.js  (внутри userSchema)
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    // Пароль не обязателен: у аккаунтов, созданных через Google, его нет.
    passwordHash: {
        type: String,
        required: false
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true // обычные аккаунты без googleId не конфликтуют
    },
    authProviders: {
        type: [String],
        default: ['password']
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
```

Удалить старый отдельный блок `passwordHash` (строки 32-35).

**Шаг 2: Убедиться, что нигде не проверяется `required`**

```bash
git grep -n "passwordHash" -- src
```

Ожидается: только присваивания `bcrypt.hash(...)` и чтения; никаких проверок `.required`.

**Шаг 3: Коммит**

```bash
git add src/models/User.js
git commit -m "feat(auth): make passwordHash optional, add googleId/authProviders/emailVerified"
```

> Миграция: у существующих документов при чтении не будет `authProviders`; считайте отсутствие как вход по паролю. `googleId` — sparse, бэкфилл не нужен.

---

### Задача 3: Модуль проверки Google-токена (сначала тест)

**Файлы:**
- Создать: `src/auth/google.js`
- Создать: `tests/auth-google.test.js`

**Шаг 1: Написать падающий тест**

```js
// tests/auth-google.test.js
jest.mock('google-auth-library', () => {
    const verifyIdToken = jest.fn(async ({ idToken }) => {
        if (idToken === 'valid-token') {
            return { getPayload: () => ({
                sub: 'google-sub-123',
                email: 'NewUser@Gmail.com',
                email_verified: true,
                name: 'New User',
                picture: 'https://lh3.googleusercontent.com/a/pic'
            })};
        }
        if (idToken === 'unverified-token') {
            return { getPayload: () => ({
                sub: 'google-sub-456',
                email: 'unverified@gmail.com',
                email_verified: false,
                name: 'Unverified'
            })};
        }
        throw new Error('Invalid token signature');
    });
    return { OAuth2Client: jest.fn(() => ({ verifyIdToken })) };
});

describe('verifyGoogleIdToken', () => {
    const OLD = process.env.GOOGLE_CLIENT_ID;
    beforeAll(() => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; });
    afterAll(() => { process.env.GOOGLE_CLIENT_ID = OLD; });

    it('returns a normalized profile for a valid token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        const profile = await verifyGoogleIdToken('valid-token');
        expect(profile).toEqual({
            googleId: 'google-sub-123',
            email: 'newuser@gmail.com', // lowercased
            emailVerified: true,
            name: 'New User',
            picture: 'https://lh3.googleusercontent.com/a/pic'
        });
    });

    it('rejects an unverified email', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('unverified-token')).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('rejects a bad token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('garbage')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('throws when GOOGLE_CLIENT_ID is missing', async () => {
        const saved = process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_ID;
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('valid-token')).rejects.toThrow(/GOOGLE_CLIENT_ID/);
        process.env.GOOGLE_CLIENT_ID = saved;
    });
});
```

**Шаг 2: Запустить — убедиться, что падает**

```bash
npx jest tests/auth-google.test.js
```

Ожидается: `Cannot find module '../src/auth/google'`

**Шаг 3: Реализовать**

```js
// src/auth/google.js
const { OAuth2Client } = require('google-auth-library');

let client = null;
function getClient() {
    if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    return client;
}

function tokenError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/**
 * Проверяет ID token от Google Identity Services и возвращает нормализованный профиль.
 * Бросает ошибку с code: 'INVALID_TOKEN' | 'EMAIL_NOT_VERIFIED'.
 */
async function verifyGoogleIdToken(credential) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        throw new Error('GOOGLE_CLIENT_ID is not configured');
    }
    if (!credential || typeof credential !== 'string') {
        throw tokenError('INVALID_TOKEN', 'Missing credential');
    }

    let payload;
    try {
        const ticket = await getClient().verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
    } catch (err) {
        throw tokenError('INVALID_TOKEN', 'Invalid Google credential');
    }

    if (!payload || !payload.sub || !payload.email) {
        throw tokenError('INVALID_TOKEN', 'Invalid token payload');
    }
    if (!payload.email_verified) {
        throw tokenError('EMAIL_NOT_VERIFIED', 'Google email is not verified');
    }

    return {
        googleId: payload.sub,
        email: String(payload.email).toLowerCase(),
        emailVerified: true,
        name: payload.name || '',
        picture: payload.picture || ''
    };
}

module.exports = { verifyGoogleIdToken };
```

**Шаг 4: Запустить — убедиться, что проходит**

```bash
npx jest tests/auth-google.test.js
```

Ожидается: `Tests: 4 passed`

**Шаг 5: Коммит**

```bash
git add src/auth/google.js tests/auth-google.test.js
git commit -m "feat(auth): add verified Google ID-token parsing with tests"
```

---

### Задача 4: Публичный эндпоинт конфигурации аутентификации

**Файлы:**
- Изменить: `src/server.js` (после роута `/api/auth/me`, ~строка 289)
- Изменить: `tests/auth-google.test.js` (добавить suite)

**Шаг 1: Написать падающий тест** — дописать в `tests/auth-google.test.js`:

```js
// --- app-level tests (need the shared harness) ---
jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;
    const MockUser = jest.fn().mockImplementation((data) => {
        const user = {
            _id: String(nextId++),
            username: data.username,
            email: data.email || `${data.username}@test.com`,
            passwordHash: data.passwordHash,
            googleId: data.googleId,
            authProviders: data.authProviders || ['password'],
            emailVerified: Boolean(data.emailVerified),
            avatarUrl: data.avatarUrl || '',
            country: data.country || 'XX',
            banned: false,
            save: jest.fn().mockResolvedValue(true)
        };
        store.set(user.username, user);
        return user;
    });
    MockUser.findOne = jest.fn((query = {}) => {
        if (query.username) return store.get(query.username) || null;
        for (const u of store.values()) {
            if (query.email && u.email === query.email) return u;
            if (query.googleId && u.googleId === query.googleId) return u;
        }
        return null;
    });
    MockUser.findById = jest.fn((id) => ({
        select() {
            for (const u of store.values()) if (u._id === id) return Promise.resolve({ ...u });
            return Promise.resolve(null);
        }
    }));
    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = { _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) };
        store.set(user.username, user);
        return user;
    };
    return MockUser;
});
jest.mock('../src/models/GameResult', () => {
    const M = jest.fn(() => ({ save: jest.fn().mockResolvedValue(true) }));
    M.find = jest.fn().mockResolvedValue([]);
    M.findById = jest.fn().mockResolvedValue(null);
    return M;
});
jest.mock('../src/models/BotSettings', () => {
    const M = jest.fn();
    M.findOne = jest.fn().mockResolvedValue(null);
    M.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    return M;
});

const request = require('supertest');
const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

describe('POST /api/auth/google', () => {
    let app, User;
    beforeAll(async () => {
        jest.setTimeout(30000);
        await setupTestEnvironment();
        process.env.GOOGLE_CLIENT_ID = 'test-client-id';
        app = await getApp();
        User = require('../src/models/User');
    }, 30000);
    beforeEach(() => { jest.clearAllMocks(); User.__clearStore(); });
    afterAll(async () => { await teardownTestEnvironment(); });

    it('GET /api/auth/config returns the public client id and creates a session on valid token', async () => {
        const cfg = await request(app).get('/api/auth/config');
        expect(cfg.status).toBe(200);
        expect(cfg.body.googleClientId).toBe('test-client-id');

        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Logged in');
        expect(res.body.user.username).toBe('newuser');

        const me = await agent.get('/api/auth/me');
        expect(me.body.isAuthenticated).toBe(true);
        expect(me.body.user.googleId).toBe('google-sub-123');
    });

    it('links an existing password account by email', async () => {
        User.__seedUser({ _id: 'u1', username: 'existing', email: 'newuser@gmail.com' });
        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        const linked = await User.findOne({ email: 'newuser@gmail.com' });
        expect(linked.googleId).toBe('google-sub-123');
        expect(linked.authProviders).toContain('google');
    });

    it('rejects an unverified Google email with 400', async () => {
        const res = await request(app).post('/api/auth/google').send({ credential: 'unverified-token' });
        expect(res.status).toBe(400);
    });

    it('rejects a bad credential with 401', async () => {
        const res = await request(app).post('/api/auth/google').send({ credential: 'garbage' });
        expect(res.status).toBe(401);
    });

    it('rejects a missing credential with 401', async () => {
        const res = await request(app).post('/api/auth/google').send({});
        expect(res.status).toBe(401);
    });
});
```

**Шаг 2: Запустить — убедиться, что падает**

```bash
npx jest tests/auth-google.test.js
```

Ожидается: падения на `/api/auth/config` (404) и `/api/auth/google` (404).

**Шаг 3: Реализовать** — добавить `require` в начале `src/server.js` (около строки 16) и два роута после `/api/auth/me` (после строки 289):

```js
// src/server.js (top, with other requires)
const { verifyGoogleIdToken } = require('./auth/google');
```

```js
// src/server.js (after the /api/auth/me route)

// Публичный конфиг для клиента: какие внешние входы включены.
app.get('/api/auth/config', (req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// Собирает уникальное имя пользователя (3-20 симв.) из имени/почты Google.
async function generateUniqueUsername(email, name) {
    const base = String(name || email.split('@')[0] || 'player')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20) || 'player';
    let candidate = base.length >= 3 ? base : base.padEnd(3, '0');
    let n = 0;
    while (await User.findOne({ username: candidate })) {
        n += 1;
        const suffix = String(n);
        candidate = base.slice(0, 20 - suffix.length) + suffix;
    }
    return candidate;
}

// sign in with Google
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential } = req.body || {};
        let profile;
        try {
            profile = await verifyGoogleIdToken(credential);
        } catch (err) {
            if (err.code === 'EMAIL_NOT_VERIFIED') {
                return res.status(400).json({ error: 'Google email is not verified' });
            }
            return res.status(401).json({ error: 'Invalid Google credential' });
        }

        let user = await User.findOne({ googleId: profile.googleId });

        if (!user) {
            // Привязка к существующему аккаунту по email (Google подтвердил владение почтой).
            user = await User.findOne({ email: profile.email });
            if (user) {
                user.googleId = profile.googleId;
                if (!Array.isArray(user.authProviders)) user.authProviders = [];
                if (!user.authProviders.includes('google')) user.authProviders.push('google');
                user.emailVerified = true;
                await user.save();
            }
        }

        if (!user) {
            const username = await generateUniqueUsername(profile.email, profile.name);
            const country = detectCountry(getClientIp(req));
            user = new User({
                username,
                email: profile.email,
                googleId: profile.googleId,
                authProviders: ['google'],
                emailVerified: true,
                country,
                avatarUrl: profile.picture || undefined
            });
            await user.save();
        }

        const ban = await isUserBanned(user);
        if (ban.banned) {
            const expires = ban.expires ? ` until ${ban.expires.toISOString()}` : '';
            return res.status(403).json({
                error: `Account banned${expires}`,
                code: 'ACCOUNT_BANNED',
                reason: ban.reason,
                expires: ban.expires
            });
        }

        await ensureUserCountry(user, getClientIp(req));

        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.avatarUrl = user.avatarUrl;

        res.json({ message: 'Logged in', user: { username: user.username, id: user._id } });
    } catch (err) {
        console.error('[GOOGLE AUTH ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});
```

**Шаг 4: Запустить — убедиться, что проходит**

```bash
npx jest tests/auth-google.test.js
```

Ожидается: `Tests: 9 passed`

**Шаг 5: Коммит**

```bash
git add src/server.js tests/auth-google.test.js
git commit -m "feat(auth): add Google sign-in endpoint and public auth config"
```

---

### Задача 6: Разрешить хосты Google в CSP

**Файлы:**
- Изменить: `src/server.js:1272-1284`

**Шаг 1: Правка директив**

```js
app.use(helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://analytics.playquor.org", "https://static.cloudflareinsights.com", "https://cdn.jsdelivr.net", "https://accounts.google.com", "https://gsi.gstatic.com"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "https://ui-avatars.com", "https://*.googleusercontent.com"],
        "media-src": ["'self'", "data:", "blob:"],
        "frame-src": ["'self'", "https://accounts.google.com"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:", "https://cdn.socket.io", "https://analytics.playquor.org", "https://accounts.google.com"]
    }
}));
```

**Шаг 2: Проверить**

```bash
node --check src/server.js
```

Ожидается: пустой вывод (OK).

**Шаг 3: Коммит**

```bash
git add src/server.js
git commit -m "feat(auth): allow Google Identity Services hosts in CSP"
```

---

## Этап 2 — Фронтенд

> JS-тестов для браузера нет; эти задачи проверяются вручную.

### Задача 7: Добавить кнопку Google в `login.html`

**Файлы:**
- Изменить: `frontend/login.html` (head ~строка 11; форма после строки 48; записи dict; инлайн-скрипт перед строкой 209)

**Шаг 1: Добавить скрипт (head)**

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

**Шаг 2: Добавить разделитель + плейсхолдер кнопки** внутри `.auth-form-wrapper`, после `</form>` (строка 49) и перед `.auth-footer-links`:

```html
<div class="auth-divider"><span>or</span></div>
<div id="googleBtn" class="google-btn-slot"></div>
```

**Шаг 3: Добавить ключ dict** (`error_google`) в `ru` и `en`:

```js
ru: { /* ... */ error_google: 'Не удалось войти через Google' },
en: { /* ... */ error_google: 'Could not sign in with Google' },
```

**Шаг 4: Добавить логику** в инлайн-скрипт (перед `applyLang();`):

```js
function onGoogleCredential(response) {
    fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
    }).then(function(r) {
        return r.json().then(function(data) { return { status: r.status, data: data }; });
    }).then(function(resp) {
        if (resp.status === 200) {
            trackEvent('login-complete');
            window.location.href = '/';
        } else {
            showGlobalError(dict[getLang()].error_google);
        }
    }).catch(function() {
        showGlobalError(dict[getLang()].error_network);
    });
}

function initGoogleSignIn() {
    if (!window.google || !google.accounts || !google.accounts.id) {
        setTimeout(initGoogleSignIn, 200);
        return;
    }
    fetch('/api/auth/config').then(function(r) { return r.json(); }).then(function(cfg) {
        if (!cfg.googleClientId) return;
        google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential });
        var el = document.getElementById('googleBtn');
        if (el) google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', width: 320 });
    }).catch(function() { /* never block password login */ });
}

initGoogleSignIn();
```

**Шаг 5: Проверить вручную**

```bash
npm run dev
```

Открыть `http://localhost:3000/login`, убедиться, что кнопка Google отрисовывается и (с реальным `GOOGLE_CLIENT_ID`) вход завершается → редирект на `/`.

**Шаг 6: Коммит**

```bash
git add frontend/login.html
git commit -m "feat(auth): add Google sign-in button to login page"
```

---

### Задача 8: Добавить кнопку Google в `register.html`

**Файлы:**
- Изменить: `frontend/register.html`

Повторить Задачу 7 идентично (тег скрипта, `.auth-divider` + `<div id="googleBtn">`, ключи `error_google`, `onGoogleCredential`/`initGoogleSignIn`, вызов). Регистрация и вход используют один и тот же upsert, поэтому разницы на бэкенде нет.

**Проверка + Коммит**

```bash
npx cap copy android
git add frontend/register.html
git commit -m "feat(auth): add Google sign-in button to register page"
```

---

### Задача 9: Полная регрессия

**Шаг 1: Линт**

```bash
npm run lint
```

Ожидается: без **новых** ошибок (pre-existing 59 ошибок остаются; убедиться, что ни одна не ссылается на `src/auth/google.js`, `frontend/login.html` или новый роут).

**Шаг 2: Тесты**

```bash
npx jest
```

Ожидается: все наборы проходят, включая новый `tests/auth-google.test.js` (13 → 14 наборов).

**Шаг 3: Коммит исправлений линта** (только если нужно)

```bash
git add -A
git commit -m "chore(auth): lint fixes for Google sign-in"
```

---

## Этап 3 — Android / Capacitor (отдельно, зависит от Задач 1-9)

> GIS **не работает** внутри встроенного WebView (`disallowed_useragent`). Для Android нужен нативный поток. Держите это вне Этапа A.

**Предварительно (вручную):**
- [ ] Google Cloud → **Create OAuth Client ID → Android**: package name (`applicationId` в `android/app/build.gradle`) + SHA-1 ключа подписи (`cd android; ./gradlew signingReport`).
- [ ] Выбрать плагин: `@codetrix-studio/capacitor-google-auth` (сообщество) — проверить актуальность поддержки перед использованием.

**Задачи (набросок):**
1. `npm i @codetrix-studio/capacitor-google-auth` + `npx cap sync android` — коммит.
2. Добавить **Android** client id в `capacitor.config.json` в конфиг плагина.
3. В `frontend/js/` добавить небольшой `google-auth.js`, который на `Capacitor.isNativePlatform()` вызывает `GoogleAuth.signIn()` → `idToken` → `POST /api/auth/google { credential: idToken }` (тот же эндпоинт), затем перезагрузка на `/`.
4. Ограничить веб-функцию `initGoogleSignIn()` так, чтобы она выполнялась только в вебе.
5. Собрать и протестировать на реальном устройстве (нужны Play Services).

**Проверка:** вход на Android → `GET /api/auth/me` показывает `isAuthenticated: true` с `googleId`.

---

## Развёртывание и Env

- Добавить `GOOGLE_CLIENT_ID` в `.env`, прод-окружение и конфиг Cloudflare/хостинга. CI/тесты он не нужен (библиотека замокана).
- Скрипт миграции БД не требуется (sparse-индекс на `googleId`; `passwordHash` опционален).
- Существующие парольные аккаунты не затронуты; при первом входе через Google с совпадающим email они связываются (`authProviders += 'google'`).
