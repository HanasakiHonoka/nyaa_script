// 创建预览窗口元素
const previewContainer = document.createElement('div');
previewContainer.className = 'sukebei-preview-container';
previewContainer.style.display = 'none';
document.body.appendChild(previewContainer);

// 当前悬停的链接
let currentHoverLink = null;
// 定时器ID，用于延迟加载预览
let hoverTimer = null;
// 当前请求的URL
let currentRequestUrl = null;

// 在页面加载时清理过期缓存
window.addEventListener('load', () => {
  window.cacheManager.cleanExpiredCache()
    .then(() => console.log('过期缓存清理完成'))
    .catch(error => console.error('清理过期缓存失败:', error));
});

// 监听鼠标悬停事件
document.addEventListener('mouseover', function(event) {
  // 检查是否悬停在链接上
  let target = event.target;
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
  }
  
  if (!target) return;
  
  const href = target.href;
  // 检查链接是否以 https://sukebei.nyaa.si/view/ 开头
  if (href && href.startsWith('https://sukebei.nyaa.si/view/')) {
    currentHoverLink = target;
    
    // 清除之前的定时器
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    
    // 设置延迟，避免鼠标快速经过链接时触发请求
    hoverTimer = setTimeout(() => {
      // 如果当前请求的URL与悬停链接相同，不重复请求
      if (currentRequestUrl !== href) {
        currentRequestUrl = href;
        fetchPageContent(href);
      } else {
        // 如果已经有内容，直接显示
        showPreview(event);
      }
    }, 300);
  }
});

// 监听鼠标移出事件
document.addEventListener('mouseout', function(event) {
  // 检查是否从链接移出
  let target = event.target;
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
  }
  
  if (target === currentHoverLink) {
    currentHoverLink = null;
    
    // 清除定时器
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    
    // 隐藏预览窗口
    hidePreview();
  }
});

// 监听鼠标移动事件，更新预览窗口位置
document.addEventListener('mousemove', function(event) {
  if (currentHoverLink && previewContainer.style.display !== 'none') {
    updatePreviewPosition(event);
  }
});

// 获取页面内容
function fetchPageContent(url) {
  // 显示加载中的提示
  previewContainer.innerHTML = '<div class="loading">正在加载预览...</div>';
  if (currentHoverLink) {
    showPreview();
  }
  
  // 首先检查缓存中是否有图片URL
  window.cacheManager.getFromCache(url)
    .then(cachedImageUrl => {
      if (cachedImageUrl) {
        console.log('使用缓存的图片URL:', cachedImageUrl);
        // 如果有缓存的图片URL，直接显示图片
        displayImage(cachedImageUrl);
        return;
      }
      
      // 如果没有缓存，使用background script获取页面内容
      chrome.runtime.sendMessage(
        { action: 'fetchPage', url: url },
        response => {
          if (response && response.success) {
            // 解析HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');
            
            // 使用XPath获取描述元素
            const descriptionElement = getElementByXPath(doc, "//*[@id='torrent-description']");
            
            if (descriptionElement) {
              // 从描述中提取hentai-covers.site链接
              const coverLink = extractCoverLink(descriptionElement.innerHTML);
              
              if (coverLink) {
                // 获取封面图片
                fetchCoverImage(coverLink, url);
              } else {
                // 如果没有找到封面链接，显示默认内容
                const content = extractContent(doc);
                previewContainer.innerHTML = content;
                
                if (currentHoverLink) {
                  showPreview();
                }
              }
            } else {
              // 如果没有找到描述元素，显示默认内容
              const content = extractContent(doc);
              previewContainer.innerHTML = content;
              
              if (currentHoverLink) {
                showPreview();
              }
            }
          } else {
            console.error('获取页面内容失败:', response ? response.error : '未知错误');
            previewContainer.innerHTML = '<div class="error">加载预览失败</div>';
            
            if (currentHoverLink) {
              showPreview();
            }
          }
        }
      );
    })
    .catch(error => {
      console.error('检查缓存失败:', error);
      // 如果检查缓存失败，继续正常流程获取页面内容
      chrome.runtime.sendMessage(
        { action: 'fetchPage', url: url },
        response => {
          // 处理响应...（与上面相同的逻辑）
          if (response && response.success) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');
            const descriptionElement = getElementByXPath(doc, "//*[@id='torrent-description']");
            
            if (descriptionElement) {
              const coverLink = extractCoverLink(descriptionElement.innerHTML);
              
              if (coverLink) {
                fetchCoverImage(coverLink, url);
              } else {
                const content = extractContent(doc);
                previewContainer.innerHTML = content;
                
                if (currentHoverLink) {
                  showPreview();
                }
              }
            } else {
              const content = extractContent(doc);
              previewContainer.innerHTML = content;
              
              if (currentHoverLink) {
                showPreview();
              }
            }
          } else {
            console.error('获取页面内容失败:', response ? response.error : '未知错误');
            previewContainer.innerHTML = '<div class="error">加载预览失败</div>';
            
            if (currentHoverLink) {
              showPreview();
            }
          }
        }
      );
    });
}

// 使用XPath获取元素
function getElementByXPath(doc, xpath) {
  const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue;
}

// 从HTML中提取hentai-covers.site链接
function extractCoverLink(html) {
  const regex = /https:\/\/hentai-covers\.site\/image\/[a-zA-Z0-9]+/;
  const match = html.match(regex);
  return match ? match[0] : null;
}

// 获取封面图片
function fetchCoverImage(coverUrl, originalPageUrl) {
  // 显示加载中的提示
  previewContainer.innerHTML = '<div class="loading">正在加载封面图片...</div>';
  if (currentHoverLink) {
    showPreview();
  }
  
  // 使用background script获取图片URL
  chrome.runtime.sendMessage(
    { action: 'fetchPage', url: coverUrl },
    response => {
      if (response && response.success) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.html, 'text/html');
        
        // 使用XPath获取图片URL
        const imgSrcNode = doc.evaluate("//*[@class='media zoom-natural']/@src", doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        
        if (imgSrcNode && imgSrcNode.value) {
          // 获取图片URL
          const imageUrl = imgSrcNode.value;
          
          // 如果提供了原始页面URL，则缓存图片URL
          if (originalPageUrl) {
            window.cacheManager.addToCache(originalPageUrl, imageUrl)
              .then(() => console.log('图片URL已缓存:', originalPageUrl, '->', imageUrl))
              .catch(error => console.error('缓存图片URL失败:', error));
          }
          
          // 显示图片
          displayImage(imageUrl);
        } else {
          // 尝试使用普通的DOM选择器
          const imgElement = doc.querySelector('#image-main');
          if (imgElement && imgElement.src) {
            // 获取图片URL
            const imageUrl = imgElement.src;
            
            // 如果提供了原始页面URL，则缓存图片URL
            if (originalPageUrl) {
              window.cacheManager.addToCache(originalPageUrl, imageUrl)
                .then(() => console.log('图片URL已缓存:', originalPageUrl, '->', imageUrl))
                .catch(error => console.error('缓存图片URL失败:', error));
            }
            
            // 显示图片
            displayImage(imageUrl);
          } else {
            // 如果无法获取图片，显示错误信息
            previewContainer.innerHTML = '<div class="error">无法获取封面图片</div>';
            
            if (currentHoverLink) {
              showPreview();
            }
          }
        }
      } else {
        console.error('获取封面页面失败:', response ? response.error : '未知错误');
        
        // 如果获取封面失败，回退到显示默认内容
        chrome.runtime.sendMessage(
          { action: 'fetchPage', url: currentRequestUrl },
          fallbackResponse => {
            if (fallbackResponse && fallbackResponse.success) {
              const parser = new DOMParser();
              const doc = parser.parseFromString(fallbackResponse.html, 'text/html');
              const content = extractContent(doc);
              previewContainer.innerHTML = content;
              
              if (currentHoverLink) {
                showPreview();
              }
            } else {
              console.error('获取原始页面失败:', fallbackResponse ? fallbackResponse.error : '未知错误');
              previewContainer.innerHTML = '<div class="error">加载预览失败</div>';
              
              if (currentHoverLink) {
                showPreview();
              }
            }
          }
        );
      }
    }
  );
}

// 显示图片
function displayImage(imgUrl) {
  previewContainer.innerHTML = `
    <div class="preview-content">
      <div class="image-container">
        <img src="${imgUrl}" alt="Cover Image" />
      </div>
    </div>
  `;
  
  if (currentHoverLink) {
    showPreview();
  }
}

// 从页面中提取需要显示的内容（作为备用）
function extractContent(doc) {
  // 这里根据sukebei.nyaa.si的页面结构提取需要的内容
  let content = '<div class="preview-content">';
  
  // 尝试获取标题
  const title = doc.querySelector('h3.panel-title');
  if (title) {
    content += `<h3>${title.textContent.trim()}</h3>`;
  }
  
  // 尝试获取种子信息表格
  const infoTable = doc.querySelector('.table-responsive');
  if (infoTable) {
    content += infoTable.outerHTML;
  }
  
  // 尝试获取描述
  const description = doc.querySelector('.panel-body');
  if (description) {
    content += `<div class="description">${description.innerHTML}</div>`;
  }
  
  content += '</div>';
  return content;
}

// 显示预览窗口
function showPreview(event) {
  if (event) {
    updatePreviewPosition(event);
  }
  previewContainer.style.display = 'block';
}

// 隐藏预览窗口
function hidePreview() {
  previewContainer.style.display = 'none';
}

// 更新预览窗口位置
function updatePreviewPosition(event) {
  const offset = 10; // 鼠标和预览窗口之间的偏移量
  
  // 获取视口尺寸
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 获取预览窗口尺寸
  const previewWidth = previewContainer.offsetWidth;
  const previewHeight = previewContainer.offsetHeight;
  
  // 计算预览窗口位置
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  
  // 确保预览窗口不超出视口右侧
  if (left + previewWidth > viewportWidth) {
    left = event.clientX - previewWidth - offset;
  }
  
  // 确保预览窗口不超出视口底部
  if (top + previewHeight > viewportHeight) {
    top = event.clientY - previewHeight - offset;
  }
  
  // 设置预览窗口位置
  previewContainer.style.left = `${left}px`;
  previewContainer.style.top = `${top}px`;
}