import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRegistry } from "react-native-web";
import App from "./App";
import "./design-tokens.css";
import "./index.css";

AppRegistry.registerComponent("App", () => App);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
