# Карта для FreakRating

Список «Кто где» сверху, объёмная карта снизу с зазором от хотбара.

## Файлы

| Файл | Куда положить |
|---|---|
| `mods/map.js` | в папку `mods` рядом со `start.bat` |

`map.js` пишет настройку в `localStorage` (`freakland:world-map`: `view: iso`, `tab: bottom`, `bottom: 0.55`) и при первом запуске один раз перезагружает страницу.

## Установка

1. Скачай `mods/map.js`.
2. Положи в `FreakRating-Clean\mods\map.js`.
3. Запусти `start.bat` — один раз произойдёт перезагрузка, это нормально.

## Для сборки из исходников (по желанию)

- `src/main/main.ts` → `patchMapSize()` — ограничивает ширину карты 1240 px;
- `src/preload/preload.ts` → `setupOldMapLayout()`, `liftMapOffHotbar()`.

В чистой сборке эти куски убраны — карта работает через настройку в `mods/map.js`.

Чтобы выключить карту — удали `map.js` и сбрось в профиле `freakland:world-map` → `tab: "off"` (в чистой сборке это делается автоматически).
