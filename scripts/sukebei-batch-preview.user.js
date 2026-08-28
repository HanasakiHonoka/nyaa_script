// ==UserScript==
// @name         Sukebei Batch Preview
// @namespace    https://sukebei.nyaa.si/
// @version      1.0
// @description  在 sukebei 列表页插入封面缩略图列与多选列，支持批量复制磁力链接
// @match        *://sukebei.nyaa.si/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @connect      hentai-covers.site
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const table = document.querySelector('table.torrent-list');
  if (!table || !table.querySelector('thead .hdr-category')) return;

  // v2：v1 里存满了被 '**' bug 误判为“无封面”的 null 负缓存，必须整体作废
  const CACHE_KEY = 'sp_img_cache_v2';
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const COVER_HOSTS = ['hentai-covers.site'];
  // 描述里封面链接常被写成 markdown 粗体 **https://..**，星号不能进字符类，
  // 尾部残留的 markdown 标点和 CJK 句读也必须剥掉，否则封面站返回 404。
  const COVER_RE = new RegExp(
    'https?://(?:' + COVER_HOSTS.join('|').replace(/\./g, '\\.') + ')/[^"\'\\s<>*，。、」』）]+', 'i');
  const TRAILING_PUNCT_RE = /[.,;:!?)\]}'">*]+$/;
  const DIRECT_IMG_RE = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;
  // 悬浮放大延时：扫过列表时不致于每行都闪出大图
  const ZOOM_DELAY = 150;

  /* ------------------------------------------------------------------ *
   * main.css 用硬编码的 td:nth-child / nth-of-type 定位列。插入两列后原
   * 1..8 变成下表索引，不重述这些规则就会串列：seeders/leechers 的红绿配色
   * 落到 Link/Size 上，≤767px 还会把 Link 列整列 display:none。
   * 这些规则以相同特异度重述、并靠注入顺序在后胜出。
   * ------------------------------------------------------------------ */
  const L = {
    check: 1, cat: 2, name: 3, preview: 4, link: 5,
    size: 6, date: 7, seeders: 8, leechers: 9, downloads: 10,
  };
  const N = (i) => `table.torrent-list > tbody > tr > td:nth-child(${i})`;
  const D = (i, cls) => `body.dark table.torrent-list > tbody > tr.${cls} > td:nth-child(${i})`;
  const WRAP = (i) => `.table-responsive > .table > tbody > tr > td:nth-of-type(${i})`;

  GM_addStyle(`
  /* seeders 绿 / leechers 红：取消落到 link、date 上的旧声明 */
  ${N(L.link)}, ${D(L.link, 'success')}, ${D(L.link, 'danger')},
  ${N(L.date)}, ${D(L.date, 'success')}, ${D(L.date, 'danger')} { color: inherit; }
  ${N(L.seeders)} { color: green; }
  ${N(L.leechers)} { color: red; }
  ${D(L.seeders, 'success')}, ${D(L.seeders, 'danger')} { color: green; }
  ${D(L.leechers, 'success')}, ${D(L.leechers, 'danger')} { color: red; }

  /* category 的 td:first-child{padding:0 4px} 现在要落在第 2 格 */
  ${N(L.cat)} { padding: 0 4px; }

  @media (max-width: 991px) {
    /* 该块内站点的 display:none 规则因 'td: nth-of-type(5)' 笔误整条失效
       （选择器组含非法项即全部丢弃），实测未隐藏任何列，故此处不予还原。 */
    ${WRAP(L.cat)} { white-space: nowrap; word-break: normal; }
    ${WRAP(L.name)} { white-space: unset; word-break: break-all; }
  }
  @media (min-width: 992px) and (max-width: 1199px) {
    ${WRAP(L.cat)} { white-space: nowrap; }
    ${WRAP(L.name)} { white-space: unset; }
  }
  @media (max-width: 767px) {
    /* 旧的隐藏索引 4,5,8 现指向 preview/link/seeders，必须放行 */
    ${N(L.preview)}, ${N(L.link)}, ${N(L.seeders)} { display: table-cell; }
    ${N(L.size)}, ${N(L.date)}, ${N(L.downloads)} { display: none; }

    ${N(L.date)} { border-right: 1px solid #ddd; }
    ${N(L.leechers)} { border-right: 0; }

    ${N(L.name)} > a { display: inline; }
    ${N(L.link)} > a { display: block; }

    ${N(L.cat)} { overflow: hidden; }
    ${N(L.cat)} img { width: 50px; height: auto; }

    .sp-hdr-preview, .sp-cell-preview { width: 64px; }
    .sp-thumb { max-width: 58px; max-height: 44px; }
  }

  /* ---- 新增两列 ---- */
  .sp-hdr-check, .sp-cell-check { width: 34px; padding: 0 4px; }
  .sp-hdr-preview { width: 128px; }
  .sp-thumb {
    display: block; margin: 0 auto; max-width: 118px; max-height: 84px;
    object-fit: contain; border-radius: 3px; background: #f4f4f4;
  }
  .sp-cell-preview.is-loading {
    background: linear-gradient(to right, #f0f0f0 0%, #f8f8f8 50%, #f0f0f0 100%);
    background-size: 200% 100%;
    animation: sp-shimmer 1.5s infinite;
  }
  @keyframes sp-shimmer {
    from { background-position: 0% 50%; }
    to { background-position: 200% 50%; }
  }

  /* 悬浮放大层：尺寸对齐旧的 Sukebei Preview 插件弹窗 */
  .sp-zoom {
    position: fixed;
    z-index: 10000;
    display: none;
    padding: 6px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 5px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    pointer-events: none;
  }
  .sp-zoom img {
    display: block;
    max-width: 600px;
    max-height: 400px;
    object-fit: contain;
  }
  body.dark .sp-zoom { background: #2b2b2b; border-color: #454545; }

  /* 站点规则 thead th a{position:absolute;width/height:100%} 会把 <a> 变成
     整格透明点击层，所以工具条只能用 <button>。 */
  .sp-toolbar { float: right; display: inline-flex; align-items: center; gap: 3px; }
  .sp-count { color: #777; font-size: 12px; font-weight: normal; }
  body.dark .sp-count { color: #999; }
  .sp-sr {
    position: absolute; width: 1px; height: 1px; margin: -1px;
    padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  `);

  // --- 缓存：一个对象存全部映射；无封面的结果也要缓存，避免每次翻页重复请求 ---
  const cache = (() => {
    const stored = GM_getValue(CACHE_KEY, null);
    const now = Date.now();
    const map = new Map(
      Object.entries(stored || {}).filter(([, v]) => now - v.t < CACHE_TTL)
    );
    let dirty = false;
    return {
      has: (k) => map.has(k),
      get: (k) => map.get(k).u,
      set(k, u) { map.set(k, { u, t: Date.now() }); dirty = true; },
      flush() {
        if (!dirty) return;
        GM_setValue(CACHE_KEY, Object.fromEntries(map));
        dirty = false;
      },
    };
  })();

  /* 详情页与列表页同源，用页面自身的 fetch() 即可，省掉一条 @connect；
     封面站不发 Access-Control-Allow-Origin，页面 fetch 读不到内容，
     只有那一跳必须走 GM_xmlhttpRequest。 */
  function fetchText(url) {
    if (url.startsWith(location.origin + '/')) {
      return fetch(url, { credentials: 'same-origin' }).then((r) => {
        if (!r.ok) throw new Error('详情页 HTTP ' + r.status);
        return r.text();
      });
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        onload: (r) => (r.status >= 200 && r.status < 300
          ? resolve(r.responseText)
          : reject(new Error('封面页 HTTP ' + r.status))),
        onerror: () => reject(new Error('封面页 请求失败（检查 @connect hentai-covers.site 是否已允许）')),
        ontimeout: () => reject(new Error('封面页 请求超时')),
      });
    });
  }

  const OG_IMAGE_TAG_RE = /<meta[^>]+property=["']og:image["'][^>]*>/i;
  const CONTENT_ATTR_RE = /content=["']([^"']+)["']/i;

  /** 详情页描述里的封面链接 -> 封面页 og:image 直链 */
  async function resolveCover(viewUrl) {
    const match = (await fetchText(viewUrl)).match(COVER_RE);
    if (!match) return null;

    const link = match[0].replace(/&amp;/g, '&').replace(TRAILING_PUNCT_RE, '');
    if (DIRECT_IMG_RE.test(link)) return link;

    const coverHtml = await fetchText(link);
    const tag = coverHtml.match(OG_IMAGE_TAG_RE);
    const content = tag && tag[0].match(CONTENT_ATTR_RE);
    return content ? content[1] : null;
  }

  // --- 建列 ---
  const headRow = table.querySelector('thead > tr');
  const catTh = headRow.querySelector('.hdr-category');
  const linkTh = headRow.querySelector('.hdr-link');
  const nameTh = headRow.querySelector('.hdr-name');

  const checkTh = document.createElement('th');
  checkTh.className = 'sp-hdr-check text-center';
  const master = document.createElement('input');
  master.type = 'checkbox';
  master.title = '全选 / 取消全选';
  checkTh.appendChild(master);

  const previewTh = document.createElement('th');
  previewTh.className = 'sp-hdr-preview text-center';
  previewTh.textContent = 'Preview';

  headRow.insertBefore(checkTh, catTh);
  headRow.insertBefore(previewTh, linkTh);

  const rows = [];
  for (const tr of table.querySelectorAll('tbody > tr')) {
    const catTd = tr.children[0];
    const nameTd = tr.children[1];
    const linkTd = tr.children[2];

    const checkTd = document.createElement('td');
    checkTd.className = 'sp-cell-check text-center';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'sp-box';
    checkTd.appendChild(box);

    const previewTd = document.createElement('td');
    previewTd.className = 'sp-cell-preview text-center';

    tr.insertBefore(checkTd, catTd);
    tr.insertBefore(previewTd, linkTd);

    rows.push({
      box,
      previewTd,
      viewUrl: nameTd.querySelector('a[href*="/view/"]').href,
      magnet: tr.querySelector('a[href^="magnet:"]').getAttribute('href'),
    });
  }

  // --- 选择与复制 ---
  const countEl = document.createElement('span');
  countEl.className = 'sp-count';

  const toolbar = document.createElement('span');
  toolbar.className = 'sp-toolbar';
  toolbar.appendChild(countEl);

  const ACTIONS = [
    ['fa-check-square-o', '全选', () => setAll(true)],
    ['fa-retweet', '反选', () => { rows.forEach((r) => { r.box.checked = !r.box.checked; }); refresh(); }],
    ['fa-square-o', '清空选择', () => setAll(false)],
    ['fa-files-o', '复制选中磁力链接', copySelected],
  ];

  for (const [icon, label, handler] of ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-xs btn-default';
    btn.title = label;
    const i = document.createElement('i');
    i.className = 'fa ' + icon;
    i.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'sp-sr';
    sr.textContent = label;
    btn.append(i, sr);
    btn.addEventListener('click', handler);
    toolbar.appendChild(btn);
  }
  nameTh.appendChild(toolbar);

  function setAll(value) {
    rows.forEach((r) => { r.box.checked = value; });
    refresh();
  }

  function refresh() {
    const n = rows.filter((r) => r.box.checked).length;
    master.checked = n > 0 && n === rows.length;
    master.indeterminate = n > 0 && n < rows.length;
    countEl.textContent = n + ' 已选';
  }

  master.addEventListener('change', () => setAll(master.checked));
  table.addEventListener('change', (e) => {
    if (e.target.classList.contains('sp-box')) refresh();
  });

  async function copySelected() {
    const picked = rows.filter((r) => r.box.checked).map((r) => r.magnet);
    if (!picked.length) {
      countEl.textContent = '未选择';
      return;
    }
    const text = picked.join('\n');
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    countEl.textContent = `已复制 ${picked.length} 条`;
  }

  // --- 缩略图：滚到附近才排队，且限制并发 ---
  const CONCURRENCY = 3;
  const byCell = new Map(rows.map((r) => [r.previewTd, r]));
  const pending = [];
  const queued = new Set();
  let running = 0;

  function pump() {
    while (running < CONCURRENCY && pending.length) {
      const r = pending.shift();
      queued.delete(r);
      running++;
      loadRow(r).finally(() => { running--; pump(); });
    }
  }

  async function loadRow(r) {
    r.previewTd.classList.add('is-loading');
    try {
      const url = await resolveCover(r.viewUrl);
      cache.set(r.viewUrl, url);
      if (url) paint(r.previewTd, url);
    } catch (err) {
      cache.set(r.viewUrl, null);
      console.warn('[Sukebei Preview]', r.viewUrl, err.message);
    } finally {
      r.previewTd.classList.remove('is-loading');
      cache.flush();
    }
  }

  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const r = byCell.get(entry.target);
      visible.unobserve(entry.target);
      if (!queued.has(r)) { queued.add(r); pending.push(r); pump(); }
    }
  }, { rootMargin: '400px 0px' });

  for (const r of rows) {
    if (!cache.has(r.viewUrl)) { visible.observe(r.previewTd); continue; }
    const cached = cache.get(r.viewUrl);
    if (cached) paint(r.previewTd, cached);
  }

  function paint(td, src) {
    const img = document.createElement('img');
    img.className = 'sp-thumb';
    img.alt = '';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = src;
    td.appendChild(img);
  }

  // --- 悬浮放大：复用缩略图已下载的地址，不再发请求 ---
  const zoom = document.createElement('div');
  zoom.className = 'sp-zoom';
  const zoomImg = document.createElement('img');
  zoom.appendChild(zoomImg);
  document.body.appendChild(zoom);

  let hoveredThumb = null;
  let zoomTimer = null;
  const point = { x: 0, y: 0 };

  table.addEventListener('mouseover', (e) => {
    const thumb = e.target;
    if (!thumb || thumb.tagName !== 'IMG' || !thumb.classList.contains('sp-thumb')) return;
    hoveredThumb = thumb;
    point.x = e.clientX;
    point.y = e.clientY;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      zoomImg.src = thumb.src;
      zoom.style.display = 'block';
      placeZoom();
    }, ZOOM_DELAY);
  });

  table.addEventListener('mouseout', (e) => {
    if (e.target === hoveredThumb) hideZoom();
  });

  document.addEventListener('mousemove', (e) => {
    if (!hoveredThumb) return;
    point.x = e.clientX;
    point.y = e.clientY;
    if (zoom.style.display === 'block') placeZoom();
  });

  // 图片解码后才有真实尺寸，再贴一次防止溢出视口
  zoomImg.addEventListener('load', placeZoom);
  window.addEventListener('scroll', hideZoom, true);

  function hideZoom() {
    hoveredThumb = null;
    clearTimeout(zoomTimer);
    zoom.style.display = 'none';
  }

  function placeZoom() {
    const gap = 14;
    const w = zoom.offsetWidth;
    const h = zoom.offsetHeight;
    let left = point.x + gap;
    let top = point.y + gap;
    if (left + w > innerWidth) left = point.x - w - gap;
    if (top + h > innerHeight) top = point.y - h - gap;
    zoom.style.left = Math.max(4, left) + 'px';
    zoom.style.top = Math.max(4, top) + 'px';
  }

  refresh();
})();
