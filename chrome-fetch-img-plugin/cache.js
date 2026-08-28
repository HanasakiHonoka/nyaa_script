// 缓存管理模块

// 缓存过期时间（3天，单位：毫秒）
const CACHE_EXPIRATION = 3 * 24 * 60 * 60 * 1000;

// 缓存键前缀
const CACHE_KEY_PREFIX = 'img_cache_';

/**
 * 获取缓存键
 * @param {string} url - 页面URL
 * @returns {string} 缓存键
 */
function getCacheKey(url) {
  return CACHE_KEY_PREFIX + url;
}

/**
 * 添加缓存项
 * @param {string} pageUrl - 页面URL
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<void>}
 */
function addToCache(pageUrl, imageUrl) {
  return new Promise((resolve, reject) => {
    const cacheItem = {
      pageUrl: pageUrl,
      imageUrl: imageUrl,
      timestamp: Date.now()
    };
    
    const cacheKey = getCacheKey(pageUrl);
    
    chrome.storage.local.set({ [cacheKey]: cacheItem }, () => {
      if (chrome.runtime.lastError) {
        console.error('缓存添加失败:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('已缓存图片URL:', pageUrl, '->', imageUrl);
        resolve();
      }
    });
  });
}

/**
 * 从缓存中获取图片URL
 * @param {string} pageUrl - 页面URL
 * @returns {Promise<string|null>} 图片URL，如果没有缓存或缓存已过期则返回null
 */
function getFromCache(pageUrl) {
  return new Promise((resolve, reject) => {
    const cacheKey = getCacheKey(pageUrl);
    
    chrome.storage.local.get(cacheKey, (result) => {
      if (chrome.runtime.lastError) {
        console.error('缓存获取失败:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      
      const cacheItem = result[cacheKey];
      
      if (!cacheItem) {
        // 缓存不存在
        resolve(null);
        return;
      }
      
      const now = Date.now();
      if (now - cacheItem.timestamp > CACHE_EXPIRATION) {
        // 缓存已过期，删除并返回null
        chrome.storage.local.remove(cacheKey, () => {
          console.log('已删除过期缓存:', pageUrl);
        });
        resolve(null);
        return;
      }
      
      // 更新访问时间
      cacheItem.timestamp = now;
      chrome.storage.local.set({ [cacheKey]: cacheItem }, () => {
        console.log('已更新缓存访问时间:', pageUrl);
      });
      
      // 返回缓存的图片URL
      resolve(cacheItem.imageUrl);
    });
  });
}

/**
 * 清理过期缓存
 * @returns {Promise<void>}
 */
function cleanExpiredCache() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.error('获取所有缓存失败:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      
      const now = Date.now();
      const expiredKeys = [];
      
      // 查找所有过期的缓存项
      for (const key in items) {
        if (key.startsWith(CACHE_KEY_PREFIX)) {
          const cacheItem = items[key];
          if (now - cacheItem.timestamp > CACHE_EXPIRATION) {
            expiredKeys.push(key);
          }
        }
      }
      
      // 如果有过期的缓存项，删除它们
      if (expiredKeys.length > 0) {
        chrome.storage.local.remove(expiredKeys, () => {
          if (chrome.runtime.lastError) {
            console.error('删除过期缓存失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            console.log('已删除过期缓存项数量:', expiredKeys.length);
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  });
}

// 导出函数
window.cacheManager = {
  addToCache,
  getFromCache,
  cleanExpiredCache
};