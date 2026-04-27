import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./crypto-engine.js";

// If crypto-engine.js is not loaded, warn in the console without crashing the app
if (!window.e2ee) {
  console.warn(
    "[E2EE] crypto-engine.js is not loaded. " +
    "Check VITE_BACKEND_URL in frontend/.env and make sure the backend is running on port 8080."
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
