import { create } from "zustand";

export type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
};

type AppStore = {
  sessions: SessionItem[];
  activeSessionId: string;
  setActiveSession: (sessionId: string) => void;
};

const seedSessions: SessionItem[] = [
  {
    id: "s1",
    title: "new-desktop",
    updatedAt: "Today · 14:28",
    preview: "继续优化首页布局和输入区样式"
  },
  {
    id: "s2",
    title: "Skill Store 内容策展",
    updatedAt: "Today · 09:12",
    preview: "补 12 个 featured skills 文案和图标"
  },
  {
    id: "s3",
    title: "Automations 流程草案",
    updatedAt: "Yesterday · 22:40",
    preview: "定义每周巡检自动化输出格式"
  },
  {
    id: "s4",
    title: "Brand Theme v2",
    updatedAt: "Yesterday · 19:03",
    preview: "更新品牌色 token 与 hover 态"
  }
];

export const useAppStore = create<AppStore>((set) => ({
  sessions: seedSessions,
  activeSessionId: seedSessions[0].id,
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId })
}));
