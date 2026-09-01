import { readFile } from "node:fs/promises";
import path from "node:path";

const buildMarker = "typecheck-tab";

export async function validateBrowserBuild({
  buildPath = path.resolve("build/index.html"),
  baseURL = "http://localhost:10001",
  fetchImpl = fetch,
} = {}) {
  let html;
  try {
    html = await readFile(buildPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("ViperIDE build is missing; run npm run build first", { cause: error });
    }
    throw error;
  }

  if (!html.includes(buildMarker)) {
    throw new Error("ViperIDE build is stale; run npm run build first");
  }

  const response = await fetchImpl(baseURL);
  const servedHtml = response.ok ? await response.text() : "";
  if (!servedHtml.includes(buildMarker)) {
    throw new Error("ViperIDE served build is stale; run npm run build first");
  }
}

export default async function globalSetup(config) {
  await validateBrowserBuild({ baseURL: config.projects[0].use.baseURL });
}