// ================================================================
// Context Relay — popup.js  (clean rewrite, no external modules)
// ================================================================

const STORAGE_KEY = 'relay_payload';
const EXPIRE_MS   = 60 * 60 * 1000;
const MAX_CHARS   = 24000;  // 提高上限，适应 ChatGPT 长回复

function detectPlatform(url) {
  url = url || '';
  if (url.indexOf('claude.ai') !== -1)         return 'claude';
  if (url.indexOf('chatgpt.com') !== -1)       return 'chatgpt';
  if (url.indexOf('gemini.google.com') !== -1) return 'gemini';
  if (url.indexOf('kimi.com') !== -1 || url.indexOf('kimi.moonshot.cn') !== -1) return 'kimi';
  if (url.indexOf('deepseek.com') !== -1)      return 'deepseek';
  if (url.indexOf('perplexity.ai') !== -1)     return 'perplexity';
  if (url.indexOf('grok.com') !== -1)          return 'grok';
  return 'unknown';
}

// ================================================================
// 提取逻辑（注入到源页面执行）
// ================================================================
function extractLogic(options) {
  try {
    var url = window.location.href;
    var platform = 'unknown';
    if (url.indexOf('claude.ai') !== -1)              platform = 'claude';
    else if (url.indexOf('chatgpt.com') !== -1)       platform = 'chatgpt';
    else if (url.indexOf('gemini.google.com') !== -1) platform = 'gemini';
    else if (url.indexOf('kimi.com') !== -1 || url.indexOf('kimi.moonshot.cn') !== -1) platform = 'kimi';
    else if (url.indexOf('deepseek.com') !== -1)      platform = 'deepseek';
    else if (url.indexOf('perplexity.ai') !== -1)     platform = 'perplexity';

    window.scrollTo({ top: 0, behavior: 'instant' });

    function qsa(selectors, root) {
      root = root || document;
      for (var i = 0; i < selectors.length; i++) {
        try {
          var els = root.querySelectorAll(selectors[i]);
          if (els && els.length > 0) return Array.from(els);
        } catch (e) {}
      }
      return [];
    }

    function qs(selectors, root) {
      root = root || document;
      for (var i = 0; i < selectors.length; i++) {
        try {
          var el = root.querySelector(selectors[i]);
          if (el) return el;
        } catch (e) {}
      }
      return null;
    }

    function getImages(node) {
      if (!options.includeImages) return [];
      var imgs = [];
      try {
        node.querySelectorAll('img').forEach(function(img) {
          var src = img.getAttribute('src') || '';
          if (!src.startsWith('data:') && img.naturalWidth > 32) imgs.push(src);
        });
      } catch (e) {}
      return imgs;
    }

    function getThinking(node) {
      if (!options.includeThinking) return null;
      var sels = [
        "[data-testid='thinking-block']",
        'details.thinking',
        "[class*='ThinkingBlock']",
        "[class*='thinking-block']",
        'thought-chunk'
      ];
      var el = qs(sels, node);
      if (!el) return null;
      var clone = el.cloneNode(true);
      if (clone.tagName === 'DETAILS') clone.open = true;
      return clone.innerText.trim() || null;
    }

    function splitAssistant(node) {
      var thinking = getThinking(node);
      var clone = node.cloneNode(true);
      var sels = [
        "[data-testid='thinking-block']",
        'details.thinking',
        "[class*='ThinkingBlock']",
        "[class*='thinking-block']",
        'thought-chunk'
      ];
      sels.forEach(function(sel) {
        try { clone.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch (e) {}
      });
      return { thinking: thinking, finalContent: clone.innerText.trim() };
    }

    var turns = [];

    if (platform === 'claude') {
      // ── 策略1：新版 Claude（2025）
      // 容器：flex-col px-4 max-w-3xl，子节点交替 user/assistant
      // 角色判断：子节点内有 !font-user-message 则为 user，否则为 assistant
      var chatContainer = qs([
        "[class*='px-4'][class*='max-w-3xl'][class*='flex-col']",
        "[class*='px-4'][class*='max-w-3xl']",
      ]);
      if (chatContainer && chatContainer.children.length > 1) {
        Array.from(chatContainer.children).forEach(function(child) {
          var isUser = !!child.querySelector("[class*='!font-user-message']");
          var role   = isUser ? 'user' : 'assistant';
          var split  = role === 'assistant' ? splitAssistant(child) : null;
          var content = split ? split.finalContent : child.querySelector("[class*='!font-user-message']")?.innerText.trim();
          content = content || child.innerText.trim();
          if (content) turns.push({
            role:    role,
            content: content,
            thinking: split ? split.thinking : null,
            images:  getImages(child),
          });
        });
      }

      // ── 策略2：旧版 Claude（testid）
      if (turns.length === 0) {
        var humanNodes = qsa(["[data-testid='human-turn']", '.human-turn', "[class*='HumanTurn']"]);
        var aiNodes    = qsa(["[data-testid='assistant-turn']", '.assistant-turn', "[class*='AssistantTurn']"]);
        if (humanNodes.length > 0 || aiNodes.length > 0) {
          var merged = [];
          humanNodes.forEach(function(n) { merged.push({ role: 'user', node: n }); });
          aiNodes.forEach(function(n)    { merged.push({ role: 'assistant', node: n }); });
          merged.sort(function(a, b) {
            return (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
          });
          merged.forEach(function(item) {
            if (item.role === 'user') {
              var content = item.node.innerText.trim();
              if (content) turns.push({ role: 'user', content: content, thinking: null, images: getImages(item.node) });
            } else {
              var split = splitAssistant(item.node);
              if (split.finalContent || split.thinking) {
                turns.push({ role: 'assistant', content: split.finalContent, thinking: split.thinking, images: getImages(item.node) });
              }
            }
          });
        }
      }

      // ── 策略3：最后兜底，body 整体文本
      if (turns.length === 0) {
        var bodyText = document.body.innerText.trim().substring(0, 8000);
        if (bodyText) turns.push({ role: 'context', content: bodyText, thinking: null, images: [] });
      }
    }

    else if (platform === 'chatgpt') {
      qsa(["article[data-testid^='conversation-turn']"]).forEach(function(article) {
        var roleEl  = article.querySelector('[data-message-author-role]');
        var role    = roleEl && roleEl.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
        var cel     = qs(['.markdown', "[class*='prose']"], article) || article;
        var content = cel.innerText.trim();
        if (content) turns.push({ role: role, content: content, thinking: null, images: getImages(article) });
      });
    }

    else if (platform === 'gemini') {
      document.querySelectorAll('user-query, model-response').forEach(function(node) {
        var role    = node.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
        var content = node.innerText.trim();
        if (content) turns.push({ role: role, content: content,
          thinking: role === 'assistant' ? getThinking(node) : null, images: getImages(node) });
      });
    }

    else if (platform === 'kimi') {
      // 角色直接写在 class 上：segment-user / segment-assistant
      document.querySelectorAll('.segment').forEach(function(seg) {
        var isUser = seg.classList.contains('segment-user');
        var isAsst = seg.classList.contains('segment-assistant');
        if (!isUser && !isAsst) return;
        var role = isUser ? 'user' : 'assistant';

        var clone = seg.cloneNode(true);

        if (isUser) {
          var textEl = seg.querySelector('.user-content') || seg.querySelector('.segment-content-box') || seg;
          var content = textEl.innerText.trim();
          if (!content) return;

          // Kimi artifact 检测：segment-user 里如果包含大量 Markdown 特征
          // （多个标题行 / 代码块），说明这是 Kimi 生成的文档而非用户输入，重分类为 assistant
          var mdHeadings = (content.match(/^#{1,3} /mg) || []).length;
          var mdCodeBlocks = (content.match(/```/g) || []).length;
          var isArtifact = mdHeadings >= 3 || mdCodeBlocks >= 4;

          if (isArtifact) {
            // 作为 assistant 内容处理
            turns.push({ role: 'assistant', content: content, thinking: null, images: getImages(seg) });
          } else {
            turns.push({ role: 'user', content: content, thinking: null, images: getImages(seg) });
          }
        } else {
          // assistant 节点：只取 .markdown 正文
          var markdownEl = clone.querySelector('.markdown');
          if (!markdownEl) markdownEl = clone;
          var content = markdownEl.innerText.trim();
          if (content) turns.push({ role: 'assistant', content: content, thinking: null, images: getImages(seg) });
        }
      });
    }

    else if (platform === 'deepseek') {
      // 含 .ds-markdown 子节点 = assistant（有正式回复）；否则 = user
      // Thinking 在 [class*="ds-think-content"]
      document.querySelectorAll('.ds-message').forEach(function(msg) {
        var hasMarkdown = !!msg.querySelector('.ds-markdown');
        var role = hasMarkdown ? 'assistant' : 'user';
        var thinking = null;
        if (role === 'assistant' && options.includeThinking) {
          var thinkEl = msg.querySelector('[class*="ds-think-content"]');
          if (thinkEl) thinking = thinkEl.innerText.trim() || null;
        }
        var clone = msg.cloneNode(true);
        clone.querySelectorAll('[class*="ds-think-content"]').forEach(function(el) { el.remove(); });
        var content = clone.innerText.trim();
        if (content) turns.push({ role: role, content: content, thinking: thinking, images: getImages(msg) });
      });
    }

    else if (platform === 'perplexity') {
      // 容器：所有子节点 class 含 outline-none 的父 div
      // 角色：含 [class*="query"] 子节点 = user，否则 = assistant
      var pxContainer = null;
      var allDivs = Array.from(document.querySelectorAll('div'));
      for (var pi = 0; pi < allDivs.length; pi++) {
        var d = allDivs[pi];
        if (d.children.length >= 4) {
          var allOutline = Array.from(d.children).every(function(c) {
            return c.className && c.className.indexOf('outline-none') !== -1;
          });
          if (allOutline) { pxContainer = d; break; }
        }
      }
      if (pxContainer) {
        Array.from(pxContainer.children).forEach(function(child) {
          var isUser    = !!child.querySelector('[class*="query"], [class*="Query"]');
          var role      = isUser ? 'user' : 'assistant';
          // 只取最内层 prose 或 query 容器，避免抓到按钮/来源引用等 UI 噪音
          var contentEl = isUser
            ? (child.querySelector('[class*="query"]') || child)
            : (child.querySelector('.prose, [class*="prose"]') || child);
          // 克隆后去除 UI 噪音节点（来源引用、按钮等）
          var clone = contentEl.cloneNode(true);
          clone.querySelectorAll('button, [class*="source"], [class*="citation"], [class*="footnote"]')
               .forEach(function(el) { el.remove(); });
          var content = clone.innerText.trim();
          if (content) turns.push({ role: role, content: content, thinking: null, images: getImages(child) });
        });
      }
    }

    else {
      turns.push({ role: 'context', content: document.body.innerText.substring(0, 6000), thinking: null, images: [] });
    }

    if (options.range === 'last2') turns = turns.slice(-2);
    else if (options.range === 'last4') turns = turns.slice(-4);

    return { ok: true, platform: platform, conversation: turns, url: url };

  } catch (err) {
    return { ok: false, error: err.message || String(err), platform: 'unknown', conversation: [], url: '' };
  }
}

// ================================================================
// 内容清洗（提取后、序列化前）
// ================================================================
function cleanContent(c) {
  // 0. 反转 HTML 实体（innerText 在某些平台保留字面量实体，必须在 XML 转义前处理）
  c = c.replace(/&gt;/g, '>');
  c = c.replace(/&lt;/g, '<');
  c = c.replace(/&amp;/g, '&');
  c = c.replace(/&quot;/g, '"');
  c = c.replace(/&nbsp;/g, ' ');
  c = c.replace(/&#39;/g, "'");

  // 1. 剥离上次注入残留的 relay XML 块
  c = c.replace(/<relay_instruction[\s\S]*?<\/relay_instruction>/g, '');
  c = c.replace(/<conversation_history[\s\S]*?<\/conversation_history>/g, '');

  // 2. 去掉各平台工具调用/加载状态行
  c = c.replace(/(?:Used \d+ tools?)+/g, '');                          // Claude
  c = c.replace(/(?:正在连接[…\.]*\s*)+/g, '');                        // Gemini 连接中
  c = c.replace(/不使用应用，再试一次/g, '');                            // Gemini 重试提示
  c = c.replace(/Google Search[^\n]*/g, '');                           // Gemini Search 状态
  c = c.replace(/Searched the web[^\n]*/g, '');                        // ChatGPT/Perplexity
  c = c.replace(/显示思路[^\n]*/g, '');                                // Gemini thinking 入口文字
  c = c.replace(/Gemini 说\s*/g, '');                                  // Gemini 说 前缀
  c = c.replace(/已完成.*?打开/gs, '');                                  // Gemini 研究完成卡片
  c = c.replace(/已思考（用时\s*\d+\s*秒）\s*/g, '');               // DeepSeek 思考时长提示
  c = c.replace(/Thinking for \d+ seconds?\s*/gi, '');                // DeepSeek 英文版
  c = c.replace(/^你说[:：]\s*/gm, '');                                 // ChatGPT "你说:" 气泡标签
  c = c.replace(/^ChatGPT[:：]\s*/gm, '');                             // ChatGPT 回复标签
  c = c.replace(/^你说[：::]\s*/m, '');                                // ChatGPT "你说：" 前缀
  c = c.replace(/^ChatGPT said[：::]?\s*/im, '');                     // ChatGPT 英文前缀

  // 3. 去掉 Claude thinking summary 前缀（出现在正文顶部的一句话摘要）
  //    特征：正文最开头出现一短句，然后紧跟着被重复一遍，再才是真正内容
  //    例："审视三项议题。审视三项议题。真正内容..."
  //    策略：检测开头的句子是否被完整重复，有则去掉前两次出现
  c = c.replace(/^(.{5,80}[。！？.!?])\s*\1\s*/g, '');

  // 4. 去掉多余空行（超过2个连续换行合并为2个）
  c = c.replace(/\n{3,}/g, '\n\n');

  return c.trim();
}

// ================================================================
// 内容提炼（对 assistant 回复做结构化压缩）
// ================================================================
function distillContent(c) {
  // 短内容不处理（500字以下直接保留）
  if (!c || c.length < 500) return c;

  var lines = c.split('\n');
  var result = {
    conclusions: [],   // 结论段：最后连续的非空段落
    keyPoints:   [],   // 要点：含序号、冒号、加粗开头的行
    codeBlocks:  [],   // 代码块：```...``` 之间的内容
    questions:   [],   // 遗留问题：以？或"吗"结尾的句子
  };

  // ── 提取代码块 ──
  var codeMatches = c.match(/```[\s\S]*?```/g) || [];
  codeMatches.forEach(function(block) {
    // 只保留不超过 300 字的代码块（太长的一般是输出示例，价值低）
    if (block.length <= 300) result.codeBlocks.push(block.trim());
  });

  // ── 按段落处理（去掉代码块后的纯文本）──
  var textOnly = c.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n');
  var paragraphs = textOnly.split(/\n\n+/).map(function(p) { return p.trim(); }).filter(Boolean);

  paragraphs.forEach(function(para, idx) {
    var paraLines = para.split('\n');

    // 要点识别：段落以序号/项目符号开头，或行中含冒号且不超过120字
    var isKeyPoint = /^[\d一二三四五六七八九十]+[.、。）)]\s/.test(para)   // 数字/中文序号
      || /^[-•·*]\s/.test(para)                                           // 项目符号
      || /^[【\[（(]/.test(para)                                           // 括号开头标题
      || (para.length < 200 && /：|:\s/.test(para) && paraLines.length <= 4); // 短段含冒号

    if (isKeyPoint) {
      // 只取每个要点的前 150 字
      result.keyPoints.push(para.substring(0, 150) + (para.length > 150 ? '…' : ''));
      return;
    }

    // 遗留问题识别：段落以问号结尾，或含"你是否"、"有没有"
    var isQuestion = /[？?]$/.test(para.trim())
      || /你是否|有没有|是否可以|能否/.test(para);
    if (isQuestion && para.length < 200) {
      result.questions.push(para);
      return;
    }

    // 结论段：最后 3 个普通段落
    if (idx >= paragraphs.length - 3) {
      result.conclusions.push(para);
    }
  });

  // ── 组装提炼结果 ──
  var parts = [];

  if (result.keyPoints.length > 0) {
    parts.push('[要点]');
    // 最多保留 6 条要点
    result.keyPoints.slice(0, 6).forEach(function(kp) { parts.push(kp); });
  }

  if (result.codeBlocks.length > 0) {
    parts.push('[关键代码]');
    // 最多保留 2 个代码块
    result.codeBlocks.slice(0, 2).forEach(function(cb) { parts.push(cb); });
  }

  if (result.conclusions.length > 0) {
    parts.push('[结论]');
    result.conclusions.forEach(function(con) { parts.push(con); });
  }

  if (result.questions.length > 0) {
    parts.push('[遗留问题]');
    result.questions.slice(0, 2).forEach(function(q) { parts.push(q); });
  }

  var distilled = parts.join('\n\n');

  // 如果提炼后反而变长（说明结构识别失败），退回原文截断版
  if (distilled.length === 0 || distilled.length > c.length * 0.9) {
    // 兜底：直接截取前 600 字 + 后 300 字
    return c.substring(0, 600) + (c.length > 900 ? '\n\n[… 中间省略 …]\n\n' + c.substring(c.length - 300) : '');
  }

  return distilled;
}

// 风格检测：判断内容是否适合提炼
// 短行占比 > 60% 或含 emoji 列表项 → 不适合，跳过提炼
function shouldDistill(content) {
  if (!content || content.length < 500) return false;
  var lines = content.split('\n').filter(function(l) { return l.trim().length > 0; });
  if (lines.length < 5) return false;
  // emoji 列表检测
  var hasEmojiList = /^[🔹🔸•▪️✅❌⚠️🔴🟡🟢👉▶️→]/m.test(content);
  if (hasEmojiList) return false;
  // 短行比例检测（短行 < 60字）
  var shortLines = lines.filter(function(l) { return l.trim().length < 60; }).length;
  if (shortLines / lines.length > 0.6) return false;
  // 代码块密集检测（超过2个代码块说明是技术输出，不适合提炼）
  var codeBlocks = (content.match(/```/g) || []).length / 2;
  if (codeBlocks > 2) return false;
  return true;
}

function cleanConversation(turns, distill) {
  return turns
    // Step1: 清洗 + 可选提炼
    .map(function(t) {
      var cleaned = cleanContent(t.content || '');
      // 只对适合提炼的 assistant 正文做提炼
      if (distill && t.role === 'assistant' && shouldDistill(cleaned)) {
        cleaned = distillContent(cleaned);
      }
      return Object.assign({}, t, {
        content: cleaned,
        thinking: t.thinking ? cleanContent(t.thinking) : null,
      });
    })
    // Step2: 过滤清洗后为空的轮次
    .filter(function(t) { return t.content.length > 0; })
    // Step3: 过滤与相邻轮次高度重复的轮次
    .filter(function(t, i, arr) {
      if (i === 0) return true;
      var prev = arr[i - 1].content;
      var curr = t.content;
      var shorter = prev.length < curr.length ? prev : curr;
      var longer  = prev.length < curr.length ? curr : prev;
      if (shorter.length > 50 && longer.indexOf(shorter) !== -1 &&
          shorter.length / longer.length > 0.85) {
        return false;
      }
      return true;
    });
}

// ================================================================
// 内容格式化（序列化前对内容做最终处理）
// ================================================================
function formatContent(c) {
  if (!c) return '';

  // 1. HTML 实体反转（在 cleanContent 里已处理，此处不再重复以防和 XML 转义冲突）

  // 2. 把 Markdown 粗体/斜体标记转为纯文本（** 和 * 去掉）
  c = c.replace(/\*\*(.+?)\*\*/g, '$1');
  c = c.replace(/\*(.+?)\*/g, '$1');
  c = c.replace(/__(.+?)__/g, '$1');

  // 3. Markdown 标题：去掉 # 前缀，保留文字
  c = c.replace(/^#{1,6}\s+/gm, '');

  // 4. 清理多余空行
  c = c.replace(/\n{3,}/g, '\n\n');

  return c.trim();
}

// ================================================================
// XML 序列化（PRD §4）
// ================================================================
function buildXML(data) {
  function esc(s) {
    s = formatContent(s || '');
    // 输出是注入到输入框的纯文本，不经过 XML 解析器
    // & 保留原样（cleanContent 已反转），只替换会破坏标签结构的尖括号
    return s.replace(/</g, '[').replace(/>/g, ']');
  }

  // 序列化前清洗
  var conversation = cleanConversation(data.conversation, data.distill);
  // 双重保险：剥离残留 relay 头
  conversation = conversation.map(function(t) {
    return Object.assign({}, t, {
      content: (t.content || '').replace(/<relay_instruction[\s\S]*?<\/relay_instruction>/g, '').trim(),
    });
  });

  var total      = conversation.length;
  var hasThink   = conversation.some(function(t) { return !!t.thinking; });
  var dateStr    = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  var platformUC = data.platform.charAt(0).toUpperCase() + data.platform.slice(1);

  // ── 结构化头部 ──
  var xml = '<relay_instruction>\n'
    + '来源：' + platformUC + '  |  ' + total + ' 轮对话'
    + (hasThink ? '  |  含思维链 ✦' : '') + '  |  ' + dateStr + '\n'
    + '接力说明：请仔细阅读以下对话历史，保持批判性思维，基于上下文回答用户的新问题。\n'
    + '来源页面：' + data.url + '\n'
    + '</relay_instruction>\n\n'
    + '<conversation_history>\n';

  // ── 每一轮 ──
  conversation.forEach(function(t, idx) {
    var roleLabel = t.role === 'user'
      ? '用户'
      : (platformUC + ' 回复');

    // 轮次标题行
    xml += '\n[轮次 ' + (idx + 1) + ' / ' + total + ' · ' + roleLabel + ']\n';
    xml += '─────────────────────────────────────\n';

    // Thinking Trace（仅 assistant 有）
    if (t.role === 'assistant' && t.thinking) {
      xml += '<thinking_trace>\n' + esc(t.thinking) + '\n</thinking_trace>\n\n';
    }

    // 正文
    xml += esc(t.content) + '\n';

    // 图片链接（有则附在正文后）
    if (t.images && t.images.length) {
      xml += '\n[附图]\n';
      t.images.forEach(function(u) { xml += '  ' + u + '\n'; });
    }
  });

  xml += '\n</conversation_history>';

  // ── 超长截断（保头保尾）──
  if (xml.length > MAX_CHARS) {
    var head = xml.substring(0, 900);
    var tail = xml.substring(xml.length - (MAX_CHARS - 1000));
    xml = head + '\n\n[… 中间 ' + Math.round((xml.length - MAX_CHARS) / 1000) + 'k 字已压缩以控制长度 …]\n\n' + tail;
  }

  return xml;
}

// ================================================================
// Storage
// ================================================================
function savePayload(xmlText, meta) {
  return new Promise(function(resolve) {
    chrome.storage.local.set({ [STORAGE_KEY]: { xml: xmlText, meta: meta, savedAt: Date.now(), expireAt: Date.now() + EXPIRE_MS } }, resolve);
  });
}
function loadPayload() {
  return new Promise(function(resolve) {
    chrome.storage.local.get([STORAGE_KEY], function(result) {
      var p = result[STORAGE_KEY];
      if (!p) return resolve(null);
      if (Date.now() > p.expireAt) { chrome.storage.local.remove([STORAGE_KEY]); return resolve(null); }
      resolve(p);
    });
  });
}
function clearPayload() {
  return new Promise(function(resolve) { chrome.storage.local.remove([STORAGE_KEY], resolve); });
}

// ================================================================
// 注入逻辑（注入到目标页面执行）
// ================================================================
function injectLogic(xmlText) {
  try {
    var sels = [
      '#prompt-textarea',
      '.ProseMirror[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[data-id="root"]',
      'textarea',
      '[role="textbox"]'
    ];
    var inputEl = null;
    for (var i = 0; i < sels.length; i++) {
      try { var el = document.querySelector(sels[i]); if (el) { inputEl = el; break; } } catch (e) {}
    }
    if (!inputEl) {
      try { navigator.clipboard.writeText(xmlText); } catch (e) {}
      return '未找到输入框，内容已复制到剪贴板，请手动粘贴';
    }
    inputEl.focus();
    if (inputEl.tagName === 'TEXTAREA') {
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(inputEl, xmlText);
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
    try {
      var range = document.createRange();
      var sel = window.getSelection();
      range.selectNodeContents(inputEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    inputEl.scrollIntoView({ block: 'nearest' });
    return '注入成功 ✅ 光标已定位至末尾';
  } catch (err) {
    return '注入异常：' + (err.message || String(err));
  }
}

// ================================================================
// UI 控制器
// ================================================================
var statusEl   = document.getElementById('status');
var infoEl     = document.getElementById('info-bar');
var extractBtn = document.getElementById('extractBtn');
var injectBtn  = document.getElementById('injectBtn');
var selectedRange = 'all';

document.querySelectorAll('.range-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.range-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    selectedRange = btn.dataset.range;
  });
});

// ── 初始化 ──
(async function() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab  = tabs[0];
  var platform = detectPlatform(tab.url);

  if (platform !== 'unknown') {
    infoEl.innerHTML = '当前页面：<span class="highlight">' + platform + '</span>';
  } else {
    infoEl.innerHTML = '<span class="warn">不在支持列表</span>（Claude / ChatGPT / Gemini）';
    extractBtn.disabled = true;
  }

  var payload = await loadPayload();
  if (payload) {
    var m = payload.meta;
    var mins = Math.floor((payload.expireAt - Date.now()) / 60000);
    infoEl.innerHTML += '<br>暂存：<span class="highlight">' + m.platform + ' / ' + m.turnCount + ' 轮'
      + (m.hasThinking ? ' ✨' : '') + '</span>（' + mins + ' 分后过期）';
    injectBtn.disabled = false;
  }
})();

// ── 提取 ──
extractBtn.addEventListener('click', async function() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab  = tabs[0];
  statusEl.textContent = '提取中...';
  statusEl.style.color = '#9ca3af';
  extractBtn.disabled  = true;

  // 直接从激活按钮读取 range，防止 popup 重开后变量被重置
  var activeRangeBtn = document.querySelector('.range-btn.active');
  var currentRange   = activeRangeBtn ? activeRangeBtn.dataset.range : 'all';
  var rangeLabel     = { 'all': '全部', 'last2': '最后2轮', 'last4': '最后4轮' }[currentRange] || currentRange;

  var distillEl = document.getElementById('distillContent');
  var options = {
    range:           currentRange,
    includeThinking: document.getElementById('includeThinking').checked,
    includeImages:   document.getElementById('includeImages').checked,
    distill:         distillEl ? distillEl.checked : false,
  };

  statusEl.textContent = '提取中（' + rangeLabel + '）...';

  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, function: extractLogic, args: [options] },
    async function(results) {
      extractBtn.disabled = false;

      if (chrome.runtime.lastError) {
        statusEl.textContent = '❌ 脚本注入失败：' + chrome.runtime.lastError.message;
        statusEl.style.color = 'red';
        return;
      }

      var data = results && results[0] && results[0].result;
      if (!data) {
        statusEl.textContent = '❌ 无返回数据';
        statusEl.style.color = 'red';
        return;
      }
      if (!data.ok) {
        statusEl.textContent = '❌ 提取异常：' + (data.error || '未知');
        statusEl.style.color = 'red';
        return;
      }
      if (!data.conversation || data.conversation.length === 0) {
        statusEl.textContent = '⚠️ 未识别到对话（请运行 Console 诊断）';
        statusEl.style.color = '#d97706';
        return;
      }

      var xmlText     = buildXML(Object.assign({}, data, { distill: options.distill }));
      var turnCount   = data.conversation.length;
      var hasThinking = data.conversation.some(function(t) { return !!t.thinking; });

      await savePayload(xmlText, { platform: data.platform, turnCount: turnCount, charCount: xmlText.length, hasThinking: hasThinking });

      infoEl.innerHTML = '当前页面：<span class="highlight">' + data.platform + '</span><br>'
        + '已暂存：<span class="highlight">' + turnCount + ' 轮 / ' + xmlText.length + ' 字'
        + (hasThinking ? ' / Thinking ✨' : '') + '</span>';
      var rangeInfo = currentRange === 'all' ? '全部' : currentRange === 'last2' ? '最后2轮' : '最后4轮';
      statusEl.textContent = '✅ 提取成功（' + rangeInfo + ' · ' + turnCount + ' 轮）请切换到目标模型 Tab';
      statusEl.style.color = '#059669';
      injectBtn.disabled   = false;

      chrome.tabs.sendMessage(tab.id, { type: 'RELAY_EXTRACTED' }, function() {
        void chrome.runtime.lastError;
      });
    }
  );
});

// ── 注入 ──
injectBtn.addEventListener('click', async function() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab  = tabs[0];
  var payload = await loadPayload();

  if (!payload) {
    statusEl.textContent = '⚠️ 暂存已过期，请重新提取';
    statusEl.style.color = '#d97706';
    injectBtn.disabled   = true;
    return;
  }

  var targetPlatform = detectPlatform(tab.url);
  statusEl.textContent = '注入中（' + (payload.meta.platform || '?') + ' → ' + targetPlatform + '）...';

  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, function: injectLogic, args: [payload.xml] },
    function(injRes) {
      if (chrome.runtime.lastError) {
        statusEl.textContent = '❌ ' + chrome.runtime.lastError.message;
        statusEl.style.color = 'red';
        return;
      }
      var msg = injRes && injRes[0] && injRes[0].result || '未知结果';
      statusEl.textContent = '🚀 ' + msg;
      statusEl.style.color = msg.indexOf('成功') !== -1 ? '#059669' : '#d97706';
    }
  );
});

// ── 清除 ──
document.getElementById('clearBtn').addEventListener('click', async function() {
  await clearPayload();
  injectBtn.disabled   = true;
  statusEl.textContent = '已清除暂存数据';
  statusEl.style.color = '#9ca3af';
  // 同步更新 infoEl，避免用户误以为清除无效
  var tabs2 = await chrome.tabs.query({ active: true, currentWindow: true });
  var p2    = detectPlatform(tabs2[0].url);
  infoEl.innerHTML = p2 !== 'unknown'
    ? '当前页面：<span class="highlight">' + p2 + '</span>'
    : '<span class="warn">不在支持列表</span>';
});
