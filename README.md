# PRONAĐI SVOJ PLES ✨

Мобильная онлайн-форма для Instagram **PROAM dance Serbia**: пользователь отвечает на 8 вопросов + контакты,
ответы падают в Google Sheets, подбор школы/тренера делается вручную.

- `index.html` — вся форма (один файл, без сборки и зависимостей)
- `apps-script/Code.gs` — приём заявок в Google Sheets
- `assets/` — логотип

## 1. Google Sheets (5 минут)

1. Создай новую таблицу на [sheets.new](https://sheets.new), назови, например, `PROAM — Leads`.
2. **Extensions → Apps Script**, удали пример и вставь содержимое `apps-script/Code.gs`.
3. Сверху выбери функцию **`setupSheet`** → **Run** → разреши доступ (Google предупредит, что скрипт
   не проверен: *Advanced → Go to project (unsafe)*). В таблице появится лист **Leads** с колонками:

   `Date | Name | IG | Email | Phone | Language | Direction | Format | Level | Goal | Location | Time | Frequency | Priorities | Source | Status | Notes`

   В колонке `Status` — выпадающий список: **New → Reviewed → Recommendation sent → Connected** (с цветовой подсветкой).
4. **Deploy → New deployment → тип Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** ← обязательно, иначе форма не сможет писать
   - **Deploy** → скопируй URL вида `https://script.google.com/macros/s/AKfy.../exec`

> Хочешь письмо на каждую заявку — впиши адрес в `NOTIFY_EMAIL` в начале скрипта.

## 2. Подключить форму

В `index.html`, в самом начале блока `<script>`:

```js
const CONFIG = {
  ENDPOINT: "https://script.google.com/macros/s/.../exec",  // ← сюда URL из шага 1.4
  INSTAGRAM: "proam.dance.rs"                               // ← проверь handle, или оставь ""
};
```

Проверить, что скрипт живой: открой ENDPOINT в браузере — должно ответить `{"ok":true,...}`.

## 3. Публикация (GitHub Pages)

```bash
git add . && git commit -m "Pronadji svoj ples form" && git push
```

Затем в репозитории: **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save**.
Через ~1 минуту форма доступна по адресу
`https://<username>.github.io/Pro-Am-Dance-RS-Form/` — эту ссылку и кладём в шапку Instagram / в Stories.

Альтернативы без Git: перетащить папку на [netlify.com/drop](https://app.netlify.com/drop) или `vercel deploy`.

### Метки источника

К ссылке можно добавить `?src=...` — значение попадёт в колонку `Source`:
`...github.io/Pro-Am-Dance-RS-Form/?src=stories`, `?src=bio`, `?src=reels`.

## Что уже учтено

- **Языки**: сербский и русский, переключатель SRB/RUS в шапке на любом шаге; выбор запоминается.
  В таблицу ответы всегда пишутся **по-сербски**, язык пользователя — в колонке `Language`.
- **Один вопрос на экран**, автопереход после выбора, прогресс-бар, кнопка «назад» + системная кнопка «назад» на Android.
- **Мультивыбор** для целей, района, времени и приоритетов; варианты «Lokacija mi nije važna» и
  «Fleksibilan/na sam» сбрасывают остальные.
- «Drugo» в первом вопросе открывает поле для короткого текста → в таблицу пишется как `Drugo: <текст>`.
- **Обязательны только Name + Instagram**; email и телефон — опционально.
- Черновик хранится в localStorage 1 час — случайный выход из in-app браузера Instagram не теряет ответы.
- Отправка через `fetch` + резервный `form POST` в скрытый iframe (нужно для in-app браузеров Instagram/TikTok).

## Защита от спама

Адрес приёмника виден в коде страницы, поэтому в форму встроены три фильтра — заявка отбрасывается, если:

- заполнено скрытое поле-ловушка `Website` (человек его не видит, бот заполняет всё подряд);
- не совпал `TOKEN` — прямой POST по одному лишь URL эндпоинта не пройдёт;
- форма заполнена быстрее `MIN_SECONDS` (6 секунд) или это дубль той же заявки в пределах 10 минут.

Отклонённые заявки не теряются: они пишутся на отдельный лист **Blocked** с причиной — если фильтр
однажды отсечёт живого человека, это будет видно. Пороги правятся в начале `Code.gs`.
`TOKEN` в `Code.gs` и `CONFIG.TOKEN` в `index.html` должны совпадать.

## Локальная проверка

```bash
python3 -m http.server 8000
```

и открыть `http://localhost:8000`. Без `ENDPOINT` форма работает целиком, но данные не отправляются —
payload пишется в консоль браузера.

## Как менять вопросы

Все вопросы — в массиве `QUESTIONS` в `index.html`. Один вопрос:

```js
{
  key:"level", col:"Level", multi:false,          // multi:true → мультивыбор
  title:{sr:"Tvoj nivo?", ru:"Твой уровень?"},
  options:[ O("Početnik","Начинающий"), ... ]     // O(сербский, русский)
}
```

Флаги у варианта: `{other:true}` — открыть текстовое поле, `{exclusive:true}` — сбрасывает остальные.
Если добавляешь новый вопрос — добавь одноимённую колонку в `HEADERS` в `Code.gs` и поле в `appendRow`.
