const path = require("path");
const crypto = require("crypto");
const fsNative = require("fs");
const fs = require("fs/promises");
const { pathToFileURL } = require("url");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require("electron");

const isDev = !app.isPackaged;
const LOCAL_ASSET_SCHEME = "mwlocal";
const MODEL_FILE_EXTENSIONS = new Set(["3mf", "stl", "zip", "step", "stp", "obj", "amf"]);
const LOCAL_ASSET_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif"
};
const LIBRARY_CACHE_VERSION = 3;
const PRINT_QUEUE_FILE_NAME = "print-queue.json";
const THREE_MF_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: false
});
const REPO_MARKER_FILE_NAME = ".mw-repo.json";
const INSTANCE_COVER_CANDIDATES = [
  "instance-cover.jpg",
  "instance-cover.jpeg",
  "instance-cover.png",
  "instance-cover.webp",
  "instance-cover.gif"
];
const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);
const projectWindows = new Map();
const libraryWatchers = new Map();
let mainWindow = null;

function getPrintQueueFilePath() {
  return path.join(app.getPath("userData"), PRINT_QUEUE_FILE_NAME);
}

async function readPrintQueueEntries() {
  try {
    const parsed = JSON.parse(await fs.readFile(getPrintQueueFilePath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writePrintQueueEntries(entries) {
  const safeEntries = entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
  await fs.writeFile(getPrintQueueFilePath(), JSON.stringify(safeEntries, null, 2), "utf8");
  return safeEntries;
}

function getLibraryWatcherKey(rootPath) {
  return path.resolve(rootPath).toLocaleLowerCase();
}

function removeWatcherSubscriber(webContentsId) {
  for (const [watcherKey, watcherState] of libraryWatchers) {
    watcherState.subscribers.delete(webContentsId);
    if (watcherState.subscribers.size > 0) {
      continue;
    }

    clearTimeout(watcherState.flushTimer);
    watcherState.watcher.close();
    libraryWatchers.delete(watcherKey);
  }
}

async function readChangedProject(rootPath, projectPath) {
  const repo = resolveProjectRepo(rootPath, projectPath);
  if (!repo || !(await exists(projectPath))) {
    return null;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readProject(projectPath, repo);
    } catch (error) {
      lastError = error;
      await wait(250 * (attempt + 1));
    }
  }

  throw lastError;
}

async function flushLibraryChanges(watcherState) {
  const projectPaths = [...watcherState.changedProjectPaths];
  watcherState.changedProjectPaths.clear();

  for (const projectPath of projectPaths) {
    try {
      const project = await readChangedProject(watcherState.rootPath, projectPath);
      if (!project) {
        continue;
      }

      for (const [webContentsId, subscriber] of watcherState.subscribers) {
        if (subscriber.isDestroyed()) {
          watcherState.subscribers.delete(webContentsId);
          continue;
        }

        subscriber.send("library:project-changed", {
          rootPath: watcherState.rootPath,
          projectPath,
          project
        });
      }
    } catch (error) {
      console.warn(`Failed to refresh changed project: ${projectPath}`, error);
    }
  }
}

function scheduleLibraryChange(watcherState, changedPath) {
  if (path.basename(changedPath).toLocaleLowerCase() !== "save-manifest.json") {
    return;
  }

  const projectPath = path.dirname(path.resolve(watcherState.rootPath, changedPath));
  if (!isPathInside(watcherState.rootPath, projectPath)) {
    return;
  }

  watcherState.changedProjectPaths.add(projectPath);
  clearTimeout(watcherState.flushTimer);
  watcherState.flushTimer = setTimeout(() => {
    watcherState.flushTimer = null;
    void flushLibraryChanges(watcherState);
  }, 800);
}

function subscribeToLibraryChanges(rootPath, subscriber) {
  const resolvedRootPath = path.resolve(rootPath);
  const watcherKey = getLibraryWatcherKey(resolvedRootPath);
  removeWatcherSubscriber(subscriber.id);
  let watcherState = libraryWatchers.get(watcherKey);

  if (!watcherState) {
    watcherState = {
      rootPath: resolvedRootPath,
      subscribers: new Map(),
      changedProjectPaths: new Set(),
      flushTimer: null,
      watcher: null
    };
    watcherState.watcher = fsNative.watch(
      resolvedRootPath,
      { recursive: true },
      (_eventType, fileName) => {
        if (fileName) {
          scheduleLibraryChange(watcherState, String(fileName));
        }
      }
    );
    watcherState.watcher.on("error", (error) => {
      console.warn(`Library watcher stopped: ${resolvedRootPath}`, error);
      clearTimeout(watcherState.flushTimer);
      watcherState.watcher.close();
      libraryWatchers.delete(watcherKey);
    });
    libraryWatchers.set(watcherKey, watcherState);
  }

  watcherState.subscribers.set(subscriber.id, subscriber);
  subscriber.once("destroyed", () => removeWatcherSubscriber(subscriber.id));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

function loadRendererWindow(win, query = {}) {
  let hasRetriedDevLoad = false;

  const load = () => {
    if (isDev) {
      const targetUrl = new URL("http://127.0.0.1:5173");
      for (const [key, value] of Object.entries(query)) {
        targetUrl.searchParams.set(key, value);
      }
      return win.loadURL(targetUrl.toString());
    }

    return win.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });
  };

  win.webContents.on("did-fail-load", () => {
    if (!isDev || hasRetriedDevLoad) {
      return;
    }

    hasRetriedDevLoad = true;
    setTimeout(() => {
      void load();
    }, 1200);
  });

  void load();
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f6efe1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  loadRendererWindow(win);
  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

function createProjectWindow(rootPath, projectPath, projectTitle = "") {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedProjectPath = path.resolve(projectPath);
  if (!isPathInside(resolvedRootPath, resolvedProjectPath)) {
    return { ok: false, error: "项目不在当前根目录中。" };
  }

  const existingWindow = projectWindows.get(resolvedProjectPath);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    return { ok: true, reused: true };
  }

  const detailWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    title: projectTitle || "MakerWorld 项目详情",
    backgroundColor: "#f6efe1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  projectWindows.set(resolvedProjectPath, detailWindow);
  detailWindow.on("closed", () => {
    if (projectWindows.get(resolvedProjectPath) === detailWindow) {
      projectWindows.delete(resolvedProjectPath);
    }
  });

  loadRendererWindow(detailWindow, {
    window: "project",
    rootPath: resolvedRootPath,
    projectPath: resolvedProjectPath
  });

  return { ok: true, reused: false };
}

function showAboutDialog() {
  return dialog.showMessageBox({
    type: "info",
    title: "About MakerWorld Helper",
    message: "MakerWorld Helper",
    detail: `版本：${app.getVersion()}`,
    buttons: ["确定"]
  });
}

function buildApplicationMenu() {
  return Menu.buildFromTemplate([
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About",
          click: () => {
            void showAboutDialog();
          }
        }
      ]
    }
  ]);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu());

  protocol.handle(LOCAL_ASSET_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    const encodedPath = requestUrl.pathname.replace(/^\/+/, "");
    const targetPath = decodeURIComponent(encodedPath);
    const normalizedPath = path.normalize(targetPath);

    try {
      const [buffer, stats] = await Promise.all([fs.readFile(normalizedPath), fs.stat(normalizedPath)]);
      const extension = path.extname(normalizedPath).toLowerCase();

      return new Response(buffer, {
        headers: {
          "Content-Type": LOCAL_ASSET_CONTENT_TYPES[extension] || "application/octet-stream",
          "Cache-Control": "public, max-age=604800",
          "Last-Modified": stats.mtime.toUTCString()
        }
      });
    } catch {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
}

function normalizeTagList(value) {
  const normalizedTags = [];
  const seenTags = new Set();

  for (const item of asArray(value)) {
    const tag = String(item || "").trim();
    if (!tag) {
      continue;
    }

    const normalizedTag = tag.toLocaleLowerCase("zh-CN");
    if (seenTags.has(normalizedTag)) {
      continue;
    }

    seenTags.add(normalizedTag);
    normalizedTags.push(tag);
  }

  return normalizedTags;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readDirectoryEntriesSafe(targetPath) {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function sanitizeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRepoMarkerPath(repoPath) {
  return path.join(repoPath, REPO_MARKER_FILE_NAME);
}

async function hasRepoMarker(repoPath) {
  return exists(getRepoMarkerPath(repoPath));
}

async function ensureRepoMarker(repoPath, repoName = path.basename(repoPath)) {
  const markerPath = getRepoMarkerPath(repoPath);
  const markerPayload = {
    type: "makerworld-helper-repo",
    name: repoName,
    createdAt: new Date().toISOString()
  };

  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify(markerPayload, null, 2), "utf8");
}

function toFileSrc(targetPath, versionToken = "") {
  if (!targetPath) {
    return "";
  }

  const baseUrl = `${LOCAL_ASSET_SCHEME}://local/${encodeURIComponent(targetPath)}`;
  return versionToken ? `${baseUrl}?v=${encodeURIComponent(versionToken)}` : baseUrl;
}

async function getAssetDescriptor(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return {
      path: targetPath,
      src: toFileSrc(targetPath, String(Math.trunc(stats.mtimeMs))),
      mtimeMs: stats.mtimeMs
    };
  } catch {
    return null;
  }
}

async function getFirstExistingAssetDescriptor(candidatePaths) {
  for (const candidatePath of candidatePaths) {
    const asset = await getAssetDescriptor(candidatePath);
    if (asset) {
      return asset;
    }
  }

  return null;
}

async function getPathStatSignature(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return `${path.basename(targetPath)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
  } catch {
    return `${path.basename(targetPath)}:missing`;
  }
}

function getLibraryCachePath(rootPath) {
  const cacheKey = crypto.createHash("sha1").update(String(rootPath || "")).digest("hex");
  return path.join(app.getPath("userData"), "library-cache", `${cacheKey}.json`);
}

async function readLibraryCache(rootPath) {
  if (!rootPath) {
    return null;
  }

  try {
    const payload = await readJsonFile(getLibraryCachePath(rootPath));
    if (payload?.version !== LIBRARY_CACHE_VERSION || payload?.rootPath !== rootPath || !payload?.data) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

async function writeLibraryCache(rootPath, data) {
  if (!rootPath || !data) {
    return;
  }

  const cachePath = getLibraryCachePath(rootPath);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        version: LIBRARY_CACHE_VERSION,
        rootPath,
        updatedAt: new Date().toISOString(),
        data
      },
      null,
      2
    ),
    "utf8"
  );
}

function getModelFileType(fileName) {
  return path.extname(fileName || "").replace(/^\./, "").toLowerCase();
}

function isSupportedModelFile(fileName) {
  return MODEL_FILE_EXTENSIONS.has(getModelFileType(fileName));
}

function normalizeCompatibilityName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return INVALID_COMPATIBILITY_CODES.has(text.toUpperCase()) ? "" : text;
}

function collectCompatibilityParts(value, bucket) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = normalizeCompatibilityName(value);
    if (trimmed) {
      bucket.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCompatibilityParts(item, bucket);
    }
    return;
  }

  if (typeof value === "object") {
    for (const key of [
      "name",
      "model",
      "modelName",
      "title",
      "displayName",
      "devProductName",
      "productName",
      "printerName"
    ]) {
      if (key in value) {
        collectCompatibilityParts(value[key], bucket);
      }
    }
  }
}

function collectCompatibilityTextParts(value, bucket) {
  const text = String(value || "").trim();
  if (!text) {
    return;
  }

  for (const part of text.split("/")) {
    const normalized = normalizeCompatibilityName(part);
    if (normalized) {
      bucket.push(normalized);
    }
  }
}

function formatCompatibility(instance) {
  const bucket = [];

  if (instance?.compatibilityText) {
    collectCompatibilityTextParts(instance.compatibilityText, bucket);
  }

  if (bucket.length === 0) {
    collectCompatibilityParts(instance?.compatibility, bucket);
    collectCompatibilityParts(instance?.otherCompatibility, bucket);
  }

  const unique = [];
  const seen = new Set();

  for (const item of bucket.filter(Boolean)) {
    const normalized = item.toUpperCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(item);
  }

  return unique.join(" / ") || "未知机型";
}

async function buildProjectCover(projectPath, manifest, metadata) {
  const coverFileName = manifest?.assets?.cover || "cover.jpg";
  const localCoverPath = path.join(projectPath, "model", "images", coverFileName);
  const localCover = await getAssetDescriptor(localCoverPath);

  return {
    coverPath: localCover?.path || "",
    coverSrc: localCover?.src || "",
    coverUrl: metadata?.model?.coverUrl || ""
  };
}

async function buildPictureItems(projectPath, manifest) {
  const items = await Promise.all(
    asArray(manifest?.assets?.pictures).map(async (picture) => {
      const fileName = picture?.fileName;
      if (!fileName) {
        return null;
      }

      const localPath = path.join(projectPath, "model", "images", fileName);
      const asset = await getAssetDescriptor(localPath);
      if (!asset) {
        return null;
      }

      return {
        fileName,
        path: asset.path,
        src: asset.src
      };
    })
  );

  return items.filter(Boolean);
}

async function buildDocumentItems(projectPath, manifest, metadata) {
  const documents = asArray(metadata?.model?.documents);
  const manifestDocuments = asArray(manifest?.assets?.documents);
  const items = [];

  for (const documentItem of documents) {
    const manifestItem =
      manifestDocuments.find((item) => item.source === documentItem?.url || item.title === documentItem?.title) || null;
    const localPath = manifestItem?.fileName
      ? path.join(projectPath, "model", "documents", manifestItem.fileName)
      : "";
    const localAsset = localPath ? await getAssetDescriptor(localPath) : null;

    items.push({
      title: documentItem?.title || manifestItem?.title || manifestItem?.fileName || "文档",
      path: localAsset?.path || "",
      src: localAsset?.src || "",
      sourceUrl: documentItem?.url || manifestItem?.source || "",
      fileName: manifestItem?.fileName || path.basename(localPath || "") || ""
    });
  }

  const localDocumentEntries = await readDirectoryEntriesSafe(path.join(projectPath, "model", "documents"));
  for (const entry of localDocumentEntries) {
    if (!entry.isFile()) {
      continue;
    }

     if (/^materials-list\.(json|txt)$/i.test(entry.name)) {
      continue;
    }

    const localPath = path.join(projectPath, "model", "documents", entry.name);
    const localAsset = await getAssetDescriptor(localPath);
    items.push({
      title: entry.name,
      path: localAsset?.path || "",
      src: localAsset?.src || "",
      sourceUrl: "",
      fileName: entry.name
    });
  }

  return dedupeDocumentItems(items);
}

function scoreDocumentDisplayTitle(title, fileName) {
  const normalizedTitle = String(title || "").trim();
  const normalizedFileName = String(fileName || "").trim();
  let score = 0;

  if (normalizedTitle && normalizedTitle !== normalizedFileName) {
    score += 3;
  }

  if (/assembly|instructions?|guide|manual|说明|指南/i.test(normalizedTitle)) {
    score += 3;
  }

  if (/\.pdf$/i.test(normalizedTitle)) {
    score += 1;
  }

  return score;
}

function dedupeDocumentItems(items) {
  const nextItems = [];
  const seen = new Map();

  for (const item of items.filter(Boolean)) {
    const key = item.path || item.sourceUrl || item.fileName || item.title || "";
    if (!key) {
      continue;
    }

    const existingIndex = seen.get(key);
    if (existingIndex == null) {
      seen.set(key, nextItems.length);
      nextItems.push(item);
      continue;
    }

    const existingItem = nextItems[existingIndex];
    const existingScore = scoreDocumentDisplayTitle(existingItem.title, existingItem.fileName);
    const nextScore = scoreDocumentDisplayTitle(item.title, item.fileName);
    if (nextScore > existingScore) {
      nextItems[existingIndex] = item;
    }
  }

  return nextItems;
}

async function buildMaterialSections(projectPath, metadata, manifest) {
  let groups = asArray(metadata?.model?.materials?.groups)
    .map((group) => ({
      title: String(group?.title || "物料清单").trim() || "物料清单",
      items: asArray(group?.items)
        .map((item) => ({
          name: String(item?.name || "").trim(),
          sku: String(item?.sku || "").trim(),
          quantity:
            typeof item?.quantity === "number"
              ? item.quantity
              : Number.parseInt(String(item?.quantity || "").replace(/[^\d]/g, ""), 10) || null,
          url: String(item?.url || "").trim()
        }))
        .filter((item) => item.name)
    }))
    .filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    const manifestMaterialFiles = asArray(manifest?.assets?.materialFiles);
    const materialJsonFile =
      manifestMaterialFiles.find((item) => item.fileName === "materials-list.json")?.fileName || "materials-list.json";
    const materialJsonPath = path.join(projectPath, "model", "documents", materialJsonFile);

    if (await exists(materialJsonPath)) {
      try {
        const payload = await readJsonFile(materialJsonPath);
        groups = asArray(payload?.groups)
          .map((group) => ({
            title: String(group?.title || "鐗╂枡娓呭崟").trim() || "鐗╂枡娓呭崟",
            items: asArray(group?.items)
              .map((item) => ({
                name: String(item?.name || "").trim(),
                sku: String(item?.sku || "").trim(),
                quantity:
                  typeof item?.quantity === "number"
                    ? item.quantity
                    : Number.parseInt(String(item?.quantity || "").replace(/[^\d]/g, ""), 10) || null,
                url: String(item?.url || "").trim()
              }))
              .filter((item) => item.name)
          }))
          .filter((group) => group.items.length > 0);
      } catch {
        groups = [];
      }
    }
  }

  return groups;
}

function getInstanceDirectoryName(instance) {
  const raw = `${instance?.id || "instance"}-${instance?.title || "profile"}`;
  const sanitized = sanitizeFolderName(raw);
  return sanitized || `instance-${instance?.id || "x"}`;
}

async function buildInstanceItems(projectPath, metadata, manifest) {
  const manifestModelFiles = asArray(manifest?.assets?.modelFiles);
  const manifestPlateFiles = asArray(manifest?.assets?.plates);

  const instances = await Promise.all(
    asArray(metadata?.instances).map(async (instance) => {
      const instanceDir = getInstanceDirectoryName(instance);
      const filesDir = path.join(projectPath, "instances", instanceDir, "files");
      const coverAsset = await getFirstExistingAssetDescriptor(
        INSTANCE_COVER_CANDIDATES.map((fileName) => path.join(projectPath, "instances", instanceDir, fileName))
      );

      const plateItems = (
        await Promise.all(
          manifestPlateFiles
            .filter((item) => item.instanceId === instance.id)
            .slice(0, 6)
            .map(async (plate) => {
              const localPath = path.join(projectPath, "instances", instanceDir, "plates", plate.fileName || "");
              const asset = await getAssetDescriptor(localPath);
              if (!asset) {
                return null;
              }

              return {
                fileName: plate.fileName,
                path: asset.path,
                src: asset.src
              };
            })
        )
      ).filter(Boolean);

      const modelFiles = [];
      for (const file of manifestModelFiles.filter((item) => item.instanceId === instance.id)) {
        const localPath = path.join(filesDir, file.fileName || "");
        if (!(await exists(localPath))) {
          continue;
        }

        modelFiles.push({
          fileName: file.fileName,
          path: localPath,
          type: file.type || "file"
        });
      }

      if (modelFiles.length === 0) {
        const fileEntries = await readDirectoryEntriesSafe(filesDir);
        for (const entry of fileEntries) {
          if (!entry.isFile() || !isSupportedModelFile(entry.name)) {
            continue;
          }

          const localPath = path.join(filesDir, entry.name);
          modelFiles.push({
            fileName: entry.name,
            path: localPath,
            type: getModelFileType(entry.name) || "file"
          });
        }
      }

      return {
        id: instance.id,
        profileId: instance.profileId,
        title: instance.title || `实例 ${instance.id}`,
        machine: formatCompatibility(instance),
        summaryText: stripHtmlTags(instance.summaryText || instance.summary || ""),
        creator: instance.creator || null,
        isDesigner: Boolean(instance.isDesigner),
        isAuthorsChoice: Boolean(instance.isAuthorsChoice),
        isOfficial: Boolean(instance.isOfficial),
        coverSrc: coverAsset?.src || instance.coverUrl || "",
        coverPath: coverAsset?.path || "",
        plateItems,
        plateCount: asArray(instance.plates).length || plateItems.length,
        modelFiles,
        filesDirectoryPath: filesDir,
        materialCount: instance.materialCount ?? 0,
        downloadCount: instance.downloadCount ?? 0,
        ratingCount: instance.ratingCount ?? 0,
        ratingScoreTotal: instance.ratingScoreTotal ?? 0,
        predictionSeconds: instance.predictionSeconds ?? null,
        weightGrams: instance.weightGrams ?? null,
        nozzleDiameter: instance.nozzleDiameter ?? null,
        printSettings: instance.printSettings || {},
        filaments: asArray(instance.filaments).map((filament) => ({
          type: filament?.type || "",
          color: filament?.color || "",
          usedMeters: filament?.usedMeters || "",
          usedGrams: filament?.usedGrams || ""
        }))
      };
    })
  );

  return instances;
}

async function getProjectFingerprint(projectPath) {
  const fingerprintParts = await Promise.all([
    getPathStatSignature(path.join(projectPath, "metadata.json")),
    getPathStatSignature(path.join(projectPath, "save-manifest.json")),
    getPathStatSignature(path.join(projectPath, "instances")),
    getPathStatSignature(path.join(projectPath, "model", "images")),
    getPathStatSignature(path.join(projectPath, "model", "documents"))
  ]);

  return fingerprintParts.join("|");
}

async function readProject(projectPath, repo, cachedProject = null) {
  const metadataPath = path.join(projectPath, "metadata.json");
  if (!(await exists(metadataPath))) {
    return null;
  }

  const projectStats = await fs.stat(projectPath);
  const addedAt = projectStats.birthtime?.toISOString?.() || projectStats.ctime?.toISOString?.() || "";
  const fingerprint = await getProjectFingerprint(projectPath);
  if (cachedProject?.cacheFingerprint === fingerprint) {
    return {
      ...cachedProject,
      id: `${repo.id}/${path.basename(projectPath)}`,
      repoId: repo.id,
      repoLabel: repo.name,
      repoKind: repo.kind === "default" ? "default" : "custom",
      projectPath,
      addedAt
    };
  }

  const metadata = await readJsonFile(metadataPath);
  const manifestPath = path.join(projectPath, "save-manifest.json");
  const manifest = (await exists(manifestPath)) ? await readJsonFile(manifestPath) : null;
  const cover = await buildProjectCover(projectPath, manifest, metadata);
  const pictureItems = await buildPictureItems(projectPath, manifest);
  const documentItems = await buildDocumentItems(projectPath, manifest, metadata);
  const instanceItems = await buildInstanceItems(projectPath, metadata, manifest);
  const materialSections = await buildMaterialSections(projectPath, metadata, manifest);

  return {
    id: `${repo.id}/${path.basename(projectPath)}`,
    repoId: repo.id,
    repoLabel: repo.name,
    repoKind: repo.kind === "default" ? "default" : "custom",
    projectPath,
    addedAt,
    title: metadata?.model?.title || path.basename(projectPath),
    author: metadata?.creator?.name || "未知作者",
    modelId: String(metadata?.model?.id ?? ""),
    capturedAt: metadata?.capturedAt || "",
    createdAt: metadata?.model?.createdAt || "",
    updatedAt: metadata?.model?.updatedAt || "",
    tags: normalizeTagList(metadata?.model?.tags),
    summaryHtml: metadata?.model?.summaryHtml || "",
    summaryText: metadata?.model?.summaryText || "",
    sourceUrl: metadata?.sourceUrl || "",
    customization: metadata?.model?.customization || null,
    coverPath: cover.coverPath,
    coverSrc: cover.coverSrc,
    coverUrl: cover.coverUrl,
    pictureItems,
    documentItems,
    instanceItems,
    materialSections,
    cacheFingerprint: fingerprint,
    manifest,
    metadata
  };
}

async function scanRootDirectory(rootPath) {
  const cachedPayload = await readLibraryCache(rootPath);
  const cachedProjectsByPath = new Map(
    (cachedPayload?.data?.projects || []).map((project) => [project.projectPath, project])
  );
  const dirents = await fs.readdir(rootPath, { withFileTypes: true });

  const rootRepo = {
    id: "root",
    name: "当前目录",
    kind: "default",
    path: rootPath,
    projectCount: 0
  };

  const scannedEntries = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory())
      .map(async (dirent) => {
        const fullPath = path.join(rootPath, dirent.name);
        const directProject = await readProject(fullPath, rootRepo, cachedProjectsByPath.get(fullPath));
        if (directProject) {
          return { type: "root-project", project: directProject };
        }

        const repo = {
          id: dirent.name,
          name: dirent.name,
          kind: "custom",
          path: fullPath,
          projectCount: 0
        };

        const subDirents = await fs.readdir(fullPath, { withFileTypes: true });
        const repoProjects = (
          await Promise.all(
            subDirents
              .filter((subDirent) => subDirent.isDirectory())
              .map((subDirent) => {
                const projectPath = path.join(fullPath, subDirent.name);
                return readProject(projectPath, repo, cachedProjectsByPath.get(projectPath));
              })
          )
        ).filter(Boolean);

        repo.projectCount = repoProjects.length;
        const markerExists = await hasRepoMarker(fullPath);

        if (repo.projectCount === 0 && !markerExists) {
          return null;
        }

        if (repo.projectCount > 0 && !markerExists) {
          await ensureRepoMarker(fullPath, repo.name);
        }

        return { type: "repo", repo, projects: repoProjects };
      })
  );

  const repositories = [];
  const projects = [];

  for (const entry of scannedEntries) {
    if (!entry) {
      continue;
    }

    if (entry.type === "root-project") {
      projects.push(entry.project);
      rootRepo.projectCount += 1;
      continue;
    }

    projects.push(...entry.projects);
    repositories.push(entry.repo);
  }

  if (rootRepo.projectCount > 0) {
    repositories.unshift(rootRepo);
  }

  const data = {
    repositories: [
      {
        id: "all",
        name: "全部项目",
        kind: "overview",
        path: rootPath,
        projectCount: projects.length
      },
      ...repositories
    ],
    projects
  };

  await writeLibraryCache(rootPath, data);
  return data;
}

function resolveProjectRepo(rootPath, projectPath) {
  const relativeProjectPath = path.relative(rootPath, projectPath);
  if (!relativeProjectPath || relativeProjectPath.startsWith("..") || path.isAbsolute(relativeProjectPath)) {
    return null;
  }

  const pathParts = relativeProjectPath.split(path.sep).filter(Boolean);
  if (pathParts.length === 1) {
    return {
      id: "root",
      name: "当前目录",
      kind: "default",
      path: rootPath,
      projectCount: 0
    };
  }

  return {
    id: pathParts[0],
    name: pathParts[0],
    kind: "custom",
    path: path.join(rootPath, pathParts[0]),
    projectCount: 0
  };
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function decodeHtmlEntities(value) {
  let text = String(value || "");
  const namedEntities = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": "\"",
    "&#34;": "\"",
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " "
  };

  for (let round = 0; round < 3; round += 1) {
    const nextText = text
      .replace(/&(lt|gt|amp|quot|apos|nbsp);|&#34;|&#39;/g, (match) => namedEntities[match] || match)
      .replace(/&#(\d+);/g, (_match, codePoint) => {
        const numericCode = Number.parseInt(codePoint, 10);
        return Number.isFinite(numericCode) ? String.fromCodePoint(numericCode) : _match;
      });

    if (nextText === text) {
      break;
    }

    text = nextText;
  }

  return text;
}

function stripHtmlTags(value) {
  return decodeHtmlEntities(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePrinterDisplayName(value) {
  const text = String(value || "")
    .replace(/^Bambu Lab\s+/i, "")
    .replace(/\s+\d+(?:\.\d+)?\s*nozzle$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeCompatibilityName(text);
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) {
      continue;
    }

    const normalized = text.toUpperCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(text);
  }

  return result;
}

function buildCompatibilityPayload(machineNames) {
  const normalizedMachines = uniqueStrings(machineNames.map(normalizePrinterDisplayName).filter(Boolean));
  return {
    compatibility: normalizedMachines[0] ? { devProductName: normalizedMachines[0] } : null,
    otherCompatibility: normalizedMachines.slice(1).map((name) => ({ devProductName: name })),
    compatibilityText: normalizedMachines.join(" / ")
  };
}

function getZipEntries(zip, predicate) {
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && predicate(entry.entryName))
    .map((entry) => entry.entryName);
}

function readZipEntryText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    return "";
  }

  return entry.getData().toString("utf8");
}

function sortPlateEntryNames(entryNames) {
  return [...entryNames].sort((left, right) => {
    const leftMatch = left.match(/plate_(\d+)/i);
    const rightMatch = right.match(/plate_(\d+)/i);
    const leftIndex = leftMatch ? Number.parseInt(leftMatch[1], 10) : 0;
    const rightIndex = rightMatch ? Number.parseInt(rightMatch[1], 10) : 0;
    return leftIndex - rightIndex;
  });
}

function sortIndexedImageEntryNames(entryNames) {
  return [...entryNames].sort((left, right) => {
    const leftMatch = left.match(/(\d+)(?=\.[a-z]+$)/i);
    const rightMatch = right.match(/(\d+)(?=\.[a-z]+$)/i);
    const leftIndex = leftMatch ? Number.parseInt(leftMatch[1], 10) : 0;
    const rightIndex = rightMatch ? Number.parseInt(rightMatch[1], 10) : 0;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
  });
}

function parse3mfModelMetadata(zip) {
  const xml = readZipEntryText(zip, "3D/3dmodel.model");
  if (!xml) {
    return {};
  }

  const parsed = THREE_MF_XML_PARSER.parse(xml);
  const metadataEntries = asArray(parsed?.model?.metadata);
  const metadata = {};

  for (const entry of metadataEntries) {
    if (!entry || typeof entry !== "object" || !entry.name) {
      continue;
    }

    metadata[entry.name] = typeof entry["#text"] === "string" ? entry["#text"] : "";
  }

  return metadata;
}

function parseProjectSettings(zip) {
  const content = readZipEntryText(zip, "Metadata/project_settings.config");
  if (!content) {
    return {};
  }

  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function buildFilamentList(projectSettings) {
  const types = asArray(projectSettings?.filament_type);
  const colors = asArray(projectSettings?.filament_colour);
  const total = Math.max(types.length, colors.length);

  return Array.from({ length: total }, (_item, index) => ({
    type: String(types[index] || "").trim() || "未知耗材",
    color: String(colors[index] || "").trim() || ""
  })).filter((item) => item.type || item.color);
}

function buildImportedPictureSource(filePath, entryName) {
  return `${pathToFileURL(filePath).href}#${entryName}`;
}

async function ensureUniqueProjectDirectory(baseDirectory, preferredName) {
  const sanitizedBaseName = sanitizeFolderName(preferredName) || "导入项目";
  let currentName = sanitizedBaseName;
  let suffix = 2;

  while (await exists(path.join(baseDirectory, currentName))) {
    currentName = `${sanitizedBaseName}-${suffix}`;
    suffix += 1;
  }

  return {
    name: currentName,
    path: path.join(baseDirectory, currentName)
  };
}

function allocateUniqueFileName(fileName, usedNames) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let nextName = fileName;
  let suffix = 2;

  while (usedNames.has(nextName.toLowerCase())) {
    nextName = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }

  usedNames.add(nextName.toLowerCase());
  return nextName;
}

async function copyZipEntryToFile(zip, entryName, targetPath) {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    return false;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, entry.getData());
  return true;
}

async function importSingle3mfProject(rootPath, targetDirectory, filePath) {
  const zip = new AdmZip(filePath);
  const modelMetadata = parse3mfModelMetadata(zip);
  const projectSettings = parseProjectSettings(zip);
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const title = decodeHtmlEntities(modelMetadata.Title || fileBaseName).trim() || fileBaseName;
  const descriptionHtml = decodeHtmlEntities(modelMetadata.Description || "");
  const summaryText = stripHtmlTags(descriptionHtml);
  const designerName = decodeHtmlEntities(modelMetadata.Designer || "").trim() || "未知作者";
  const importedAt = new Date().toISOString();
  const projectDirectory = await ensureUniqueProjectDirectory(targetDirectory, title);
  const modelImagesDirectory = path.join(projectDirectory.path, "model", "images");
  const machineNames = [
    projectSettings?.printer_model,
    ...asArray(projectSettings?.print_compatible_printers),
    ...asArray(projectSettings?.upward_compatible_machine)
  ];
  const compatibilityPayload = buildCompatibilityPayload(machineNames);
  const filaments = buildFilamentList(projectSettings);
  const instanceId = `import-${crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 10)}`;
  const instanceTitle = String(projectSettings?.print_settings_id || fileBaseName).trim() || "导入配置";
  const instanceDirectoryName = getInstanceDirectoryName({
    id: instanceId,
    title: instanceTitle
  });
  const instanceBasePath = path.join(projectDirectory.path, "instances", instanceDirectoryName);
  const filesDirectory = path.join(instanceBasePath, "files");
  const platesDirectory = path.join(instanceBasePath, "plates");
  const usedModelImageNames = new Set();
  const manifestPictures = [];
  const modelPictureEntries = getZipEntries(zip, (entryName) => entryName.startsWith("Auxiliaries/Model Pictures/"));
  const metadataPreviewEntries = sortIndexedImageEntryNames(
    getZipEntries(zip, (entryName) => /^Metadata\/(top|pick)_\d+\.(png|jpg|jpeg|webp)$/i.test(entryName))
  );
  const coverEntryName =
    [
      "Auxiliaries/.thumbnails/thumbnail_middle.png",
      "Auxiliaries/.thumbnails/thumbnail_3mf.png",
      "Auxiliaries/.thumbnails/thumbnail_small.png"
    ].find((entryName) => zip.getEntry(entryName)) ||
    modelPictureEntries[0] ||
    metadataPreviewEntries[0] ||
    "";
  const plateEntryNames = sortPlateEntryNames(
    getZipEntries(zip, (entryName) => /^Metadata\/plate_\d+\.(png|jpg|jpeg|webp)$/i.test(entryName))
  );
  const extraPlatePreviewEntryNames = sortIndexedImageEntryNames(
    getZipEntries(
      zip,
      (entryName) =>
        /^Metadata\/plate_\d+_small\.(png|jpg|jpeg|webp)$/i.test(entryName) ||
        /^Metadata\/plate_no_light_\d+\.(png|jpg|jpeg|webp)$/i.test(entryName)
    )
  );

  await fs.mkdir(modelImagesDirectory, { recursive: true });
  await fs.mkdir(filesDirectory, { recursive: true });
  await fs.mkdir(platesDirectory, { recursive: true });
  await fs.copyFile(filePath, path.join(filesDirectory, path.basename(filePath)));

  let coverFileName = "";

  if (coverEntryName) {
    coverFileName = allocateUniqueFileName(path.basename(coverEntryName), usedModelImageNames);
    await copyZipEntryToFile(zip, coverEntryName, path.join(modelImagesDirectory, coverFileName));
    const instanceCoverFileName = `instance-cover${path.extname(coverFileName).toLowerCase() || ".png"}`;
    await copyZipEntryToFile(zip, coverEntryName, path.join(instanceBasePath, instanceCoverFileName));
  }

  for (const entryName of modelPictureEntries) {
    const sourceFileName = path.basename(entryName);
    const targetFileName = allocateUniqueFileName(sourceFileName, usedModelImageNames);
    await copyZipEntryToFile(zip, entryName, path.join(modelImagesDirectory, targetFileName));
    manifestPictures.push({
      source: buildImportedPictureSource(filePath, entryName),
      fileName: targetFileName
    });
  }

  for (const entryName of metadataPreviewEntries) {
    const sourceFileName = path.basename(entryName);
    const targetFileName = allocateUniqueFileName(sourceFileName, usedModelImageNames);
    await copyZipEntryToFile(zip, entryName, path.join(modelImagesDirectory, targetFileName));
    manifestPictures.push({
      source: buildImportedPictureSource(filePath, entryName),
      fileName: targetFileName
    });
  }

  if (!coverFileName && manifestPictures[0]?.fileName) {
    coverFileName = manifestPictures[0].fileName;
  }

  const manifestPlates = [];
  for (const entryName of plateEntryNames) {
    const plateFileName = path.basename(entryName);
    await copyZipEntryToFile(zip, entryName, path.join(platesDirectory, plateFileName));
    const plateMatch = entryName.match(/plate_(\d+)/i);
    manifestPlates.push({
      instanceId,
      plateIndex: plateMatch ? Number.parseInt(plateMatch[1], 10) : manifestPlates.length + 1,
      fileName: plateFileName
    });
  }

  const manifestPlatePreviews = [];
  for (const entryName of extraPlatePreviewEntryNames) {
    const previewFileName = path.basename(entryName);
    await copyZipEntryToFile(zip, entryName, path.join(platesDirectory, previewFileName));
    manifestPlatePreviews.push({
      instanceId,
      fileName: previewFileName,
      source: buildImportedPictureSource(filePath, entryName)
    });
  }

  const metadata = {
    parserVersion: 2,
    site: "local-import",
    pageType: "imported-3mf",
    sourceUrl: pathToFileURL(filePath).href,
    capturedAt: importedAt,
    folderName: projectDirectory.name,
    model: {
      id: "",
      modelId: "",
      title,
      slug: "",
      summaryHtml: descriptionHtml,
      summaryText,
      coverUrl: "",
      coverLandscapeUrl: "",
      coverPortraitUrl: "",
      license: decodeHtmlEntities(modelMetadata.License || "").trim(),
      createdAt: modelMetadata.CreationDate || importedAt,
      updatedAt: modelMetadata.ModificationDate || importedAt,
      tags: [],
      pictures: manifestPictures.map((picture) => ({
        name: picture.fileName,
        url: picture.source,
        isRealLifePhoto: 0
      }))
    },
    creator: {
      uid: decodeHtmlEntities(modelMetadata.DesignerUserId || "").trim(),
      name: designerName,
      handle: "",
      avatar: "",
      fanCount: 0,
      followCount: 0,
      level: 0,
      certificated: false
    },
    instances: [
      {
        id: instanceId,
        profileId: instanceId,
        title: instanceTitle,
        summary: "",
        coverUrl: "",
        createdAt: modelMetadata.CreationDate || importedAt,
        updatedAt: modelMetadata.ModificationDate || importedAt,
        publishTime: modelMetadata.CreationDate || importedAt,
        downloadCount: 0,
        printCount: 0,
        ratingCount: 0,
        ratingScoreTotal: 0,
        score: 0,
        hasZipStl: false,
        appCanPrint: true,
        materialCount: filaments.length,
        materialColorCount: filaments.filter((item) => item.color).length,
        needAms: filaments.length > 1,
        predictionSeconds: null,
        weightGrams: null,
        compatibility: compatibilityPayload.compatibility,
        compatibilityText: compatibilityPayload.compatibilityText,
        otherCompatibility: compatibilityPayload.otherCompatibility,
        filaments,
        pictures: [],
        plates: manifestPlates.map((plate) => ({
          index: plate.plateIndex,
          name: plate.fileName
        }))
      }
    ],
    downloadHints: {},
    commentsPreview: []
  };

  const manifest = {
    savedAt: importedAt,
    folderName: projectDirectory.name,
    modelId: "",
    title,
    assets: {
      cover: coverFileName,
      pictures: manifestPictures,
      instancePictures: [],
      plates: manifestPlates,
      platePreviews: manifestPlatePreviews,
      modelFiles: [
        {
          instanceId,
          type: "3mf",
          fileName: path.basename(filePath),
          source: pathToFileURL(filePath).href
        }
      ],
      modelFilesMissing: []
    }
  };

  await fs.writeFile(path.join(projectDirectory.path, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  await fs.writeFile(
    path.join(projectDirectory.path, "save-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return {
    projectPath: projectDirectory.path,
    title,
    author: designerName,
    filePath
  };
}

async function import3mfProjects(rootPath, targetDirectory, filePaths) {
  const imported = [];
  const failed = [];

  for (const filePath of filePaths) {
    try {
      imported.push(await importSingle3mfProject(rootPath, targetDirectory, filePath));
    } catch (error) {
      failed.push({
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { imported, failed };
}

async function openContainingFolder(targetPath) {
  if (!targetPath) {
    return { ok: false, error: "缺少路径。" };
  }

  const resolvedPath = path.resolve(targetPath);

  try {
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      const errorMessage = await shell.openPath(resolvedPath);
      return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
    }

    shell.showItemInFolder(resolvedPath);
    return { ok: true };
  } catch {
    return { ok: false, error: "目标路径不存在。" };
  }
}

function isTransientDeleteError(error) {
  if (!error) {
    return false;
  }

  const errorCode = String(error.code || "").toUpperCase();
  const errorMessage = String(error.message || "").toLowerCase();
  return (
    errorCode === "EBUSY" ||
    errorCode === "EPERM" ||
    errorCode === "ENOTEMPTY" ||
    errorMessage.includes("resource busy") ||
    errorMessage.includes("locked")
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function removeDirectorySafely(targetPath) {
  try {
    await shell.trashItem(targetPath);
    return;
  } catch (error) {
    if (!isTransientDeleteError(error)) {
      throw error;
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: false });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientDeleteError(error) || attempt === 4) {
        throw error;
      }

      await wait(300 * (attempt + 1));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

ipcMain.handle("window:open-project", async (_event, rootPath, projectPath, projectTitle) => {
  if (!rootPath || !projectPath) {
    return { ok: false, error: "缺少项目窗口参数。" };
  }

  try {
    const resolvedRootPath = path.resolve(rootPath);
    const resolvedProjectPath = path.resolve(projectPath);
    if (!isPathInside(resolvedRootPath, resolvedProjectPath)) {
      return { ok: false, error: "项目不在当前根目录中。" };
    }
    if (!(await exists(resolvedProjectPath))) {
      return { ok: false, error: "项目目录不存在。" };
    }

    return createProjectWindow(resolvedRootPath, resolvedProjectPath, projectTitle);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("queue:read", async () => {
  try {
    return { ok: true, entries: await readPrintQueueEntries() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("queue:write", async (_event, entries) => {
  try {
    return { ok: true, entries: await writePrintQueueEntries(entries) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  if (!targetPath) {
    return { ok: false, error: "缺少路径。" };
  }

  const errorMessage = await shell.openPath(targetPath);
  if (errorMessage) {
    return { ok: false, error: errorMessage };
  }

  return { ok: true };
});

ipcMain.handle("shell:open-external", async (_event, url) => {
  if (!url) {
    return { ok: false, error: "缺少链接。" };
  }

  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("instance:show-context-menu", async (event, targetPath) => {
  if (!targetPath) {
    return { ok: false, error: "缺少路径。" };
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { ok: false, error: "无法打开菜单。" };
  }

  const menu = Menu.buildFromTemplate([
    {
      label: "打开所在文件夹",
      click: () => {
        void openContainingFolder(targetPath);
      }
    }
  ]);

  menu.popup({ window: win });
  return { ok: true };
});

ipcMain.handle("library:scan-root", async (_event, rootPath) => {
  if (!rootPath) {
    return { ok: false, error: "缺少根目录。" };
  }

  try {
    return { ok: true, data: await scanRootDirectory(rootPath) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:watch-root", async (event, rootPath) => {
  if (!rootPath) {
    return { ok: false, error: "缺少根目录。" };
  }

  try {
    const resolvedRootPath = path.resolve(rootPath);
    if (!(await exists(resolvedRootPath))) {
      return { ok: false, error: "根目录不存在。" };
    }

    subscribeToLibraryChanges(resolvedRootPath, event.sender);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:unwatch-root", (event) => {
  removeWatcherSubscriber(event.sender.id);
  return { ok: true };
});

ipcMain.handle("library:read-cache", async (_event, rootPath) => {
  if (!rootPath) {
    return { ok: false, error: "缺少根目录。" };
  }

  try {
    const cached = await readLibraryCache(rootPath);
    return {
      ok: true,
      hasCache: Boolean(cached?.data),
      updatedAt: cached?.updatedAt || "",
      data: cached?.data || null
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:refresh-project", async (_event, rootPath, projectPath) => {
  if (!rootPath || !projectPath) {
    return { ok: false, error: "缺少项目刷新参数。" };
  }

  try {
    const repo = resolveProjectRepo(rootPath, projectPath);
    if (!repo) {
      return { ok: false, error: "项目不在当前根目录中。" };
    }

    if (!(await exists(projectPath))) {
      return { ok: true, project: null };
    }

    return {
      ok: true,
      project: await readProject(projectPath, repo)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:update-project-tags", async (_event, rootPath, projectPath, tags) => {
  if (!rootPath || !projectPath) {
    return { ok: false, error: "缺少标签更新参数。" };
  }

  try {
    if (!isPathInside(rootPath, projectPath)) {
      return { ok: false, error: "项目不在当前根目录中。" };
    }

    const repo = resolveProjectRepo(rootPath, projectPath);
    if (!repo) {
      return { ok: false, error: "无法确定项目所在仓库。" };
    }

    const metadataPath = path.join(projectPath, "metadata.json");
    if (!(await exists(metadataPath))) {
      return { ok: false, error: "项目缺少 metadata.json。" };
    }

    const metadata = await readJsonFile(metadataPath);
    metadata.model = metadata.model && typeof metadata.model === "object" ? metadata.model : {};
    metadata.model.tags = normalizeTagList(tags);
    metadata.model.updatedAt = new Date().toISOString();

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    return {
      ok: true,
      project: await readProject(projectPath, repo)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:import-3mf", async (_event, rootPath, targetDirectory) => {
  if (!rootPath || !targetDirectory) {
    return { ok: false, error: "缺少导入参数。" };
  }

  if (!isPathInside(rootPath, targetDirectory)) {
    return { ok: false, error: "导入目标目录不在当前根目录中。" };
  }

  if (!(await exists(targetDirectory))) {
    return { ok: false, error: "导入目标目录不存在。" };
  }

  const fileDialogResult = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "3MF 文件",
        extensions: ["3mf"]
      }
    ]
  });

  if (fileDialogResult.canceled || fileDialogResult.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  try {
    const result = await import3mfProjects(rootPath, targetDirectory, fileDialogResult.filePaths);
    return {
      ok: result.imported.length > 0,
      canceled: false,
      imported: result.imported,
      failed: result.failed,
      targetDirectory
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("library:create-repo", async (_event, rootPath, repoName) => {
  try {
    const safeName = sanitizeFolderName(repoName);
    if (!rootPath || !safeName) {
      return { ok: false, error: "缺少根目录或仓库名称。" };
    }

    const repoPath = path.join(rootPath, safeName);
    if (await exists(repoPath)) {
      return { ok: false, error: `仓库已存在：${safeName}` };
    }

    await fs.mkdir(repoPath, { recursive: true });
    await ensureRepoMarker(repoPath, safeName);
    return { ok: true, path: repoPath, name: safeName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("library:rename-repo", async (_event, rootPath, repoName, nextRepoName) => {
  try {
    const fromName = sanitizeFolderName(repoName);
    const toName = sanitizeFolderName(nextRepoName);
    if (!rootPath || !fromName || !toName) {
      return { ok: false, error: "缺少重命名参数。" };
    }

    const fromPath = path.join(rootPath, fromName);
    const toPath = path.join(rootPath, toName);
    if (!(await exists(fromPath))) {
      return { ok: false, error: `仓库不存在：${fromName}` };
    }

    if (await exists(toPath)) {
      return { ok: false, error: `已存在同名仓库：${toName}` };
    }

    await fs.rename(fromPath, toPath);
    await ensureRepoMarker(toPath, toName);
    return { ok: true, path: toPath, name: toName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("library:delete-repo", async (_event, rootPath, repoName) => {
  try {
    const safeName = sanitizeFolderName(repoName);
    if (!rootPath || !safeName) {
      return { ok: false, error: "缺少根目录或仓库名称。" };
    }

    const repoPath = path.join(rootPath, safeName);
    const entries = await fs.readdir(repoPath);
    if (entries.length > 0) {
      return { ok: false, error: "只能删除空仓库。" };
    }

    await fs.rmdir(repoPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("library:move-project", async (_event, projectPath, targetRepoPath) => {
  try {
    if (!projectPath || !targetRepoPath) {
      return { ok: false, error: "缺少移动参数。" };
    }

    const projectName = path.basename(projectPath);
    const targetPath = path.join(targetRepoPath, projectName);

    if (!(await exists(projectPath))) {
      return { ok: false, error: "项目目录不存在。" };
    }

    if (!(await exists(targetRepoPath))) {
      return { ok: false, error: "目标仓库不存在。" };
    }

    if (await exists(targetPath)) {
      return { ok: false, error: `目标仓库已存在同名项目：${projectName}` };
    }

    await fs.rename(projectPath, targetPath);
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("library:delete-project", async (_event, rootPath, projectPath) => {
  try {
    if (!rootPath || !projectPath) {
      return { ok: false, error: "缺少删除参数。" };
    }

    if (!isPathInside(rootPath, projectPath)) {
      return { ok: false, error: "项目不在当前根目录中。" };
    }

    if (!(await exists(projectPath))) {
      return { ok: false, error: "项目目录不存在。" };
    }

    await removeDirectorySafely(projectPath);
    return { ok: true };
  } catch (error) {
    if (isTransientDeleteError(error)) {
      return {
        ok: false,
        error: "项目目录正在被系统占用，通常是资源管理器缩略图缓存锁住了文件。请关闭该目录相关的资源管理器窗口后再试一次。"
      };
    }

    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
