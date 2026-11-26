import { render } from "preact";
import { App } from "./App.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
