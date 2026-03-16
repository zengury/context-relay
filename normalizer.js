// 内部消息结构（对应 pi-mono Message 类型）
{
  role: "assistant",
  content: [
    { type: "thinking", thinking: "...推理过程..." },
    { type: "text",     text:    "...最终回答..." }
  ],
  provider: "anthropic",   // 来源提供商
  api:      "anthropic-messages"
}
```

**② `transformMessages(targetProvider, targetApi)`** — 同一 provider 的 assistant 消息原样保留；不同 provider 的消息，thinking blocks 会被转换成 `<thinking>` 标签文本，tool calls 和普通文本保持不变。 

**③ `serializeToPrompt(context, targetPlatform)`** — 先调用 transformMessages，再输出 PRD §4 规定的 XML 格式。

---

## 关键的时序变化
```
【之前】提取 → 立刻生成 XML → 存储
【现在】提取 → 存 Context JSON → 注入时检测目标平台 → transformMessages → 生成 XML
```

这样的好处是：从 Claude 提取的内容，发给 ChatGPT 和发给 Gemini 会分别走不同的转换逻辑，自动适配，不用写死。

---

文件结构现在是：
```
context-relay/
├── manifest.json      
├── popup.html         
├── popup.js           # 提取 + 注入控制
├── normalizer.js      # pi-mono 核心逻辑（新增）
├── content.js         # FAB 悬浮按钮
└── selectors.json     # 配置化选择器