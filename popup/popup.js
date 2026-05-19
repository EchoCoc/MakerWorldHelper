const openLibraryButton = document.getElementById("openLibraryButton");
const pickDirectoryButton = document.getElementById("pickDirectoryButton");
const extractButton = document.getElementById("extractButton");
const saveButton = document.getElementById("saveButton");
const statusNode = document.getElementById("status");
const summaryNode = document.getElementById("summary");
const directorySummaryNode = document.getElementById("directorySummary");
const jsonOutputNode = document.getElementById("jsonOutput");
const savedResourcesCard = document.getElementById("savedResourcesCard");
const savedResourcesSummaryNode = document.getElementById("savedResourcesSummary");
const savedResourcesOutputNode = document.getElementById("savedResourcesOutput");

let currentRecord = null;
let directoryHandle = null;

function setStatus(message) {
  statusNode.textContent = message;
}

function setDirectorySummary(label) {
  directorySummaryNode.innerHTML = `<dt>保存目录</dt><dd>${label}</dd>`;
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);

function normalizeCompatibilityName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return INVALID_COMPATIBILITY_CODES.has(text.toUpperCase()) ? "" : text;
}

function sanitizeCompatibilityValue(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeCompatibilityValue(item))
      .filter((item) => item != null);
  }

  if (typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "devModelName") {
        continue;
      }
      next[key] = sanitizeCompatibilityValue(item);
    }
    return next;
  }

  return value;
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

function formatCompatibility(compatibility, otherCompatibility) {
  const bucket = [];
  collectCompatibilityParts(compatibility, bucket);
  collectCompatibilityParts(otherCompatibility, bucket);

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

  return unique.join(" / ");
}

function sanitizeInstanceRecord(instance) {
  const compatibility = sanitizeCompatibilityValue(instance?.compatibility || null);
  const otherCompatibility = Array.isArray(instance?.otherCompatibility)
    ? sanitizeCompatibilityValue(instance.otherCompatibility)
    : [];

  return {
    ...instance,
    compatibility,
    otherCompatibility,
    compatibilityText: formatCompatibility(compatibility, otherCompatibility)
  };
}

function sanitizeModelRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const instances = Array.isArray(record.instances)
    ? record.instances.map((instance) => sanitizeInstanceRecord(instance))
    : [];

  return {
    ...record,
    instances,
    downloadHints: record.downloadHints
  };
}

function isCaptchaBlockedMessage(message) {
  return /HTTP 418|not a robot|captcha/i.test(String(message || ""));
}

function shouldExpectModelFile(instance) {
  return Boolean(instance?.hasZipStl || instance?.appCanPrint);
}

function getSignedUrlExpiryTime(url) {
  try {
    const exp = Number.parseInt(new URL(url).searchParams.get("exp") || "", 10);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function shouldRefreshInstanceDownload(instance) {
  if (!shouldExpectModelFile(instance)) {
    return false;
  }

  const download = instance?.downloads?.f3mf;
  if (!download?.ok || !download.url) {
    return true;
  }

  const expiryTime = getSignedUrlExpiryTime(download.url);
  if (!expiryTime) {
    return false;
  }

  return expiryTime - Date.now() < 2 * 60 * 1000;
}

function shouldRefreshRecordDownloads(record) {
  return Array.isArray(record?.instances) && record.instances.some((instance) => shouldRefreshInstanceDownload(instance));
}

function hideSavedResources() {
  savedResourcesCard.classList.add("hidden");
  savedResourcesSummaryNode.textContent = "";
  savedResourcesOutputNode.textContent = "";
}

function renderSummary(record) {
  const items = [
    ["标题", record?.model?.title || "-"],
    ["模型 ID", record?.model?.id ?? "-"],
    ["作者", record?.creator?.name || "-"],
    ["配置数", String(record?.instances?.length ?? 0)],
    ["图片数", String(record?.model?.pictures?.length ?? 0)],
    ["标签", (record?.model?.tags || []).join(" / ") || "-"]
  ];

  summaryNode.innerHTML = items
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
}

function createSavedResourceLines(record, folderName, assets) {
  const lines = [`${folderName}/`];

  lines.push("  metadata.json");
  lines.push("  summary.txt");
  lines.push("  source-url.txt");
  lines.push("  download-hints.json");
  lines.push("  comments-preview.json");
  lines.push("  save-manifest.json");
  lines.push("  model/");
  lines.push("    images/");

  if (assets?.cover) {
    lines.push(`      ${assets.cover}`);
  }

  for (const picture of assets?.pictures || []) {
    if (picture?.fileName) {
      lines.push(`      ${picture.fileName}`);
    }
  }

  lines.push("  instances/");

  for (const instance of record?.instances || []) {
    const instanceDirName =
      sanitizeName(`${instance.id || "instance"}-${instance.title || "profile"}`) ||
      `instance-${instance.id || "x"}`;
    lines.push(`    ${instanceDirName}/`);
    lines.push("      instance.json");
    lines.push("      plates/");

    for (const plate of assets?.plates?.filter((item) => item.instanceId === instance.id) || []) {
      if (plate.fileName) {
        lines.push(`        ${plate.fileName}`);
      }
    }

    lines.push("      files/");

    for (const file of assets?.modelFiles?.filter((item) => item.instanceId === instance.id) || []) {
      if (file.fileName) {
        lines.push(`        ${file.fileName}`);
      }
    }
  }

  return lines;
}

function showSavedResources(record, folderName, assets) {
  savedResourcesSummaryNode.textContent =
    "受浏览器安全限制，扩展无法直接打开系统文件夹，这里展示本次保存下来的资源结构。";
  savedResourcesOutputNode.textContent = createSavedResourceLines(record, folderName, assets).join("\n");
  savedResourcesCard.classList.remove("hidden");
}

async function verifyDirectoryPermission(handle, readWrite) {
  const options = readWrite ? { mode: "readwrite" } : {};

  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function pickDirectory() {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("当前浏览器不支持目录选择 API。");
  }

  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const granted = await verifyDirectoryPermission(handle, true);

  if (!granted) {
    throw new Error("未获得目录写入权限。");
  }

  directoryHandle = handle;
  setDirectorySummary(handle.name || "已选择目录");
}

async function ensureDirectory(parentHandle, name) {
  return parentHandle.getDirectoryHandle(name, { create: true });
}

async function writeTextFile(parentHandle, name, content) {
  const fileHandle = await parentHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function fetchBlob(url) {
  const response = await fetch(url, { credentials: "omit" });

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${url}`);
  }

  return response.blob();
}

async function writeBlobFile(parentHandle, name, blob) {
  const fileHandle = await parentHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function getFileNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return sanitizeName(last || fallback) || fallback;
  } catch {
    return fallback;
  }
}

async function downloadToFile(parentHandle, url, fallbackName) {
  if (!url) {
    return null;
  }

  const blob = await fetchBlob(url);
  const fileName = getFileNameFromUrl(url, fallbackName);
  await writeBlobFile(parentHandle, fileName, blob);
  return fileName;
}

async function saveAssets(rootHandle, record) {
  const saved = {
    cover: null,
    pictures: [],
    instancePictures: [],
    plates: [],
    modelFiles: [],
    modelFilesMissing: []
  };

  const modelDir = await ensureDirectory(rootHandle, "model");
  const imagesDir = await ensureDirectory(modelDir, "images");

  if (record?.model?.coverUrl) {
    saved.cover = await downloadToFile(imagesDir, record.model.coverUrl, "cover.jpg");
  }

  for (let index = 0; index < (record?.model?.pictures || []).length; index += 1) {
    const picture = record.model.pictures[index];
    const fileName = await downloadToFile(
      imagesDir,
      picture.url,
      `detail-${String(index + 1).padStart(2, "0")}.jpg`
    );
    saved.pictures.push({ source: picture.url, fileName });
  }

  const instancesDir = await ensureDirectory(rootHandle, "instances");

  for (const instance of record?.instances || []) {
    const instanceDirName =
      sanitizeName(`${instance.id || "instance"}-${instance.title || "profile"}`) ||
      `instance-${instance.id || "x"}`;
    const instanceDir = await ensureDirectory(instancesDir, instanceDirName);
    const plateDir = await ensureDirectory(instanceDir, "plates");
    const fileDir = await ensureDirectory(instanceDir, "files");

    await writeTextFile(instanceDir, "instance.json", JSON.stringify(instance, null, 2));

    if (instance.coverUrl) {
      const fileName = await downloadToFile(instanceDir, instance.coverUrl, "instance-cover.jpg");
      saved.instancePictures.push({ instanceId: instance.id, fileName });
    }

    for (const plate of instance.plates || []) {
      const fileName = await downloadToFile(
        plateDir,
        plate.thumbnailUrl || plate.topPictureUrl || plate.pickPictureUrl,
        `plate-${plate.index || "x"}.png`
      );
      saved.plates.push({ instanceId: instance.id, plateIndex: plate.index, fileName });
    }

    if (instance.downloads?.f3mf?.ok && instance.downloads.f3mf.url) {
      try {
        const fileName = await downloadToFile(
          fileDir,
          instance.downloads.f3mf.url,
          instance.downloads.f3mf.name || `instance-${instance.id}.3mf`
        );
        saved.modelFiles.push({
          instanceId: instance.id,
          type: "f3mf",
          fileName,
          source: instance.downloads.f3mf.url
        });
      } catch (error) {
        saved.modelFilesMissing.push({
          instanceId: instance.id,
          title: instance.title || "",
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    } else if (shouldExpectModelFile(instance)) {
      saved.modelFilesMissing.push({
        instanceId: instance.id,
        title: instance.title || "",
        reason: instance.downloads?.f3mf?.error || "未获取到 3MF 下载链接。"
      });
    }
  }

  return saved;
}

function getMissingModelFileSummary(assets) {
  const missingItems = Array.isArray(assets?.modelFilesMissing) ? assets.modelFilesMissing : [];
  const captchaBlockedCount = missingItems.filter((item) => isCaptchaBlockedMessage(item.reason)).length;

  return {
    missingCount: missingItems.length,
    captchaBlockedCount
  };
}

async function extractModel() {
  setStatus("正在读取当前标签页...");
  summaryNode.innerHTML = "";
  jsonOutputNode.textContent = "解析中...";
  hideSavedResources();

  const response = await chrome.runtime.sendMessage({ type: "mwqs:get-active-model" });

  if (!response?.ok) {
    throw new Error(response?.error || "未知错误");
  }

  return response.data;
}

async function saveRecord() {
  if (!directoryHandle) {
    throw new Error("请先选择保存目录。");
  }

  if (!currentRecord) {
    throw new Error("请先解析当前页面。");
  }

  const granted = await verifyDirectoryPermission(directoryHandle, true);
  if (!granted) {
    throw new Error("保存目录未授权写入。");
  }

  let sanitizedRecord = sanitizeModelRecord(currentRecord);

  if (shouldRefreshRecordDownloads(sanitizedRecord)) {
    setStatus("正在刷新 3MF 下载链接...");
    sanitizedRecord = sanitizeModelRecord(await extractModel());
    currentRecord = sanitizedRecord;
    renderSummary(sanitizedRecord);
    jsonOutputNode.textContent = JSON.stringify(sanitizedRecord, null, 2);
  }

  const rootFolderName =
    sanitizeName(sanitizedRecord.folderName) ||
    sanitizeName(sanitizedRecord.model?.title) ||
    `makerworld-${currentRecord.model?.id || "model"}`;
  const projectDir = await ensureDirectory(directoryHandle, rootFolderName);
  const assets = await saveAssets(projectDir, sanitizedRecord);

  await writeTextFile(projectDir, "metadata.json", JSON.stringify(sanitizedRecord, null, 2));
  await writeTextFile(projectDir, "summary.txt", sanitizedRecord.model?.summaryText || "");
  await writeTextFile(projectDir, "source-url.txt", `${sanitizedRecord.sourceUrl}\n`);
  await writeTextFile(
    projectDir,
    "download-hints.json",
    JSON.stringify(sanitizedRecord.downloadHints || {}, null, 2)
  );
  await writeTextFile(
    projectDir,
    "comments-preview.json",
    JSON.stringify(sanitizedRecord.commentsPreview || [], null, 2)
  );

  const manifest = {
    savedAt: new Date().toISOString(),
    folderName: rootFolderName,
    modelId: sanitizedRecord.model?.id ?? null,
    title: sanitizedRecord.model?.title || "",
    assets
  };

  await writeTextFile(projectDir, "save-manifest.json", JSON.stringify(manifest, null, 2));
  return {
    folderName: rootFolderName,
    assets,
    missingModelFileCount: assets.modelFilesMissing?.length || 0
  };
}

openLibraryButton.addEventListener("click", () => {
  const url = chrome.runtime.getURL("library/library.html");
  chrome.tabs.create({ url });
});

pickDirectoryButton.addEventListener("click", async () => {
  try {
    setStatus("正在请求目录权限...");
    await pickDirectory();
    hideSavedResources();
    setStatus("保存目录已设置。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

extractButton.addEventListener("click", async () => {
  try {
    const record = sanitizeModelRecord(await extractModel());
    currentRecord = record;
    renderSummary(record);
    jsonOutputNode.textContent = JSON.stringify(record, null, 2);
    saveButton.disabled = false;

    const captchaBlockedCount = (record.instances || []).filter((instance) =>
      isCaptchaBlockedMessage(instance?.downloads?.f3mf?.error)
    ).length;

    setStatus(
      captchaBlockedCount > 0
        ? `解析成功，但有 ${captchaBlockedCount} 个配置的 3MF 被站点人机验证拦截。请先回到 MakerWorld 页面完成验证，再保存。`
        : "解析成功，可以保存当前项目了。"
    );
  } catch (error) {
    currentRecord = null;
    saveButton.disabled = true;
    jsonOutputNode.textContent = "解析失败";
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

saveButton.addEventListener("click", async () => {
  try {
    saveButton.disabled = true;
    setStatus("正在写入本地目录并下载图片与模型文件...");
    const result = await saveRecord();
    const summary = getMissingModelFileSummary(result.assets);

    setStatus(
      summary.captchaBlockedCount > 0
        ? `保存完成，目录名：${result.folderName}。其中 ${summary.captchaBlockedCount} 个配置的 3MF 被站点人机验证拦截，请回到 MakerWorld 页面完成验证后重新保存。`
        : result.missingModelFileCount > 0
          ? `保存完成，目录名：${result.folderName}。其中 ${result.missingModelFileCount} 个配置未保存到 3MF。`
        : `保存完成，目录名：${result.folderName}`
    );

    const shouldShowResources = window.confirm(
      "资源已保存完成。\n\n是否查看本次保存的资源结构？\n\n说明：浏览器扩展不能直接打开系统文件夹。"
    );

    if (shouldShowResources) {
      showSavedResources(currentRecord, result.folderName, result.assets);
    } else {
      hideSavedResources();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    saveButton.disabled = !currentRecord;
  }
});

setDirectorySummary("本次会话未选择");
hideSavedResources();
