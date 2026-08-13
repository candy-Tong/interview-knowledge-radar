import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { InterviewConsolePage } from "./pages/interview-console";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InterviewConsolePage />
  </StrictMode>,
);
