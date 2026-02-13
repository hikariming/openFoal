# Prototype Run Guide

## 1) 安装依赖

在项目根目录执行：

```bash
cd /Users/rqq/openFoal
npm install
```

## 2) 启动企业版 Web 原型

```bash
npm run dev:web
```

默认地址：`http://localhost:5173`

## 3) 启动个人版桌面（Web）原型

```bash
npm run dev:desktop
```

默认地址：`http://localhost:5174`

## 4) Tauri 集成说明

当前已创建 `src-tauri` 骨架：

- `/Users/rqq/openFoal/apps/desktop/src-tauri/Cargo.toml`
- `/Users/rqq/openFoal/apps/desktop/src-tauri/tauri.conf.json`

后续在本机安装 Rust/Tauri CLI 后，可在 `apps/desktop/src-tauri` 基础上接入 `tauri dev`。
