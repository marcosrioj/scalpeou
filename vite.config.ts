import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function normalizeBase(path: string) {
  const ensuredRoot = path.startsWith("/") ? path : `/${path}`;
  return ensuredRoot.endsWith("/") ? ensuredRoot : `${ensuredRoot}/`;
}

function resolveBasePath() {
  const explicit = process.env.VITE_BASE_PATH;
  if (explicit && explicit.trim()) {
    return normalizeBase(explicit.trim());
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
    if (repo) {
      if (repo.endsWith(".github.io")) {
        return "/"; // user/organization pages are served from the root domain
      }
      return normalizeBase(repo);
    }
  }

  const pkgName = process.env.npm_package_name; // fallback for local builds destined to GH Pages
  if (pkgName) {
    return normalizeBase(pkgName);
  }

  return "/";
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : resolveBasePath()
}));
