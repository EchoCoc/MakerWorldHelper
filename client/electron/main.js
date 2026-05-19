const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
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
const LIBRARY_CACHE_VERSION = 2;

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

  let hasRetriedDevLoad = false;

  win.webContents.on("did-fail-load", () => {
    if (!isDev || hasRetriedDevLoad) {
      return;
    }

    hasRetriedDevLoad = true;
    setTimeout(() => {
      win.loadURL("http://127.0.0.1:5173");
    }, 1200);
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
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
  const template = [
    {
      role: "fileMenu"
    },
    {
      role: "editMenu"
    },
    {
      role: "viewMenu"
    },
    {
      role: "windowMenu"
    },
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
  ];

  return Menu.buildFromTemplate(template);
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

  menu.popup({
    window: win
  });

  return { ok: true };
});

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

async function readDirectoryEntriesSafe(targetPath) {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
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

async function getPathStatSignature(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return `${path.basename(targetPath)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
  } catch {
    return `${path.basename(targetPath)}:missing`;
  }
}

async function getProjectFingerprint(projectPath) {
  const fingerprintParts = await Promise.all([
    getPathStatSignature(path.join(projectPath, "metadata.json")),
    getPathStatSignature(path.join(projectPath, "save-manifest.json")),
    getPathStatSignature(path.join(projectPath, "instances")),
    getPathStatSignature(path.join(projectPath, "model", "images"))
  ]);

  return fingerprintParts.join("|");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getModelFileType(fileName) {
  return path.extname(fileName || "").replace(/^\./, "").toLowerCase();
}

function isSupportedModelFile(fileName) {
  return MODEL_FILE_EXTENSIONS.has(getModelFileType(fileName));
}

const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);

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

function getInstanceDirectoryName(instance) {
  const raw = `${instance?.id || "instance"}-${instance?.title || "profile"}`;
  const sanitized = String(raw)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || `instance-${instance?.id || "x"}`;
}

async function buildInstanceItems(projectPath, metadata, manifest) {
  const manifestModelFiles = asArray(manifest?.assets?.modelFiles);
  const manifestPlateFiles = asArray(manifest?.assets?.plates);

  const instances = await Promise.all(asArray(metadata?.instances).map(async (instance) => {
    const instanceDir = getInstanceDirectoryName(instance);
    const coverPath = path.join(projectPath, "instances", instanceDir, "instance-cover.jpg");
    const filesDir = path.join(projectPath, "instances", instanceDir, "files");
    const coverAsset = await getAssetDescriptor(coverPath);

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
      const localPath = path.join(projectPath, "instances", instanceDir, "files", file.fileName || "");
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
        if (!entry.isFile()) {
          continue;
        }

        if (!isSupportedModelFile(entry.name)) {
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
      coverSrc: coverAsset?.src || instance.coverUrl || "",
      coverPath: coverAsset?.path || "",
      plateItems,
      modelFiles,
      filesDirectoryPath: filesDir,
      materialCount: instance.materialCount ?? 0,
      downloadCount: instance.downloadCount ?? 0,
      predictionSeconds: instance.predictionSeconds ?? null,
      weightGrams: instance.weightGrams ?? null
    };
  }));

  return instances;
}

async function readProject(projectPath, repo, cachedProject = null) {
  const metadataPath = path.join(projectPath, "metadata.json");
  if (!(await exists(metadataPath))) {
    return null;
  }

  const fingerprint = await getProjectFingerprint(projectPath);
  if (cachedProject?.cacheFingerprint === fingerprint) {
    return {
      ...cachedProject,
      id: `${repo.id}/${path.basename(projectPath)}`,
      repoId: repo.id,
      repoLabel: repo.name,
      repoKind: repo.kind === "default" ? "default" : "custom",
      projectPath
    };
  }

  const metadata = await readJsonFile(metadataPath);
  const manifestPath = path.join(projectPath, "save-manifest.json");
  const manifest = (await exists(manifestPath)) ? await readJsonFile(manifestPath) : null;
  const cover = await buildProjectCover(projectPath, manifest, metadata);
  const pictureItems = await buildPictureItems(projectPath, manifest);
  const instanceItems = await buildInstanceItems(projectPath, metadata, manifest);

  return {
    id: `${repo.id}/${path.basename(projectPath)}`,
    repoId: repo.id,
    repoLabel: repo.name,
    repoKind: repo.kind === "default" ? "default" : "custom",
    projectPath,
    title: metadata?.model?.title || path.basename(projectPath),
    author: metadata?.creator?.name || "未知作者",
    modelId: String(metadata?.model?.id ?? ""),
    tags: asArray(metadata?.model?.tags),
    summaryHtml: metadata?.model?.summaryHtml || "",
    summaryText: metadata?.model?.summaryText || "",
    sourceUrl: metadata?.sourceUrl || "",
    coverPath: cover.coverPath,
    coverSrc: cover.coverSrc,
    coverUrl: cover.coverUrl,
    pictureItems,
    instanceItems,
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
        return { type: "repo", repo, projects: repoProjects };
      })
  );

  const repositories = [];
  const projects = [];

  for (const entry of scannedEntries) {
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

function sanitizeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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

