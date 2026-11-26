// Мод карты: список «Кто где» сверху, объёмная карта снизу.
(() => {
  try {
    const key = 'freakland:world-map'
    let cur = {}
    try { cur = JSON.parse(localStorage.getItem(key) || '{}') } catch (_) {}
    localStorage.setItem(key, JSON.stringify({ ...cur, view: 'iso', tab: 'bottom', bottom: 0.55 }))

    const css = document.createElement('style')
    css.id = 'fr-map-layout'
    css.textContent = '.tab-with-map.map-bottom{bottom:72px!important}' +
      '.tab-with-map.map-bottom .tab-map{margin-left:auto!important;margin-right:auto!important}'
    document.head.appendChild(css)

    // Настройка читается игрой при загрузке — перезагружаем страницу один раз.
    if (!sessionStorage.getItem('freak-map-applied')) {
      sessionStorage.setItem('freak-map-applied', '1')
      location.reload()
    }
    console.info('[mod:map] карта сверху/снизу включена')
  } catch (e) {
    console.warn('[mod:map]', e)
  }
})()
