import "./styles.css";

import { getBuildStatus } from "./build-status";
import { renderFoundationStatus } from "./foundation-view";

renderFoundationStatus(
  document.querySelector<HTMLElement>("#main-content"),
  getBuildStatus(),
);
