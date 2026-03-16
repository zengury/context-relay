// ================================================================
// Context Relay — content.js
// 负责：在目标页面注入悬浮按钮 (FAB)，PRD §5 注入状态
// 运行环境：目标网页（chatgpt.com / claude.ai / gemini.google.com）
// ================================================================

const STORAGE_KEY = 'relay_payload';
const FAB_ID      = '__context_relay_fab__';

// ── 平台检测 ──
function getPlatform() {
  const url = window.location.href;
  if (url.includes('claude.ai'))         return 'claude';
  if (url.includes('chatgpt.com'))       return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  return 'unknown';
}

// ── 创建 FAB ──
function createFAB() {
  if (document.getElementById(FAB_ID)) return;

  const fab = document.createElement('button');
  fab.id = FAB_ID;
  fab.innerText = '⚡ 接力';
  fab.title     = 'Context Relay：检测到待接力的上下文，点击注入';

  Object.assign(fab.style, {
    position:        'fixed',
    bottom:          '88px',
    right:           '20px',
    zIndex:          '99999',
    padding:         '10px 16px',
    fontSize:        '13px',
    fontWeight:      '700',
    fontFamily:      '-apple-system, BlinkMacSystemFont, sans-serif',
    background:      'linear-gradient(135deg, #6366f1, #2563eb)',
    color:           '#fff',
    border:          'none',
    borderRadius:    '24px',
    cursor:          'pointer',
    boxShadow:       '0 4px 14px rgba(99,102,241,0.45)',
    transition:      'transform 0.2s, box-shadow 0.2s',
    animation:       'relay-pulse 2s infinite',
  });

  // 注入 keyframe 动画（pulse 效果，PRD §5 "高亮闪烁"）
  if (!document.getElementById('__relay_style__')) {
    const style = document.createElement('style');
    style.id = '__relay_style__';
    style.textContent = `
      @keyframes relay-pulse {
        0%, 100% { box-shadow: 0 4px 14px rgba(99,102,241,0.45); transform: scale(1); }
        50%       { box-shadow: 0 6px 20px rgba(99,102,241,0.7);  transform: scale(1.04); }
      }
      #${FAB_ID}:hover {
        transform: scale(1.06) !important;
        box-shadow: 0 6px 22px rgba(99,102,241,0.6) !important;
        animation: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  fab.addEventListener('click', handleFABClick);
  document.body.appendChild(fab);
}

// ── 移除 FAB ──
function removeFAB() {
  const el = document.getElementById(FAB_ID);
  if (el) el.remove();
}

// ── FAB 点击：执行注入 ──
async function handleFABClick() {
  const fab = document.getElementById(FAB_ID);
  if (fab) {
    fab.innerText  = '⏳ 注入中...';
    fab.style.animation = 'none';
  }

  // 从 storage 读取 XML
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const payload = result[STORAGE_KEY];
    if (!payload || Date.now() > payload.expireAt) {
      if (fab) { fab.innerText = '⚠️ 已过期'; fab.style.background = '#f59e0b'; }
      setTimeout(removeFAB, 2000);
      return;
    }

    const xmlText = payload.xml;

    // 注入文本（与 popup.js injectLogic 保持一致）
    const inputSelectors = [
      '#prompt-textarea',
      '.ProseMirror[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[data-id="root"]',
      'textarea',
      '[role="textbox"]',
    ];

    let inputEl = null;
    for (const sel of inputSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) { inputEl = el; break; }
      } catch (_) {}
    }

    if (!inputEl) {
      navigator.clipboard.writeText(xmlText).catch(() => {});
      if (fab) { fab.innerText = '📋 已复制'; fab.style.animation = 'none'; }
      setTimeout(removeFAB, 2500);
      return;
    }

    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(inputEl, xmlText);
      inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, xmlText);
      if (!inputEl.innerText.includes(xmlText.substring(0, 30))) {
        inputEl.innerText = xmlText;
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: xmlText }));
      }
    }

    // 光标移至末尾
    const range = document.createRange();
    const sel   = window.getSelection();
    range.selectNodeContents(inputEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    inputEl.scrollIntoView({ block: 'nearest' });

    // FAB 变为成功态，然后消失
    if (fab) {
      fab.innerText = '✅ 注入成功';
      fab.style.background  = '#059669';
      fab.style.animation   = 'none';
    }
    setTimeout(removeFAB, 2500);
  });
}

// ── 检查是否需要显示 FAB（有未过期的暂存时显示）──
function checkAndShowFAB() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const payload = result[STORAGE_KEY];
    if (payload && Date.now() < payload.expireAt) {
      createFAB();
    } else {
      removeFAB();
    }
  });
}

// ── 监听 popup 的提取完成消息 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RELAY_EXTRACTED') {
    // 其他 tab 提取完成后，当前页面如果是目标平台就显示 FAB
    checkAndShowFAB();
  }
});

// ── 页面加载时检查（处理用户切换 tab 场景）──
checkAndShowFAB();

// ── URL 变化监听（SPA 路由跳转，PRD §3.3）──
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // URL 变化后重新检查（e.g. 从历史对话切换到新对话）
    setTimeout(checkAndShowFAB, 800); // 等 SPA 渲染稳定
  }
}).observe(document.body, { subtree: true, childList: true });
