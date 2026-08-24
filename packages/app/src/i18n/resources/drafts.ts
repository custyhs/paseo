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
    lineage: "Lineage",
  },
  actions: {
    newDraft: "New draft",
    archive: "Archive",
    unarchive: "Unarchive",
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
    unplanned: "Unplanned",
    sentCount: "Sent ×{{count}}",
    version: "v{{version}}",
  },
  editor: {
    titlePlaceholder: "Untitled — just start typing",
    bodyPlaceholder: "Write the next instruction. It is saved from the first keystroke.",
    saving: "Saving…",
    saved: "Saved",
    unsaved: "Not saved",
    conflict: "Changed elsewhere",
  },
  conflict: {
    message: "This draft was changed elsewhere. Choose which version to keep.",
    reload: "Reload",
    overwrite: "Overwrite",
  },
  send: {
    title: "Send this revision",
    subtitle: "A byte-exact snapshot is captured now. The draft stays editable.",
    withProvider: "Send with",
    plannedTag: "Planned",
    newAgentIn: "New agent in {{where}}",
    newAgentSubtitle: "Starts a fresh session with this revision",
    existingAgent: "Send to {{title}}",
    noTargets: "No workspaces on this host yet.",
  },
  plan: {
    title: "Plan this draft for",
    subtitle: "Several places are fine. Project level works when the worktree does not exist yet.",
    projectSubtitle: "Any workspace in this project",
    noTargets: "No projects on this host yet.",
  },
  sent: {
    toAgent: "Sent to {{title}} — open it",
    toNewAgent: "Sent. A new session is starting.",
    failed: "Could not send: {{error}}",
    dismiss: "Dismiss",
  },
  snapshot: {
    title: "Sent revision — rev {{rev}}",
    subtitle: "clientMessageId {{clientMessageId}}",
    loading: "Loading…",
    missing: "This revision is no longer on the host.",
    immutable: "Immutable. This is exactly what the agent received.",
  },
  list: {
    title: "Drafts",
    searchPlaceholder: "Search all drafts…",
    clearSearch: "Clear search",
    empty: "No drafts yet.",
    noMatches: "No drafts match that search.",
    archivedGroup: "Archived",
    showArchived: "Show archived ({{count}})",
    hideArchived: "Hide archived",
    matchedInRevision: "Found in rev {{rev}}",
  },
  empty: {
    plannedTitle: "Nothing planned here yet",
    plannedHint: "A draft you start here is planned for this workspace.",
    pickDraft: "Pick a draft to edit",
    unsupportedTitle: "This host does not support drafts",
    unsupportedHint: "Update the daemon on this host to write drafts here.",
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
    lineage: "谱系",
  },
  actions: {
    newDraft: "新建草稿",
    archive: "归档",
    unarchive: "取消归档",
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
    unplanned: "未预定",
    sentCount: "已发送 ×{{count}}",
    version: "v{{version}}",
  },
  editor: {
    titlePlaceholder: "无标题 —— 直接开始写",
    bodyPlaceholder: "写下一阶段的指令。第一个字符起就已经保存。",
    saving: "保存中…",
    saved: "已保存",
    unsaved: "未保存",
    conflict: "在别处被改过",
  },
  conflict: {
    message: "这份草稿在别处被改过。选择保留哪个版本。",
    reload: "重新载入",
    overwrite: "覆盖",
  },
  send: {
    title: "发送这个修订版",
    subtitle: "现在捕获一份逐字节精确的快照。草稿之后仍可编辑。",
    withProvider: "使用",
    plannedTag: "已预定",
    newAgentIn: "在 {{where}} 起新 agent",
    newAgentSubtitle: "用这个修订版开一个新会话",
    existingAgent: "发给 {{title}}",
    noTargets: "这个 host 上还没有 workspace。",
  },
  plan: {
    title: "把这份草稿预定到",
    subtitle: "可以选多个。目标 workspace 还不存在时,就选到项目级。",
    projectSubtitle: "这个项目里的任意 workspace",
    noTargets: "这个 host 上还没有项目。",
  },
  sent: {
    toAgent: "已发送给 {{title}} —— 点击打开",
    toNewAgent: "已发送。新会话正在启动。",
    failed: "发送失败:{{error}}",
    dismiss: "关闭",
  },
  snapshot: {
    title: "已发送的修订版 —— rev {{rev}}",
    subtitle: "clientMessageId {{clientMessageId}}",
    loading: "载入中…",
    missing: "这个修订版在该 host 上已不存在。",
    immutable: "不可变。这就是 agent 当时收到的确切内容。",
  },
  list: {
    title: "草稿",
    searchPlaceholder: "搜索全部草稿…",
    clearSearch: "清除搜索",
    empty: "还没有草稿。",
    noMatches: "没有匹配的草稿。",
    archivedGroup: "已归档",
    showArchived: "显示已归档({{count}})",
    hideArchived: "隐藏已归档",
    matchedInRevision: "命中于 rev {{rev}}",
  },
  empty: {
    plannedTitle: "这里还没有计划中的草稿",
    plannedHint: "在这里新建的草稿会自动预定到本 workspace。",
    pickDraft: "选一份草稿来编辑",
    unsupportedTitle: "这个 host 不支持草稿",
    unsupportedHint: "升级这个 host 上的 daemon 之后才能在这里写草稿。",
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
