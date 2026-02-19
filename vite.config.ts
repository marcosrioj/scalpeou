import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveBasePath() {
  const explicit = process.env.VITE_BASE_PATH;
  if (explicit && explicit.trim()) {
    const normalized = explicit.startsWith("/") ? explicit : `/${explicit}`;
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
    if (repo) {
      return `/${repo}/`;
    }
  }

  return "/";
}

export default defineConfig({
  plugins: [react()],
  base: resolveBasePath()
});
