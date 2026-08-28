// ==UserScript==
// @name         Sukebei Preview
// @namespace    https://sukebei.nyaa.si/
// @version      1.0
// @description  鼠标悬停在sukebei.nyaa.si种子链接上时显示封面预览
// @match        *://sukebei.nyaa.si/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @connect      sukebei.nyaa.si
// @connect      hentai-covers.site
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/HanasakiHonoka/nyaa_script/main/scripts/sukebei-preview.user.js
// @updateURL    https://raw.githubusercontent.com/HanasakiHonoka/nyaa_script/main/scripts/sukebei-preview.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CACHE_PREFIX = 'img_cache_';
  const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
  const HOVER_DELAY = 300;

  // --- Styles ---
  GM_addStyle(`
    .sukebei-preview-container {
      position: fixed;
      z-index: 10000;
      width: 600px;
      max-height: 500px;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      padding: 10px;
      overflow-y: auto;
      font-family: Arial, sans-serif;
      font-size: 14px;
      color: #333;
      display: none;
      pointer-events: none;
    }
    .sukebei-preview-container .image-container {
      width: 100%;
      text-align: center;
      margin: 10px 0;
      max-height: 400px;
      overflow: hidden;
    }
    .sukebei-preview-container .image-container img {
      max-width: 100%;
      max-height: 400px;
      height: auto;
      object-fit: contain;
      border: 1px solid #eee;
      border-radius: 3px;
    }
    .sukebei-preview-container .loading {
      color: #5bc0de;
      padding: 10px;
      text-align: center;
      font-weight: bold;
      background: linear-gradient(to right, #f0f0f0 0%, #f8f8f8 50%, #f0f0f0 100%);
      background-size: 200% 100%;
      animation: sukebei-loading 1.5s infinite;
    }
    @keyframes sukebei-loading {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .sukebei-preview-container .error {
      color: #d9534f;
      padding: 10px;
      text-align: center;
      font-weight: bold;
    }
  `);

  // --- Cache ---
  function getFromCache(pageUrl) {
    const key = CACHE_PREFIX + pageUrl;
    const item = GM_getValue(key, null);
    if (!item) return null;
    if (Date.now() - item.ts > CACHE_TTL) {
      GM_deleteValue(key);
      return null;
    }
    return item.imgUrl;
  }

  function addToCache(pageUrl, imgUrl) {
    GM_setValue(CACHE_PREFIX + pageUrl, { imgUrl, ts: Date.now() });
  }

  function cleanExpiredCache() {
    const keys = GM_listValues();
    for (const key of keys) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      const item = GM_getValue(key, null);
      if (!item || Date.now() - item.ts > CACHE_TTL) {
        GM_deleteValue(key);
      }
    }
  }

  // --- Network ---
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload(res) {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.responseText);
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror() { reject(new Error('网络请求失败')); },
        ontimeout() { reject(new Error('请求超时')); },
      });
    });
  }

  // --- Preview logic ---
  const container = document.createElement('div');
  container.className = 'sukebei-preview-container';
  document.body.appendChild(container);

  let currentLink = null;
  let hoverTimer = null;
  let lastUrl = null;

  document.addEventListener('mouseover', (e) => {
    let target = e.target;
    while (target && target.tagName !== 'A') target = target.parentElement;
    if (!target) return;

    const href = target.href;
    if (!href || !href.startsWith('https://sukebei.nyaa.si/view/')) return;

    currentLink = target;
    if (hoverTimer) clearTimeout(hoverTimer);

    hoverTimer = setTimeout(() => {
      if (lastUrl === href && container.style.display === 'block') return;
      lastUrl = href;
      loadPreview(href, e);
    }, HOVER_DELAY);
  });

  document.addEventListener('mouseout', (e) => {
    let target = e.target;
    while (target && target.tagName !== 'A') target = target.parentElement;
    if (target === currentLink) {
      currentLink = null;
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      container.style.display = 'none';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (currentLink && container.style.display === 'block') {
      positionPreview(e);
    }
  });

  async function loadPreview(url, event) {
    container.innerHTML = '<div class="loading">正在加载预览...</div>';
    if (event) positionPreview(event);
    container.style.display = 'block';

    const cached = getFromCache(url);
    if (cached) {
      showImage(cached);
      return;
    }

    try {
      const html = await fetchPage(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const desc = doc.querySelector('#torrent-description');

      if (desc) {
        const coverMatch = desc.innerHTML.match(/https:\/\/hentai-covers\.site\/(?:image|api\/images)\/[a-zA-Z0-9/._-]+/);
        if (coverMatch) {
          await loadCover(coverMatch[0], url);
          return;
        }
      }

      showFallback(doc);
    } catch {
      container.innerHTML = '<div class="error">加载预览失败</div>';
    }
  }

  async function loadCover(coverUrl, originalUrl) {
    container.innerHTML = '<div class="loading">正在加载封面图片...</div>';

    try {
      let imageUrl = coverUrl;
      if (imageUrl.includes('/image/')) {
        const html = await fetchPage(coverUrl);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const img = doc.querySelector('img.media') || doc.querySelector('#image-main');
        if (img && img.src) {
          imageUrl = img.src;
        }
      }

      addToCache(originalUrl, imageUrl);
      showImage(imageUrl);
    } catch {
      container.innerHTML = '<div class="error">无法获取封面图片</div>';
    }
  }

  function showImage(src) {
    container.innerHTML = `<div class="image-container"><img src="${src}" alt="Cover" /></div>`;
  }

  function showFallback(doc) {
    let html = '';
    const title = doc.querySelector('h3.panel-title');
    if (title) html += `<strong>${title.textContent.trim()}</strong><br>`;

    const desc = doc.querySelector('#torrent-description');
    if (desc) {
      const text = desc.textContent.trim().slice(0, 200);
      if (text) html += `<span>${text}${text.length >= 200 ? '...' : ''}</span>`;
    }

    container.innerHTML = html || '<div class="error">无可用内容</div>';
  }

  function positionPreview(e) {
    const offset = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = container.offsetWidth;
    const ph = container.offsetHeight;

    let left = e.clientX + offset;
    let top = e.clientY + offset;

    if (left + pw > vw) left = e.clientX - pw - offset;
    if (top + ph > vh) top = e.clientY - ph - offset;

    container.style.left = `${Math.max(0, left)}px`;
    container.style.top = `${Math.max(0, top)}px`;
  }

  // --- Init ---
  cleanExpiredCache();
})();
