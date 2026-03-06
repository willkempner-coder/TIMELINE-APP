import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unknown render error" };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f4f0",
          color: "#1c1a17",
          fontFamily: "Inter, sans-serif",
          padding: 20
        }}
      >
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 10px", fontSize: 22, letterSpacing: "0.02em" }}>Timeline failed to load</h1>
          <p style={{ margin: "0 0 14px", opacity: 0.75 }}>A runtime error occurred while rendering the app.</p>
          <code style={{ display: "block", marginBottom: 16, opacity: 0.75 }}>{this.state.message}</code>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("timeline-media-log-v6");
              window.location.reload();
            }}
            style={{
              border: "1px solid #1c1a17",
              background: "#1c1a17",
              color: "#f5f4f0",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer"
            }}
          >
            Reset local data and reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
