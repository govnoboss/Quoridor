# SEO Next Steps — план для следующего агента

> **Назначение:** этот файл — рабочая очередь SEO-доработки PlayQuor. Фаза 1 уже реализована и задеплоена (коммит `76746c1` в `main`, ветка `seo/phase1-404-og-sitemap` сохранена для отката). Читай вместе с `docs/SEO.md` (состояние и реализованные механизмы) и `docs/AI_CONTEXT.md`.
> **Дата плана:** 2026-11-13. Все решения ниже подтверждены владельцем проекта.

## 0. Контекст: что уже сделано (не переделывать)

- Честный 404 (`frontend/404.html`, статус 404) — soft-404 фолбэк убран (`src/server.js`, фолбэк `/{*path}`).
- Серверная инъекция мета-тегов: `/profiles/:username` — индексируемый с собственными title/description/OG/canonical; `/lobby/:code` — `noindex, nofollow` + сниппет «Join my Quoridor game» (см. `renderIndexWithMeta` в `src/server.js`, SEO-секция).
- Динамический `GET /sitemap.xml` (статические страницы + lastmod из mtime + топ-50 профилей; кэш 1 ч; `frontend/sitemap.xml` удалён).
- Кэш статики: html/txt/xml `max-age=300`, версионные ассеты `max-age=31536000, immutable` (`src/server.js`, `express.static` setHeaders).
- `login.html`/`register.html` — `noindex,follow`.
- Тесты: блок `describe('SEO routes')` в `tests/server-api.test.js` (мок `User.find` поддерживает `$ne`/`$gt`/`$gte`/`$lt` через `matchCond`).

## 1. Принятые решения (менять только с владельцем)

1. Публичные профили игроков — **индексируются**.
2. Русская версия — **отдельные URL** (`/ru`, `/ru/rules`, `/ru/faq`) + hreflang, а не один URL с JS-переключением.
3. AI-поисковые боты (OAI-SearchBot, PerplexityBot, Claude-SearchBot) — **разрешить**; тренинговые (GPTBot, ClaudeBot и пр.) — оставить заблокированными.

## 2. Очередь задач

### Фаза A — вручную владельцем (без кода) → см. §3 за пошаговыми инструкциями

- [ ] **A1. Cloudflare:** разрешить AI-Search, держать блок на Training (+ решить про Agent).
- [ ] **A2. Google Search Console:** подтвердить домен, подать sitemap, проверить рендеринг URL.
- [ ] **A3. Bing Webmaster Tools:** импорт из GSC, sitemap, включить IndexNow.
- [ ] **A4. Яндекс.Вебмастер:** подтвердить домен, sitemap.
- [ ] **A5.** Через 1–2 недели: в GSC проверить отчёты Pages (soft-404 должны уйти), индексацию профилей.

### Фаза B — IndexNow пинг (код, ~S)

Bing/Яндекс/Seznam принимают уведомления об изменениях через IndexNow.

1. Сгенерировать ключ: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.
2. Раздать файл ключа: роут или статический файл `frontend/<KEY>.txt` с содержимым = ключ. Вариант в стиле репо — отдельный роут в `src/server.js` рядом с `/sitemap.xml`.
3. Пинг после деплоя/изменения страниц: `GET https://api.indexnow.org/indexnow?url=https%3A%2F%2Fplayquor.org%2F&key=<KEY>&keyLocation=https%3A%2F%2Fplayquor.org%2F<KEY>.txt`.
4. Ключ хранить в `.env` (`INDEXNOW_KEY`), НЕ коммитить сам ключ в доки (см. AGENTS.md правило о секретах; файл-заглушку в frontend/ генерирует владелец или деплой-скрипт).
5. Приёмка: ключ-файл доступен по HTTPS, пинг возвращает 200/202.

### Фаза C — RU-версия (код, ~M; контент уже написан)

RU-тексты уже есть в сыром HTML: `frontend/rules.html` (блок `<div id="content-ru" class="lang-block">`, строки ~236+) и `frontend/faq.html` (аналогично). План:

1. Роуты `/ru`, `/ru/rules`, `/ru/faq` в `src/server.js` (рядом с `/rules`//`/faq`, до фолбэка) + файлы `frontend/ru/index.html`, `frontend/ru/rules.html`, `frontend/ru/faq.html` (собрать из готовых lang-block'ов; `<html lang="ru">`).
2. Уникальные RU title/description/OG под рунет-запросы («коридор настольная игра онлайн», «правила игры коридор», «коридор играть онлайн»); canonical на `https://playquor.org/ru/...`.
3. hreflang: на каждой EN-странице и RU-странице пары `en`/`ru` + `x-default` (EN). Пример для `/rules`:
   `<link rel="alternate" hreflang="en" href="https://playquor.org/rules" />`
   `<link rel="alternate" hreflang="ru" href="https://playquor.org/ru/rules" />`
   `<link rel="alternate" hreflang="x-default" href="https://playquor.org/rules" />`
4. На EN `/rules`//`/faq` удалить RU lang-block (контент уезжает на `/ru/...`) — убрать дублированный второй `<h1>` («Правила игры Коридор»).
5. RU-лендинг `/ru`: статический hero-блок в HTML (заголовок «Коридор онлайн», lead, кнопка «Играть», ссылки на правила) — главная остаётся JS-only (`data-i18n`), RU-посадочная должна быть краулер-видимой.
6. Перелинковка: в шапках RU-страниц ссылки `/ru/rules` ↔ `/ru/faq` ↔ `/ru`; из EN-шапки — hreflang решает.
7. `frontend/sitemap.xml` уже не существует; добавить RU-страницы в динамический sitemap (`SEO_STATIC_PAGES` в `src/server.js`).
8. Правила репо: RU-страницы не должны ломать язык у JS-приложения (проверить `frontend/js/site-shell.js` `getLang()`).
9. Приёмка: `GET /ru/rules` → 200, lang="ru", hreflang-пары на обеих версиях, в `tests/server-api.test.js` добавить тесты по образцу SEO-блока.

### Фаза D — контент и сниппеты (код, ~M)

1. **`/strategy` и `/multiplayer`** — реальные страницы: в `frontend/faq.html` уже стоят ссылки на них (строки 183–184 EN-блок, 246–247 RU-блок) и они отдают 404. Создать `frontend/strategy.html`, `frontend/multiplayer.html` + роуты + запись в `SEO_STATIC_PAGES`. Темы: стратегия и тактика Quoridor (уникальный контент: можно опираться на `quoridor-engine/engines/v3` и данные ботов), мультиплеер/режимы/тайм-контролы.
2. **OG-теги на `frontend/leaderboard.html`** (сейчас только canonical): og:title/description/url/image/site_name + twitter:card. Для «вишенки» страницы — сгенерировать OG-картинку с топ-3 игроками — опционально.
3. **JSON-LD главной:** добавить `"@type": ["WebApplication", "VideoGame"]`, `genre: "Board game"`, позже `aggregateRating` только при наличии честных отзывов из Google Play.
4. **BreadcrumbList** на rules/faq/strategy/multiplayer (`Home > Rules` и т.д.).
5. **og:image:width/height** (og-image.jpg — 1200x630? проверить размеры) + `twitter:site` (аккаунт: YouTube-канал @playquor1 существует; уточнить X/Twitter-хэндл у владельца).
6. Приёмка: Rich Results Test / валидатор schema.org без ошибок; тесты маршрутов обновлены.

### Фаза E — офсайт/витрина (маркетинг, вручную владельцем)

- Backlinks: BoardGameGeek (страница Quoridor — External links/софт), Reddit r/boardgames + r/abstractgames (пост-презентация), Wikipedia-статья Quoridor (External links — только если пройдёт нотабилити), каталоги онлайн-настолок, Product Hunt, itch.io.
- ASO: Google Play-листинг org.playquor.app — название/описание под «quoridor online», скриншоты; **обратная ссылка** из листинга на playquor.org.
- Арена ботов: если владельец решит публиковать рейтинг ботов (`quoridor-engine/arena/`) — публичная страница «сильнейшие Quoridor-боты» = магнит для бэклинков (обсудить с владельцем).

## 3. Пошаговые инструкции для владельца (Фаза A)

### A1. Cloudflare — разрешить AI-поисковых ботов

1. Войти в Cloudflare → выбрать зону **playquor.org**.
2. Слева: **Security → Settings** (или **Bots** → зависит от версии панели) → раздел **Bot traffic** → кнопка/блок **AI Crawler and Agent access policies**.
3. Там три категории (с 15.09.2026 старый тумблер «Block AI Bots» разделён):
   - **AI Search** (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Applebot и т.п.) → **Allow**.
   - **AI Agent** (агентские клиенты) → по желанию; по умолчанию безопаснее Block (решить с владельцем).
   - **AI Training** (GPTBot, ClaudeBot, Bytespider, Google-Extended и пр.) → **Block** (оставить как есть).
4. Проверить **Managed robots.txt**: Security → Settings → Bot traffic → *Managed robots.txt* — там тот же сигнал `search=yes, ai-train=no, use=reference`. Ничего в репо править не нужно: файл истины — Cloudflare (задокументировано в `docs/SEO.md`).
5. **Важно:** после изменения убедиться, что Googlebot/Bingbot не заблокированы (Cloudflare с 15.09.2026 может применять блоки шире) — проверить живой ответ:
   `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1)" -I https://playquor.org/` → ожидается 200, не 403.
6. Проверка результата: `curl -A "OAI-SearchBot" -I https://playquor.org/rules` → 200 (не 403).

### A2. Google Search Console

1. Открыть [search.google.com/search-console](https://search.google.com/search-console) → Add property → **Domain** → ввести `playquor.org`.
2. Верификация DNS TXT: GSC покажет запись вида `google-site-verification=...`; добавить её в Cloudflare (DNS → Records → Add record → Type TXT, Name `@`, Content = значение) → Verify.
3. **Sitemaps** (левое меню) → ввести `https://playquor.org/sitemap.xml` → Submit.
4. **URL Inspection** (сверху): ввести `https://playquor.org/`, «Test Live URL» → затем **View tested page → HTML** — убедиться, что боты видят нормальный HTML; затем «Request indexing» для `/`, `/rules`, `/faq`, `/leaderboard` и пары профилей из sitemap.
5. Через 1–2 недели: отчёт **Pages** — soft-404 от старого фолбэка должны исчезнуть, профили — появиться в «Indexed».

### A3. Bing Webmaster Tools (+ IndexNow)

1. Открыть [bing.com/webmasters](https://www.bing.com/webmasters) → **Import from Google Search Console** (самый быстрый путь: тянет подтверждение и данные) или верифицировать XML-файлом/CNAME.
2. **Sitemaps** → Submit `https://playquor.org/sitemap.xml`.
3. **IndexNow**: в Bing WMT → IndexNow (левое меню) → Generate API key. Bing покажет ключ — файл `<KEY>.txt` нужно положить в корень сайта (`https://playquor.org/<KEY>.txt` с содержимым = ключ). Положить файл в `frontend/` (он раздаётся express.static; HTML/txt кэш 5 мин — это ок) и задеплоить, затем нажать Verify в Bing.
4. После верификации Bing сам пингует по sitemap; для мгновенного пинга — см. Фазу B (IndexNow в коде).
5. Яндекс тоже понимает IndexNow — один ключ работает на обе системы (api.indexnow.org).

### A4. Яндекс.Вебмастер

1. Открыть [webmaster.yandex.ru](https://webmaster.yandex.ru) → «+» → добавить `https://playquor.org/`.
2. Верификация: рекомендованный способ — DNS-запись (домен в Cloudflare, TXT-запись как в A2) или meta-тег в `frontend/index.html`.
3. **Индексирование → Файлы Sitemap** → добавить `https://playquor.org/sitemap.xml`.
4. **Индексирование → Переобход страниц** — отправить `/`, `/rules`, `/faq`, `/leaderboard`.
5. После фазы C (RU-страницы) добавить `/ru`, `/ru/rules`, `/ru/faq` — Яндекс даст основную RU-видимость; RU-статика для него особенно важна (Яндекс исполняет JS хуже Google).

## 4. Чек-лист приёмки после следующих деплоев

```bash
# 404, а не страница главной
curl -s -o /dev/null -w "%{http_code}" https://playquor.org/nonexistent-xyz      # 404

# sitemap жив и содержит профили
curl -s https://playquor.org/sitemap.xml | grep -c "/profiles/"                  # > 0

# лобби noindex
curl -s https://playquor.org/lobby/AB2CD | grep -o 'noindex, nofollow'           # найдено

# профиль с OG
curl -s https://playquor.org/profiles/Aoi | grep -o 'Player Profile'             # найдено

# Googlebot не заблокирован Cloudflare
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1)" -o /dev/null -w "%{http_code}" https://playquor.org/  # 200
```

Тесты: `npm run test:once` (273+ тестов), lint: `npm run lint` (2 предсуществующие ошибки в `src/server.js` — валидация bio/avatar URL, не трогать).

## 5. Откат фазы 1

Ветка `seo/phase1-404-og-sitemap` — точка до изменений. Откат: на VPS `cd /opt/quoridor && git checkout 6a1ee39 && bash deploy.sh` (вернёт и удалит поведение фолбэка; файл `frontend/sitemap.xml` вернётся — роут `/sitemap.xml` в старом коде отсутствует, конфликтов нет).
