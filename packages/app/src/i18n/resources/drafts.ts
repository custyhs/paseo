/**
 * Strings for durable prompt drafts, kept in their own module the way
 * `plugin-settings.ts` is. Adding a key to `en.ts` obliges every other locale
 * file to grow the same key, so a feature with its own vocabulary costs two
 * lines per locale here instead of a scattered diff across nine large files.
 *
 * Locales without a real translation reuse English rather than shipping empty
 * strings; an untranslated label is legible, a missing one is a blank row.
 */

const en = {
  panel: {
    label: "Scratchpad",
    subtitle: "Drafts for this workspace",
    tooltip: "Draft the next instruction while this one runs",
  },
  sections: {
    planned: "Planned here",
    ranHere: "Ran here",
  },
  actions: {
    newDraft: "New draft",
    send: "Send this revision",
    addPlan: "Add",
    removePlan: "Remove {{target}}",
    openAll: "All drafts",
  },
  labels: {
    untitled: "Untitled",
    unsentChanges: "Unsent changes",
    neverSent: "Not sent yet",
    projectLevel: "Project-level",
    revision: "rev {{rev}}",
    sentTo: "{{provider}} session “{{title}}”",
    sentToNewAgent: "New session",
    plannedIn: "Planned in",
    noPlan: "Not planned anywhere — that is fine",
    version: "v{{version}}",
  },
  editor: {
    titlePlaceholder: "Untitled — just start typing",
    bodyPlaceholder: "Write the next instruction. It is saved from the first keystroke.",
    saving: "Saving…",
    saved: "Saved",
    conflict: "This draft changed elsewhere. Reload to see the newer version.",
  },
  empty: {
    plannedTitle: "Nothing planned here yet",
    plannedHint: "A draft you start here is planned for this workspace.",
    pickDraft: "Pick a draft to edit",
  },
};

const zhCN: typeof en = {
  panel: {
    label: "草稿板",
    subtitle: "这个 workspace 的草稿",
    tooltip: "当前这轮还在跑的时候,先写下一条指令",
  },
  sections: {
    planned: "计划在这里执行",
    ranHere: "曾在这里执行过",
  },
  actions: {
    newDraft: "新建草稿",
    send: "发送这个修订版",
    addPlan: "添加",
    removePlan: "移除 {{target}}",
    openAll: "全部草稿",
  },
  labels: {
    untitled: "无标题",
    unsentChanges: "有未发送改动",
    neverSent: "尚未发送",
    projectLevel: "项目级",
    revision: "rev {{rev}}",
    sentTo: "{{provider}} 会话「{{title}}」",
    sentToNewAgent: "新会话",
    plannedIn: "预定执行位置",
    noPlan: "未预定 —— 不预定也完全可以",
    version: "v{{version}}",
  },
  editor: {
    titlePlaceholder: "无标题 —— 直接开始写",
    bodyPlaceholder: "写下一阶段的指令。第一个字符起就已经保存。",
    saving: "保存中…",
    saved: "已保存",
    conflict: "这份草稿在别处被改过。重新载入以查看较新的版本。",
  },
  empty: {
    plannedTitle: "这里还没有计划中的草稿",
    plannedHint: "在这里新建的草稿会自动预定到本 workspace。",
    pickDraft: "选一份草稿来编辑",
  },
};

export const drafts = {
  ar: en,
  en,
  es: en,
  fr: en,
  ja: en,
  ko: en,
  "pt-BR": en,
  ru: en,
  "zh-CN": zhCN,
};
