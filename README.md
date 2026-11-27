# Карта

Список «Кто где» сверху, объёмная карта снизу.

## Все файлы мода

| Файл в репозитории | Куда ставить |
|---|---|
| `mods/map.js` | `FreakRating-Clean\mods\map.js` |
| `client/src/main/main.ts` | `patchMapSize()` — ширина карты 1240 px |
| `client/src/preload/preload.ts` | `setupOldMapLayout()`, `liftMapOffHotbar()` |

## Установка

Простая: скачай `map.js` → положи в `mods` → `start.bat` (один раз перезагрузится страница).
Полная: скопируй `client\` в корень клиента и пересобери.

Чтобы выключить карту — удали `map.js` и сбрось в профиле `freakland:world-map` → `tab: "off"`.
