import React from "react";
import ReactDOM from "react-dom/client";
import "../node_modules/@douyinfe/semi-ui/dist/css/semi.min.css";
import "@openfoal/personal-app/workbench/styles.css";
import "@openfoal/personal-app/workbench";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
