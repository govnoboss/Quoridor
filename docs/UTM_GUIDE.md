# UTM-разметка PlayQuor

> Практический гайд для постов, профилей и рассылок. Техническая сторона — в `docs/AI_FRONTEND.md` §6.
> Umami (`analytics.playquor.org`) парсит метки с лендинга автоматически, отдельной настройки не нужно.

## Правила

1. Всё в нижнем регистре, без пробелов, через дефис: `utm_campaign=quoridor-rules-post`.
   Иначе `telegram` и `telegram ` (или `Telegram`) посчитаются разными источниками.
2. Метки ставьте на корень `https://playquor.org/`: глубокие ссылки `/lobby/...`
   теряют query при SPA-навигации (история через `pushState`).
3. Три метки достаточно: `utm_source` (где), `utm_medium` (тип канала), `utm_campaign` (что именно).
4. Не вешайте UTM на внутренние ссылки сайта — они перезапишут настоящий источник трафика.
5. Значения кампаний фиксированные: одно и то же название кампании = одно и то же мероприятие
   (пост, турнир, рассылка). Заведённую кампанию не переименовывать — история в Umami не склеится.
6. Редиректы сервера сохраняют query (`/play`, `/how-to-play`), но браузеры кешируют 301 —
   для рекламных ссылок всегда используйте корень `/`.

## Таблица значений

| Канал | utm_source | utm_medium | Примеры utm_campaign |
|---|---|---|---|
| Пост в Telegram-канале | `telegram` | `social` | `launch-oct`, `tournament-1` |
| Чат/группа Telegram | `telegram-chat` | `social` | `friends-share` |
| Reddit | `reddit` | `social` | `r-boardgames-post` |
| VK | `vk` | `social` | `release-notes` |
| YouTube описание | `youtube` | `video` | `gameplay-1` |
| Подпись в профиле/био | `profile-bio` | `referral` | `permanent` |
| Каталоги игр, списки | название-сайта (`indiedb`, `itchio`, …) | `directory` | `listing` |
| Реклама (если будет) | `yandex-direct` | `cpc` | `quoridor-search` |
| Письмо/рассылка | `email` | `email` | `newsletter-nov` |
| Google Play (описание в сторе) | `play-store` | `app-listing` | `android` |

## Примеры ссылок

```
https://playquor.org/?utm_source=telegram&utm_medium=social&utm_campaign=tournament-1
https://playquor.org/?utm_source=reddit&utm_medium=social&utm_campaign=r-boardgames-post
https://playquor.org/?utm_source=youtube&utm_medium=video&utm_campaign=gameplay-1
https://playquor.org/?utm_source=profile-bio&utm_medium=referral&utm_campaign=permanent
https://playquor.org/?utm_source=email&utm_medium=email&utm_campaign=newsletter-nov
```

## Как проверить, что метка сработала

1. Разместить ссылку и открыть её в инкогнито (мобильный тоже, если аудитория мобильная).
2. Убедиться, что адресная строка осталась с query (ничего не редиректнуло метки).
3. В Umami UI → **Reports** → раздел с трафиком: у визита с этой метки в свойствах сессии
   появятся `utm_source/utm_medium/utm_campaign` (или в группировках по кампаниям, когда
   наберётся трафик).
4. Объединить с событиями воронки: у того же посетителя должны прийти `session-start`,
   `screen-view: menu`, затем `play-*-click` → `game-started`.

## Не смешивать

- `utm_medium` из таблицы — часть схемы; новые значения добавлять сюда же, одним коммитом в этот файл.
- Android-приложение и прямой трафик меток не имеют — это отдельные срезы (`direct/none`, платформа `android`).
