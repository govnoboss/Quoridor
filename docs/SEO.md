# SEO — PlayQuor

> Состояние, решения и реализация SEO-слоя. Аудит 2026-11-13, фаза 1 реализована в ветке `seo/phase1-404-og-sitemap`.

## 1. Архитектура раздачи контента

```
Cloudflare (proxy + Managed content-signal robots) → Caddy (reverse_proxy :3000) → Express → frontend/*.html
```

- **Файл истины для AI-ботов в robots.txt — Cloudflare**, а не репозиторий. Живой `robots.txt` содержит Cloudflare Managed content signals (`search=yes, ai-train=no, use=reference`) + `Disallow: /` для ~35 AI/тренинг-ботов. Репозитарный `frontend/robots.txt` — только `Allow: /` + sitemap. **При смене DNS/прокси настройку надо перенести вручную** (DEPLOY.md).
- Решение (2026-11-13): поисковые AI-боты (`OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`) должны быть разрешены; тренинговые — заблокированы. Требуется правка в CF-дашборде.

## 2. Реализованные механизмы (src/server.js)

| Механизм | Где | Поведение |
|---|---|---|
| Честный 404 | фолбэк `/{*path}` | `frontend/404.html`, статус 404; `/api/*` — JSON 404. Убирает soft-404 (раньше отдавался index.html со статусом 200) |
| OG-инъекция профилей | `/profiles/:username` | title/description/OG/canonical из БД (`renderIndexWithMeta`); пользователь не найден → 404. Профили **индексируются** (решение 2026-11-13) |
| Лобби noindex | `/lobby/:code` | `noindex, nofollow` + приглашающий сниппет «Join my Quoridor game» для Telegram/WhatsApp/Discord (они не исполняют JS) |
| Динамический sitemap | `/sitemap.xml` | статические страницы (lastmod = mtime файла) + топ-50 профилей (не боты/админы); кэш 1 ч; `clearSitemapCache()` экспортируется |
| Кэш статики | `express.static` | html/txt/xml — `max-age=300`; версионированные ассеты (`?v=`) — `max-age=31536000, immutable`. HTML-роуты (sendFile) — без Cache-Control, только ETag |
| noindex служебных | login/register | `noindex,follow`; из sitemap не входят (как и /forgot-password, /reset-password, /report, /profile/reports, /replay/:id — noindex уже был) |

## 3. Структурированные данные и мета

- `/` — `WebApplication` (installUrl Google Play, offers 0), `/rules` — `HowTo`, `/faq` — `FAQPage` (7 вопросов).
- OG-теги есть на `/`, `/rules`, `/faq`; **нет** на `/leaderboard` (TODO фаза 4).
- `og-image.jpg` — 97 KB, версионируется параметром `?v=`.

## 4. Известные ограничения / TODO (фазы 2–5)

1. **Битые внутренние ссылки** `/strategy` и `/multiplayer` в `faq.html` (строки 183–184, 246–247) — страниц нет, сейчас честный 404. Создать страницы (фаза 4).
2. **RU-версия**: на `/rules` и `/faq` RU-контент уже в HTML (`lang-block`), но на одном URL с EN и дублированным `<h1>`. Решение (2026-11-13): отдельные `/ru/`, `/ru/rules`, `/ru/faq` + hreflang en↔ru + x-default. Главная — JS-only i18n (`data-i18n`), для RU-лендинга нужен статический hero-блок.
3. **OG-теги на `/leaderboard`** + `og:image:width/height`, `twitter:site`.
4. **JSON-LD**: `VideoGame`-тип, BreadcrumbList на rules/faq/strategy.
5. **Подача в вебмастера**: Google Search Console, Bing Webmaster (+IndexNow), Яндекс.Вебмастер — требуют аккаунтов.
6. **Бэклинки/ASO** (фаза 5): BGG, Reddit r/boardgames + r/abstractgames, Wikipedia External links, каталоги, Product Hunt; обратная ссылка из Google Play-листинга.
7. Проверить рендер Googlebot после деплоя: GSC URL Inspection → View rendered page.

## 5. Проверки, сделанные живьём (2026-11-13, до фазы 1)

- `/`, `/profiles/test`, `/lobby/ABC123`, несуществующий путь — все 200 с метаданными главной (soft-404) → исправлено фазой 1.
- `/admin` — 401 JSON (норм).
- Заголовки: HSTS preload, CSP, `server: cloudflare`, `via: 1.1 Caddy`; `X-Robots-Tag` не установлен.
