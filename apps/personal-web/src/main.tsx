import React from "react";
import ReactDOM from "react-dom/client";
import "../../desktop/node_modules/@douyinfe/semi-ui/dist/css/semi.min.css";
import "../../desktop/src/i18n";
import "../../desktop/src/styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
