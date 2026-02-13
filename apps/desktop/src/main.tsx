import React from "react";
import ReactDOM from "react-dom/client";
import "../node_modules/@douyinfe/semi-ui/dist/css/semi.min.css";
import "./i18n";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
