// window.freakClient — узкое API клиента для страницы мира. Контракт: docs/API.md.
// Preload работает в sandbox: только `electron`, никаких своих модулей.
import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron"

const API_VERSION = 1

// Трафарет ставим ДО скриптов игры: иначе её window-capture слушатель
// вызовет stopImmediatePropagation() и Shift+Y не сработает.
try {
  const src = ipcRenderer.sendSync("fc:stencil-source") as string | null
  console.info("[stencil] preload source", typeof src, src ? src.length : 0)
  if (src) webFrame.executeJavaScript(src + "\n;0").then(
    () => console.info("[stencil] preload injected"),
    (err) => console.warn("[stencil] preload error", err),
  )
} catch (err) { console.warn("[stencil] preload catch", err) }

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  if (typeof cb !== "function") throw new TypeError("callback must be a function")
  const listener = (_e: IpcRendererEvent, payload: T) => {
    try {
      cb(payload)
    } catch (err) {
      console.error("[freakClient]", channel, err)
    }
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Событие о восстановлении приходит на did-finish-load — страница могла ещё не
// подписаться. Запоминаем и отдаём при подписке.
let lastRecovery: unknown = null
ipcRenderer.on("fc:crashRecovered", (_e, payload) => {
  lastRecovery = payload
})

function onCrashRecovered(cb: (info: unknown) => void): Unsubscribe {
  const unsubscribe = subscribe("fc:crashRecovered", cb)
  if (lastRecovery) {
    const payload = lastRecovery
    queueMicrotask(() => cb(payload))
  }
  return unsubscribe
}

// Окно свёрнуто или спрятано. Страница могла подписаться позже события — отдаём
// последнее «спрятано» при подписке.
let windowHidden = false
ipcRenderer.on("fc:windowVisibility", (_e, hidden: boolean) => {
  windowHidden = hidden === true
})

function onWindowVisibility(cb: (hidden: boolean) => void): Unsubscribe {
  const unsubscribe = subscribe("fc:windowVisibility", cb)
  if (windowHidden) queueMicrotask(() => cb(true))
  return unsubscribe
}

const info = ipcRenderer.sendSync("fc:info") as { clientVersion: string; platform: string; screenAudio: string }

const api = {
  apiVersion: API_VERSION,
  clientVersion: info.clientVersion,
  platform: info.platform,

  /** Esc даёт странице пользовательскую активацию: после него можно снова захватить мышь. */
  escapeGesture: true,

  /** Рация глобальной клавишей: "down" — нажали, "up" — отпустили. */
  onPtt: (cb: (state: "down" | "up") => void): Unsubscribe => subscribe("fc:ptt", cb),

  /** Мир перезагружен после падения GPU/страницы. */
  onCrashRecovered,

  /** Окно свернули или спрятали (`true`) и вернули (`false`): не рисовать кадры, пока не видно. */
  onWindowVisibility,

  /** Настройки клиента поменялись (игрок что-то переключил в окне настроек). */
  onSettingsChanged: (cb: (settings: unknown) => void): Unsubscribe => subscribe("fc:settingsChanged", cb),

  /** Статус в Discord; null — убрать. */
  setPresence: (presence: unknown): void => ipcRenderer.send("fc:setPresence", presence ?? null),

  getDiagnostics: (): Promise<unknown> => ipcRenderer.invoke("fc:getDiagnostics"),

  getSettings: (): Promise<unknown> => ipcRenderer.invoke("fc:getSettings"),

  /** Сохранить графический бэкенд; применится после relaunch(). */
  setGraphicsBackend: (backend: string): Promise<unknown> => ipcRenderer.invoke("fc:setGraphicsBackend", backend),

  /** Перезапустить клиент (после смены бэкенда). Вернёт мир на тот же адрес. */
  relaunch: (): Promise<void> => ipcRenderer.invoke("fc:relaunch"),

  /** Открыть окно настроек клиента. */
  openSettings: (): Promise<void> => ipcRenderer.invoke("fc:openSettings"),

  /** Нажать клавишу от имени клиента (доверенное событие для модов). */
  pressKey: (keyCode: string): Promise<boolean> => ipcRenderer.invoke("fc:press-key", keyCode),

  /**
   * Показ экрана: getDisplayMedia работает, звук — `screenAudio`:
   * "loopback" — уже в дорожке getDisplayMedia, "virtual-mic" — взять startScreenAudio, "none" — нет.
   */
  screenShare: true,
  screenAudio: info.screenAudio,

  /** Linux: свести звук программ (кроме клиента) в микрофон; его метка для getUserMedia или null. */
  startScreenAudio: (): Promise<{ deviceLabel: string } | null> => ipcRenderer.invoke("fc:startScreenAudio"),

  stopScreenAudio: (): Promise<void> => ipcRenderer.invoke("fc:stopScreenAudio"),
}

contextBridge.exposeInMainWorld("freakClient", Object.freeze(api))

// ---------- встроенный DJ ----------
// Раньше это был userscript для Tampermonkey. В клиенте код DJ лежит в dj/ и отдаётся главным
// процессом; в страницу он попадает через webFrame.executeJavaScript (главный мир, мимо CSP сайта).
// Сеть (семплы, alphaTab) — тоже через главный процесс: у страницы мира CORS закрыт.
// Страницу /world главный процесс определяет сам; на других страницах и при выключенном DJ вернёт null.

const toArrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** Запуск HUD в главном мире. Всё, что не клонируется (объект HUD), наружу не возвращаем. */
const DJ_START = `(async () => {
  const h = window.__freakDJHost
  if (!h || !window.FreakDJ) return
  const bin = async (u) => {
    const b = await h.loadBinary(u)
    return b instanceof ArrayBuffer ? b : new Uint8Array(b).buffer
  }
  await window.FreakDJ.start({
    loadText: h.loadText,
    loadBinary: bin,
    libBase: h.libBase,
    hooks: window.FreakDJHooks,
    listSongs: h.listSongs,
    loadConverter: async () => { await h.loadConverter(); return window.FreakDJConvert },
  })
})()`

function setupDj(): void {
  const init = ipcRenderer.sendSync("fc:dj:init") as { hook: string } | null
  if (!init) return

  const source = (name: "hud" | "player" | "converter") => ipcRenderer.invoke("fc:dj:source", name) as Promise<string | null>
  let converter: Promise<void> | null = null

  contextBridge.exposeInMainWorld(
    "__freakDJHost",
    Object.freeze({
      libBase: "freakdj://lib/",
      loadText: (url: string): Promise<string> => ipcRenderer.invoke("fc:dj:text", String(url)),
      loadBinary: async (url: string): Promise<ArrayBuffer> =>
        toArrayBuffer(await (ipcRenderer.invoke("fc:dj:bytes", String(url)) as Promise<Uint8Array>)),
      listSongs: (): Promise<Array<{ file: string; url: string }>> => ipcRenderer.invoke("fc:dj:songs"),
      // Конвертер GP: `var FreakDJConvert` становится глобальной переменной мира.
      loadConverter: (): Promise<void> =>
        (converter ||= source("converter").then(async (code) => {
          if (!code) throw new Error("конвертер недоступен")
          await webFrame.executeJavaScript(`${code}\n;0`)
        })),
    }),
  )

  // Перехват голоса — до кода игры, иначе отправитель микрофона уже создан и его не видно.
  void webFrame.executeJavaScript(`${init.hook}\n;0`).catch((err) => console.error("[FreakRating DJ] hook", err))

  const boot = async (): Promise<void> => {
    try {
      const hud = await source("hud")
      if (!hud) return
      await webFrame.executeJavaScript(`${hud}\n;0`)
      await webFrame.executeJavaScript(DJ_START)
    } catch (err) {
      console.error("[FreakRating DJ] HUD", err)
      return
    }
    try {
      const player = await source("player")
      if (!player) return
      // Игра на игровой гитаре (ноты, ритм-игра). Как в userscript: ставим, если ещё не стоит.
      await webFrame.executeJavaScript(`(async () => {
        if (window.guitarPlayer) return
        try {
          const __p = ${player}
          ;await __p
        } catch (e) { console.error('[FreakRating DJ] player', e) }
      })()`)
    } catch (err) {
      console.error("[FreakRating DJ] player", err)
    }
  }
  // HUD (131 КБ) и гитара — самые тяжёлые куски старта. Voice-hook уже стоит,
  // а остальное подключаем после того, как мир отрисовался. Если DJ нужен сразу —
  // window.__freakDJBoot() из консоли или по первому действию в DJ.
  let booted = false
  const startBoot = () => { if (!booted) { booted = true; void boot() } }
  ;(window as any).__freakDJBoot = startBoot
  // Грузим HUD, только когда главный поток свободен: фиксированный таймер
  // создавал заметный лаг ровно в момент загрузки.
  const scheduleBoot = () => {
    const run = () => setTimeout(startBoot, 1500)
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    if (typeof idle === "function") idle(run, { timeout: 30000 })
    else setTimeout(run, 8000)
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", scheduleBoot, { once: true })
  else scheduleBoot()
}

/** Греем HTTP-кэш чанков карты, чтобы 3D-карта по M открывалась быстрее. */
function prefetchMap(): void {
  const run = () => {
    if (!location.pathname.startsWith('/world')) return
    setTimeout(async () => {
      try {
        const html = await fetch(location.href, { cache: "force-cache" }).then((r) => r.text())
        const app = html.match(/assets\/app-[\w-]+\.js/)?.[0]
        if (!app) return
        const js = await fetch(new URL(app, location.origin).href, { cache: "force-cache" }).then((r) => r.text())
        const names = [...new Set(js.match(/assets\/[A-Za-z0-9_-]*(?:Map|map|Diorama|diorama)[A-Za-z0-9_-]*\.js/g) || [])]
        for (const n of names.slice(0, 60)) {
          void fetch(new URL("/" + n, location.origin).href, { cache: "force-cache" }).catch(() => {})
        }
        console.info("[perf] prefetch карты:", names.length, "чанков")
      } catch (_) { /* карта и без этого загрузится */ }
    }, 20000)
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", run, { once: true })
  else run()
}

/**
 * Прежняя раскладка в новой версии игры: список сверху, карта под ним.
 * Теперь это родная настройка карты в localStorage — никаких CSS-костылей.
 */
function setupOldMapLayout(): void {
  try {
    const key = "freakland:world-map"
    let cur: Record<string, unknown> = {}
    try { cur = JSON.parse(localStorage.getItem(key) || "{}") } catch { /* пусто */ }
    localStorage.setItem(key, JSON.stringify({
      ...cur,
      view: "iso",
      tab: "bottom",
      bottom: 0.55,
    }))
    console.info("[layout] список сверху, объёмная карта снизу")
  } catch (err) {
    console.warn("[layout] не задал раскладку", err)
  }
}

/** Приподнимаем карту над хотбаром, не меняя её внутренние размеры. */
function liftMapOffHotbar(): void {
  const add = () => {
    if (!document.head || document.getElementById("fr-map-lift")) return
    const st = document.createElement("style")
    st.id = "fr-map-lift"
    st.textContent = ".tab-with-map.map-bottom{bottom:72px!important}" +
      ".tab-with-map.map-bottom .tab-map{margin-left:auto!important;margin-right:auto!important}"
    document.head.appendChild(st)
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", add, { once: true })
  else add()
}


try {
  setupOldMapLayout()
  liftMapOffHotbar()
  setupDj()
  prefetchMap()
} catch (err) {
  console.error("[FreakRating]", err)
}