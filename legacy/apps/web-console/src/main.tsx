import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "../node_modules/@douyinfe/semi-ui/dist/css/semi.min.css";
import "@openfoal/personal-app/workbench/styles.css";
import "./i18n";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
