const pickDirectoryButton = document.getElementById("pickDirectoryButton");
const setDefaultDirectoryButton = document.getElementById("setDefaultDirectoryButton");
const restoreDefaultDirectoryButton = document.getElementById("restoreDefaultDirectoryButton");
const clearDefaultDirectoryButton = document.getElementById("clearDefaultDirectoryButton");
const openWorkbenchButton = document.getElementById("openWorkbenchButton");
const extractButton = document.getElementById("extractButton");
const quickSaveButton = document.getElementById("quickSaveButton");
const saveButton = document.getElementById("saveButton");
const metadataOnlyCheckbox = document.getElementById("metadataOnlyCheckbox");
const instanceSelectionSection = document.getElementById("instanceSelectionSection");
const instanceSelectionSummaryNode = document.getElementById("instanceSelectionSummary");
const instanceSelectionListNode = document.getElementById("instanceSelectionList");
const selectAllInstancesButton = document.getElementById("selectAllInstancesButton");
const clearAllInstancesButton = document.getElementById("clearAllInstancesButton");
const statusNode = document.getElementById("status");
const summaryNode = document.getElementById("summary");
const directorySummaryNode = document.getElementById("directorySummary");
const jsonOutputNode = document.getElementById("jsonOutput");
const savedResourcesCard = document.getElementById("savedResourcesCard");
const savedResourcesSummaryNode = document.getElementById("savedResourcesSummary");
const savedResourcesOutputNode = document.getElementById("savedResourcesOutput");
const workbenchBanner = document.getElementById("workbenchBanner");
const workbenchSummaryNode = document.getElementById("workbenchSummary");

const DEFAULT_DIRECTORY_DB_NAME = "mw-helper-popup";
const DEFAULT_DIRECTORY_STORE_NAME = "settings";
const PROJECT_INDEX_STORE_NAME = "projects";
const SETTINGS_DATABASE_VERSION = 2;
const DEFAULT_DIRECTORY_KEY = "default-save-directory";
const LEGACY_DOWNLOAD_INDEX_KEY = "mwqs:download-index:v1";
const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);
const pageParams = new URLSearchParams(window.location.search);
const panelMode = pageParams.get("mode") || "";
const isStandaloneWorkbench = panelMode === "standalone";
const isInlinePanel = panelMode === "inpage";
const sourceTabId = Number.parseInt(pageParams.get("sourceTabId") || "", 10);

let currentRecord = null;
let directoryHandle = null;
let defaultDirectoryHandle = null;
let defaultDirectoryName = "";
let activeDirectoryIsDefault = false;
let isBusy = false;
let selectedInstanceIds = new Set();
let selectionScopeKey = "";

function getBoundSourceTabId() {
  return Number.isInteger(sourceTabId) && sourceTabId > 0 ? sourceTabId : null;
}

async function refreshBoundPageDownloadStatus() {
  try {
    await chrome.runtime.sendMessage({
      type: "mwqs:refresh-project-download-status",
      tabId: getBoundSourceTabId()
    });
  } catch {
    // The save flow remains valid even if the source tab was closed.
  }
}

function setStatus(message) {
  statusNode.textContent = String(message || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDirectorySummary() {
  const activeLabel = directoryHandle
    ? `${directoryHandle.name}${activeDirectoryIsDefault ? "（默认）" : ""}`
    : "本次会话未选择";
  const defaultLabel = defaultDirectoryName || "未设置";

  directorySummaryNode.innerHTML = [
    `<dt>保存目录</dt><dd>${escapeHtml(activeLabel)}</dd>`,
    `<dt>默认目录</dt><dd>${escapeHtml(defaultLabel)}</dd>`
  ].join("");
}

function updateDirectoryActionButtons() {
  pickDirectoryButton.disabled = isBusy;
  setDefaultDirectoryButton.disabled = isBusy || !directoryHandle || activeDirectoryIsDefault;
  restoreDefaultDirectoryButton.disabled = isBusy || !defaultDirectoryHandle || activeDirectoryIsDefault;
  clearDefaultDirectoryButton.disabled = isBusy || !defaultDirectoryHandle;
  openWorkbenchButton.disabled = isBusy || isStandaloneWorkbench || isInlinePanel;
  extractButton.disabled = isBusy;
  quickSaveButton.disabled = isBusy;
  saveButton.disabled = isBusy || !currentRecord;
  metadataOnlyCheckbox.disabled = isBusy || !currentRecord;
  selectAllInstancesButton.disabled = isBusy || !currentRecord || metadataOnlyCheckbox.checked;
  clearAllInstancesButton.disabled = isBusy || !currentRecord || metadataOnlyCheckbox.checked;

  setDefaultDirectoryButton.textContent = activeDirectoryIsDefault ? "已设为默认目录" : "设为默认目录";
  restoreDefaultDirectoryButton.textContent = activeDirectoryIsDefault
    ? "当前正在使用默认目录"
    : "恢复默认目录";
  clearDefaultDirectoryButton.textContent = defaultDirectoryHandle ? "清除默认目录" : "未设置默认目录";

  setDefaultDirectoryButton.classList.toggle("active", activeDirectoryIsDefault);
  restoreDefaultDirectoryButton.classList.toggle("active", activeDirectoryIsDefault);
  instanceSelectionSection.classList.toggle("disabled", metadataOnlyCheckbox.checked);
}

function renderWorkbenchBanner() {
  if (!isStandaloneWorkbench) {
    workbenchBanner.classList.add("hidden");
    return;
  }

  const boundTabId = getBoundSourceTabId();
  workbenchSummaryNode.textContent = boundTabId
    ? `当前窗口已绑定 MakerWorld 页面（标签页 ID：${boundTabId}），切到其他页面时这里不会自动关闭，保存任务也会继续执行。`
    : "当前窗口已进入常驻工作台模式，但还没有绑定有效的 MakerWorld 页面。";
  workbenchBanner.classList.remove("hidden");
}

function setBusyState(nextBusy) {
  isBusy = Boolean(nextBusy);
  updateDirectoryActionButtons();
}

function setActiveDirectory(handle, { isDefault = false } = {}) {
  directoryHandle = handle;
  activeDirectoryIsDefault = Boolean(handle && isDefault);
  renderDirectorySummary();
  updateDirectoryActionButtons();
}

function clearDefaultDirectoryState() {
  defaultDirectoryHandle = null;
  defaultDirectoryName = "";
  activeDirectoryIsDefault = false;
  renderDirectorySummary();
  updateDirectoryActionButtons();
}

function openSettingsDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEFAULT_DIRECTORY_DB_NAME, SETTINGS_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEFAULT_DIRECTORY_STORE_NAME)) {
        database.createObjectStore(DEFAULT_DIRECTORY_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(PROJECT_INDEX_STORE_NAME)) {
        database.createObjectStore(PROJECT_INDEX_STORE_NAME, { keyPath: "modelId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开默认目录存储失败。"));
  });
}

async function readStoredDefaultDirectory() {
  const database = await openSettingsDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEFAULT_DIRECTORY_STORE_NAME, "readonly");
    const store = transaction.objectStore(DEFAULT_DIRECTORY_STORE_NAME);
    const request = store.get(DEFAULT_DIRECTORY_KEY);

    request.onsuccess = () => {
      database.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("读取默认目录失败。"));
    };
  });
}

async function writeStoredDefaultDirectory(handle) {
  const database = await openSettingsDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEFAULT_DIRECTORY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DEFAULT_DIRECTORY_STORE_NAME);
    const request = store.put(handle, DEFAULT_DIRECTORY_KEY);

    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("保存默认目录失败。"));
    };
  });
}

async function clearStoredDefaultDirectory() {
  const database = await openSettingsDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEFAULT_DIRECTORY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DEFAULT_DIRECTORY_STORE_NAME);
    const request = store.delete(DEFAULT_DIRECTORY_KEY);

    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("清除默认目录失败。"));
    };
  });
}

async function clearProjectDownloadIndex() {
  const database = await openSettingsDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(PROJECT_INDEX_STORE_NAME, "readwrite");
    transaction.objectStore(PROJECT_INDEX_STORE_NAME).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("清理项目下载索引失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("清理项目下载索引失败。"));
  });
  database.close();
  await chrome.storage.local.remove(LEGACY_DOWNLOAD_INDEX_KEY);
}

async function loadDefaultDirectoryState() {
  const storedHandle = await readStoredDefaultDirectory();
  if (!storedHandle) {
    clearDefaultDirectoryState();
    return false;
  }

  defaultDirectoryHandle = storedHandle;
  defaultDirectoryName = storedHandle.name || "已保存目录";
  renderDirectorySummary();
  updateDirectoryActionButtons();
  return true;
}

async function restoreDefaultDirectory({ requestAccess = false } = {}) {
  if (!defaultDirectoryHandle) {
    const loaded = await loadDefaultDirectoryState();
    if (!loaded || !defaultDirectoryHandle) {
      throw new Error("当前还没有设置默认目录。");
    }
  }

  const options = { mode: "readwrite" };
  const permissionState = await defaultDirectoryHandle.queryPermission(options);
  let granted = permissionState === "granted";

  if (!granted && requestAccess) {
    granted = (await defaultDirectoryHandle.requestPermission(options)) === "granted";
  }

  if (!granted) {
    throw new Error("默认目录尚未授权，请点击“恢复默认目录”重新授权。");
  }

  setActiveDirectory(defaultDirectoryHandle, { isDefault: true });
  return defaultDirectoryHandle;
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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

function getSelectionScopeKey(record) {
  return `${record?.model?.id ?? ""}|${record?.sourceUrl ?? ""}`;
}

function getInstanceSelectionId(instance) {
  return String(instance?.id ?? getInstanceDirectoryName(instance));
}

function getCurrentSaveOptions() {
  return {
    metadataOnly: Boolean(metadataOnlyCheckbox?.checked),
    selectedInstanceIds: new Set(selectedInstanceIds)
  };
}

function syncSelectedInstanceIds(record, { preserveExisting = true } = {}) {
  const nextScopeKey = getSelectionScopeKey(record);
  const availableIds = (record?.instances || []).map((instance) => getInstanceSelectionId(instance));
  const availableIdSet = new Set(availableIds);

  if (!preserveExisting || nextScopeKey !== selectionScopeKey) {
    selectedInstanceIds = new Set(availableIds);
    selectionScopeKey = nextScopeKey;
    return;
  }

  selectedInstanceIds = new Set(
    [...selectedInstanceIds].filter((instanceId) => availableIdSet.has(instanceId))
  );
}

function getSelectedInstanceCount(record) {
  return (record?.instances || []).filter((instance) =>
    selectedInstanceIds.has(getInstanceSelectionId(instance))
  ).length;
}

function renderInstanceSelection() {
  if (!currentRecord || !Array.isArray(currentRecord.instances) || currentRecord.instances.length === 0) {
    instanceSelectionListNode.className = "instanceList empty";
    instanceSelectionListNode.textContent = "尚未解析配置";
    instanceSelectionSummaryNode.textContent = "解析后可按配置勾选需要下载的打印文件。";
    return;
  }

  const metadataOnly = Boolean(metadataOnlyCheckbox.checked);
  const selectedCount = getSelectedInstanceCount(currentRecord);
  const totalCount = currentRecord.instances.length;

  instanceSelectionSummaryNode.textContent = metadataOnly
    ? `当前为仅描述模式，本次不会下载任何图片、文档和 3MF 文件。共保留 ${totalCount} 个配置的描述信息。`
    : `当前将下载 ${selectedCount} / ${totalCount} 个配置的打印文件；未勾选的配置只保存描述和元数据。`;

  instanceSelectionListNode.className = "instanceList";
  instanceSelectionListNode.innerHTML = currentRecord.instances
    .map((instance) => {
      const selectionId = getInstanceSelectionId(instance);
      const checked = selectedInstanceIds.has(selectionId) ? "checked" : "";
      const compatibilityText = instance?.compatibilityText || "未识别机型";
      const plateCount = Array.isArray(instance?.plates) ? instance.plates.length : 0;

      return `
        <label class="instanceItem">
          <input type="checkbox" class="instanceCheckbox" data-instance-id="${escapeHtml(selectionId)}" ${checked}>
          <div class="instanceInfo">
            <div class="instanceTitle">${escapeHtml(instance?.title || `配置 ${selectionId}`)}</div>
            <div class="instanceMeta">${escapeHtml(compatibilityText)} · ${plateCount} 个 plate</div>
          </div>
        </label>
      `;
    })
    .join("");

  for (const checkbox of instanceSelectionListNode.querySelectorAll(".instanceCheckbox")) {
    checkbox.disabled = metadataOnly || isBusy;
    checkbox.addEventListener("change", (event) => {
      const instanceId = event.currentTarget?.dataset?.instanceId;
      if (!instanceId) {
        return;
      }

      if (event.currentTarget.checked) {
        selectedInstanceIds.add(instanceId);
      } else {
        selectedInstanceIds.delete(instanceId);
      }

      renderInstanceSelection();
      updateDirectoryActionButtons();
    });
  }
}

function createSavedResourceLines(record, folderName, assets) {
  const lines = [`${folderName}/`];
  const selectedInstanceIds = new Set(assets?.selectedInstanceIds || []);
  const metadataOnly = Boolean(assets?.metadataOnly);

  lines.push("  metadata.json");
  lines.push("  summary.txt");
  lines.push("  source-url.txt");
  lines.push("  download-hints.json");
  lines.push("  comments-preview.json");
  lines.push("  save-manifest.json");
  if (!metadataOnly) {
    lines.push("  model/");
    lines.push("    images/");
  }

  if (assets?.cover) {
    lines.push(`      ${assets.cover}`);
  }

  for (const picture of assets?.pictures || []) {
    if (picture?.fileName) {
      lines.push(`      ${picture.fileName}`);
    }
  }

  if ((assets?.documents || []).length > 0 || (assets?.materialFiles || []).length > 0) {
    lines.push("    documents/");
  }

  for (const documentItem of assets?.documents || []) {
    if (documentItem?.fileName) {
      lines.push(`      ${documentItem.fileName}`);
    }
  }

  for (const materialFile of assets?.materialFiles || []) {
    if (materialFile?.fileName) {
      lines.push(`      ${materialFile.fileName}`);
    }
  }

  lines.push("  instances/");

  for (const instance of record?.instances || []) {
    const instanceDirName =
      sanitizeName(`${instance.id || "instance"}-${instance.title || "profile"}`) ||
      `instance-${instance.id || "x"}`;
    lines.push(`    ${instanceDirName}/`);
    lines.push("      instance.json");
    if (metadataOnly || !selectedInstanceIds.has(getInstanceSelectionId(instance))) {
      continue;
    }

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

  let isDefault = false;
  if (defaultDirectoryHandle && typeof handle.isSameEntry === "function") {
    try {
      isDefault = await handle.isSameEntry(defaultDirectoryHandle);
    } catch {
      isDefault = false;
    }
  }

  setActiveDirectory(handle, { isDefault });
  return handle;
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

async function writeJsonFile(parentHandle, name, value) {
  await writeTextFile(parentHandle, name, JSON.stringify(value, null, 2));
}

async function readExistingFile(parentHandle, name) {
  try {
    const fileHandle = await parentHandle.getFileHandle(name, { create: false });
    const file = await fileHandle.getFile();
    return file;
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function fetchBlob(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "*/*" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.blob();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError || "未知错误");
  throw new Error(`下载失败: ${reason} ${url}`);
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

function createTransferResult(fileName, { reused = false } = {}) {
  return {
    fileName,
    reused
  };
}

function recordTransferStats(saved, transferResult) {
  if (!transferResult) {
    return;
  }

  if (transferResult.reused) {
    saved.reusedCount += 1;
  } else {
    saved.downloadedCount += 1;
  }
}

function recordAssetFailure(saved, kind, url, error, details = {}) {
  saved.failedAssets.push({
    kind,
    url: String(url || ""),
    reason: error instanceof Error ? error.message : String(error),
    ...details
  });
}

async function downloadOptionalToFile(saved, kind, parentHandle, url, fallbackName, options, details = {}) {
  try {
    return await downloadToFile(parentHandle, url, fallbackName, options);
  } catch (error) {
    recordAssetFailure(saved, kind, url, error, details);
    return null;
  }
}

async function downloadToFile(parentHandle, url, fallbackName, { preferExisting = false } = {}) {
  if (!url) {
    return null;
  }

  const fileName = getFileNameFromUrl(url, fallbackName);
  if (preferExisting) {
    const existingFile = await readExistingFile(parentHandle, fileName);
    if (existingFile && existingFile.size > 0) {
      return createTransferResult(fileName, { reused: true });
    }
  }

  const blob = await fetchBlob(url);
  await writeBlobFile(parentHandle, fileName, blob);
  return createTransferResult(fileName);
}

function getInstanceDirectoryName(instance) {
  return (
    sanitizeName(`${instance.id || "instance"}-${instance.title || "profile"}`) ||
    `instance-${instance.id || "x"}`
  );
}

async function findExistingModelFileName(instanceFilesDir) {
  try {
    for await (const entry of instanceFilesDir.values()) {
      if (entry.kind !== "file" || !/\.3mf$/i.test(entry.name)) {
        continue;
      }

      const file = await entry.getFile();
      if (file.size > 0) {
        return entry.name;
      }
    }
    return null;
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function shouldRefreshRecordDownloadsForProject(rootHandle, record, saveOptions = {}) {
  if (saveOptions.metadataOnly) {
    return false;
  }

  let instancesDir = null;

  try {
    instancesDir = await rootHandle.getDirectoryHandle("instances", { create: false });
  } catch (error) {
    if (error?.name !== "NotFoundError") {
      throw error;
    }
  }

  for (const instance of record?.instances || []) {
    if (!saveOptions.selectedInstanceIds?.has(getInstanceSelectionId(instance))) {
      continue;
    }

    if (!shouldExpectModelFile(instance)) {
      continue;
    }

    let hasLocalModelFile = false;
    if (instancesDir) {
      try {
        const instanceDir = await instancesDir.getDirectoryHandle(getInstanceDirectoryName(instance), {
          create: false
        });
        const filesDir = await instanceDir.getDirectoryHandle("files", { create: false });
        hasLocalModelFile = Boolean(await findExistingModelFileName(filesDir));
      } catch (error) {
        if (error?.name !== "NotFoundError") {
          throw error;
        }
      }
    }

    if (hasLocalModelFile) {
      continue;
    }

    const download = instance?.downloads?.f3mf;
    if (!download?.ok || !download.url) {
      return true;
    }

    const expiryTime = getSignedUrlExpiryTime(download.url);
    if (expiryTime && expiryTime - Date.now() < 2 * 60 * 1000) {
      return true;
    }
  }

  return false;
}

async function saveAssets(rootHandle, record, saveOptions = {}) {
  const saved = {
    metadataOnly: Boolean(saveOptions.metadataOnly),
    selectedInstanceIds: [...(saveOptions.selectedInstanceIds || [])],
    cover: null,
    pictures: [],
    documents: [],
    instancePictures: [],
    plates: [],
    materialFiles: [],
    modelFiles: [],
    modelFilesMissing: [],
    failedAssets: [],
    downloadedCount: 0,
    reusedCount: 0
  };

  let imagesDir = null;
  let documentsDir = null;
  if (!saveOptions.metadataOnly) {
    const modelDir = await ensureDirectory(rootHandle, "model");
    imagesDir = await ensureDirectory(modelDir, "images");
    documentsDir = await ensureDirectory(modelDir, "documents");
  }

  if (!saveOptions.metadataOnly && record?.model?.coverUrl) {
    const transfer = await downloadOptionalToFile(
      saved,
      "model-cover",
      imagesDir,
      record.model.coverUrl,
      "cover.jpg",
      { preferExisting: true }
    );
    recordTransferStats(saved, transfer);
    saved.cover = transfer?.fileName || null;
  }

  if (!saveOptions.metadataOnly) {
    for (let index = 0; index < (record?.model?.pictures || []).length; index += 1) {
      const picture = record.model.pictures[index];
      const transfer = await downloadOptionalToFile(
        saved,
        "model-picture",
        imagesDir,
        picture.url,
        `detail-${String(index + 1).padStart(2, "0")}.jpg`,
        { preferExisting: true },
        { index }
      );
      recordTransferStats(saved, transfer);
      saved.pictures.push({ source: picture.url, fileName: transfer?.fileName || null });
    }
  }

  if (!saveOptions.metadataOnly) {
    for (let index = 0; index < (record?.model?.documents || []).length; index += 1) {
      const documentItem = record.model.documents[index];
      if (!documentItem?.url) {
        continue;
      }

      const fallbackName =
        sanitizeName(documentItem.title || `document-${String(index + 1).padStart(2, "0")}.pdf`) ||
        `document-${String(index + 1).padStart(2, "0")}.pdf`;
      const transfer = await downloadOptionalToFile(
        saved,
        "document",
        documentsDir,
        documentItem.url,
        fallbackName,
        { preferExisting: true },
        { title: documentItem.title || "" }
      );
      if (transfer) {
        recordTransferStats(saved, transfer);
        saved.documents.push({
          title: documentItem.title || transfer?.fileName,
          source: documentItem.url,
          fileName: transfer?.fileName || null
        });
      }
    }
  }

  if (!saveOptions.metadataOnly && record?.model?.materials?.download?.url) {
    const transfer = await downloadOptionalToFile(
      saved,
      "materials-document",
      documentsDir,
      record.model.materials.download.url,
      sanitizeName(record.model.materials.download.title || "materials-list") || "materials-list",
      { preferExisting: true },
      { title: record.model.materials.download.title || "" }
    );
    if (transfer) {
      recordTransferStats(saved, transfer);
      saved.materialFiles.push({
        title: record.model.materials.download.title || transfer?.fileName,
        source: record.model.materials.download.url,
        fileName: transfer?.fileName || null
      });
    }
  }

  const materialGroups = Array.isArray(record?.model?.materials?.groups) ? record.model.materials.groups : [];
  if (!saveOptions.metadataOnly && materialGroups.length > 0) {
    const materialJsonName = "materials-list.json";
    const materialTextName = "materials-list.txt";
    const materialLines = [];

    for (const group of materialGroups) {
      materialLines.push(group?.title || "物料清单");
      for (const item of group?.items || []) {
        const parts = [item?.name || ""];
        if (item?.sku) {
          parts.push(`SKU: ${item.sku}`);
        }
        if (item?.quantity != null) {
          parts.push(`x ${item.quantity}`);
        }
        if (item?.url) {
          parts.push(item.url);
        }
        materialLines.push(`- ${parts.filter(Boolean).join(" | ")}`);
      }
      materialLines.push("");
    }

    await writeJsonFile(documentsDir, materialJsonName, materialGroups);
    await writeTextFile(documentsDir, materialTextName, materialLines.join("\n").trim());
    saved.materialFiles.push({
      title: "物料清单(JSON)",
      source: "",
      fileName: materialJsonName
    });
    saved.materialFiles.push({
      title: "物料清单(TXT)",
      source: "",
      fileName: materialTextName
    });
  }

  const instancesDir = await ensureDirectory(rootHandle, "instances");

  for (const instance of record?.instances || []) {
    const instanceDirName = getInstanceDirectoryName(instance);
    const instanceDir = await ensureDirectory(instancesDir, instanceDirName);
    const shouldDownloadFiles =
      !saveOptions.metadataOnly && saveOptions.selectedInstanceIds?.has(getInstanceSelectionId(instance));
    const plateDir = shouldDownloadFiles ? await ensureDirectory(instanceDir, "plates") : null;
    const fileDir = shouldDownloadFiles ? await ensureDirectory(instanceDir, "files") : null;

    await writeTextFile(instanceDir, "instance.json", JSON.stringify(instance, null, 2));

    if (shouldDownloadFiles && instance.coverUrl) {
      const transfer = await downloadOptionalToFile(
        saved,
        "instance-cover",
        instanceDir,
        instance.coverUrl,
        "instance-cover.jpg",
        { preferExisting: true },
        { instanceId: instance.id }
      );
      recordTransferStats(saved, transfer);
      saved.instancePictures.push({ instanceId: instance.id, fileName: transfer?.fileName || null });
    }

    if (shouldDownloadFiles) {
      for (const plate of instance.plates || []) {
        const plateUrl = plate.thumbnailUrl || plate.topPictureUrl || plate.pickPictureUrl;
        const transfer = await downloadOptionalToFile(
          saved,
          "plate-picture",
          plateDir,
          plateUrl,
          `plate-${plate.index || "x"}.png`,
          { preferExisting: true },
          { instanceId: instance.id, plateIndex: plate.index }
        );
        recordTransferStats(saved, transfer);
        saved.plates.push({
          instanceId: instance.id,
          plateIndex: plate.index,
          fileName: transfer?.fileName || null
        });
      }
    }

    if (!shouldDownloadFiles) {
      continue;
    }

    if (instance.downloads?.f3mf?.ok && instance.downloads.f3mf.url) {
      try {
        let transfer = null;
        const existingModelFileName = await findExistingModelFileName(fileDir);
        if (existingModelFileName) {
          transfer = createTransferResult(existingModelFileName, { reused: true });
        } else {
          transfer = await downloadToFile(
            fileDir,
            instance.downloads.f3mf.url,
            instance.downloads.f3mf.name || `instance-${instance.id}.3mf`,
            { preferExisting: true }
          );
        }
        recordTransferStats(saved, transfer);
        saved.modelFiles.push({
          instanceId: instance.id,
          type: "f3mf",
          fileName: transfer?.fileName || null,
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

  const response = await chrome.runtime.sendMessage({
    type: "mwqs:get-active-model",
    tabId: getBoundSourceTabId()
  });

  if (!response?.ok) {
    throw new Error(response?.error || "未知错误");
  }

  return response.data;
}

async function ensureDirectoryReady() {
  if (directoryHandle) {
    return directoryHandle;
  }

  if (defaultDirectoryHandle) {
    setStatus("正在恢复默认目录...");
    return restoreDefaultDirectory({ requestAccess: true });
  }

  throw new Error("请先选择保存目录，或先设置默认目录。");
}

async function runExtractFlow() {
  const record = sanitizeModelRecord(await extractModel());
  currentRecord = record;
  syncSelectedInstanceIds(record, { preserveExisting: true });
  renderSummary(record);
  renderInstanceSelection();
  jsonOutputNode.textContent = JSON.stringify(record, null, 2);
  updateDirectoryActionButtons();

  const captchaBlockedCount = (record.instances || []).filter((instance) =>
    isCaptchaBlockedMessage(instance?.downloads?.f3mf?.error)
  ).length;

  setStatus(
    captchaBlockedCount > 0
      ? `解析成功，但有 ${captchaBlockedCount} 个配置的 3MF 被站点人机验证拦截。请先回到 MakerWorld 页面完成验证，再保存。`
      : "解析成功，可以保存当前项目了。"
  );

  return record;
}

async function runSaveFlow() {
  await ensureDirectoryReady();
  const previewOptions = getCurrentSaveOptions();
  setStatus(
    previewOptions.metadataOnly
      ? "正在只保存描述和元数据，不下载资源文件..."
      : "正在写入本地目录，已存在资源将优先复用..."
  );
  const result = await saveRecord();
  const summary = getMissingModelFileSummary(result.assets);
  const downloadedSummary =
    result.assets?.downloadedCount > 0 ? `，新下载 ${result.assets.downloadedCount} 个文件` : "";
  const reusedSummary = result.assets?.reusedCount > 0 ? `，复用 ${result.assets.reusedCount} 个已有文件` : "";
  const modeSummary = result.assets?.metadataOnly ? "，本次仅保存描述和元数据" : "";
  const failedAssetSummary = result.assets?.failedAssets?.length > 0
    ? `，另有 ${result.assets.failedAssets.length} 个图片或附件下载失败，已记录并继续保存`
    : "";

  setStatus(
    summary.captchaBlockedCount > 0
      ? `保存完成，目录名：${result.folderName}${modeSummary}${downloadedSummary}${reusedSummary}${failedAssetSummary}。其中 ${summary.captchaBlockedCount} 个配置的 3MF 被站点人机验证拦截，请回到 MakerWorld 页面完成验证后重新保存。`
      : result.missingModelFileCount > 0
        ? `保存完成，目录名：${result.folderName}${modeSummary}${downloadedSummary}${reusedSummary}${failedAssetSummary}。其中 ${result.missingModelFileCount} 个配置未保存到 3MF。`
        : `保存完成，目录名：${result.folderName}${modeSummary}${downloadedSummary}${reusedSummary}${failedAssetSummary}`
  );

  const shouldShowResources = window.confirm(
    "资源已保存完成。\n\n是否查看本次保存的资源结构？\n\n说明：浏览器扩展不能直接打开系统文件夹。"
  );

  if (shouldShowResources) {
    showSavedResources(currentRecord, result.folderName, result.assets);
  } else {
    hideSavedResources();
  }

  return result;
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

  setStatus("正在准备项目资源...");
  let sanitizedRecord = sanitizeModelRecord(await extractModel());
  currentRecord = sanitizedRecord;
  syncSelectedInstanceIds(sanitizedRecord, { preserveExisting: true });
  renderSummary(sanitizedRecord);
  renderInstanceSelection();
  jsonOutputNode.textContent = JSON.stringify(sanitizedRecord, null, 2);
  const saveOptions = getCurrentSaveOptions();

  const rootFolderName =
    sanitizeName(sanitizedRecord.folderName) ||
    sanitizeName(sanitizedRecord.model?.title) ||
    `makerworld-${currentRecord.model?.id || "model"}`;
  const projectDir = await ensureDirectory(directoryHandle, rootFolderName);

  if (await shouldRefreshRecordDownloadsForProject(projectDir, sanitizedRecord, saveOptions)) {
    setStatus("正在刷新缺失 3MF 的下载链接...");
    sanitizedRecord = sanitizeModelRecord(await extractModel());
    currentRecord = sanitizedRecord;
    syncSelectedInstanceIds(sanitizedRecord, { preserveExisting: true });
    renderSummary(sanitizedRecord);
    renderInstanceSelection();
    jsonOutputNode.textContent = JSON.stringify(sanitizedRecord, null, 2);
  }

  const assets = await saveAssets(projectDir, sanitizedRecord, saveOptions);

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
    customization: sanitizedRecord.model?.customization || null,
    saveOptions: {
      metadataOnly: saveOptions.metadataOnly,
      selectedInstanceIds: [...saveOptions.selectedInstanceIds]
    },
    assets
  };

  await writeTextFile(projectDir, "save-manifest.json", JSON.stringify(manifest, null, 2));
  try {
    const downloadableInstances = (sanitizedRecord.instances || []).filter(shouldExpectModelFile);
    const selectedDownloadableCount = downloadableInstances.filter((instance) =>
      saveOptions.selectedInstanceIds.has(getInstanceSelectionId(instance))
    ).length;
    const missingModelFileCount = assets.modelFilesMissing?.length || 0;
    const downloadState = saveOptions.metadataOnly
      ? "metadata-only"
      : missingModelFileCount > 0
        ? "incomplete"
        : selectedDownloadableCount < downloadableInstances.length
          ? "partial"
          : "complete";

    await chrome.runtime.sendMessage({
      type: "mwqs:record-project-download",
      entry: {
        modelId: manifest.modelId,
        folderName: manifest.folderName,
        rootDirectoryName: directoryHandle?.name || "",
        savedAt: manifest.savedAt,
        metadataOnly: manifest.saveOptions.metadataOnly,
        selectedInstanceIds: manifest.saveOptions.selectedInstanceIds,
        selectedCount: manifest.saveOptions.selectedInstanceIds.length,
        totalCount: sanitizedRecord.instances?.length || 0,
        missingModelFileCount,
        state: downloadState
      }
    });
  } catch {
    // The manifest is the source of truth; the index can be rebuilt from it later.
  }
  return {
    folderName: rootFolderName,
    assets,
    missingModelFileCount: assets.modelFilesMissing?.length || 0
  };
}

metadataOnlyCheckbox.addEventListener("change", () => {
  renderInstanceSelection();
  updateDirectoryActionButtons();
});

selectAllInstancesButton.addEventListener("click", () => {
  if (!currentRecord) {
    return;
  }

  selectedInstanceIds = new Set((currentRecord.instances || []).map((instance) => getInstanceSelectionId(instance)));
  renderInstanceSelection();
  updateDirectoryActionButtons();
});

clearAllInstancesButton.addEventListener("click", () => {
  selectedInstanceIds = new Set();
  renderInstanceSelection();
  updateDirectoryActionButtons();
});

openWorkbenchButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "mwqs:toggle-inline-panel",
      tabId: getBoundSourceTabId()
    });
    if (!result?.ok) {
      throw new Error(result?.error || "打开页面面板失败。");
    }

    setStatus("页面内面板已打开，可以直接在当前页面继续工作。");
    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

pickDirectoryButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    setStatus("正在请求目录权限...");
    await pickDirectory();
    hideSavedResources();
    setStatus("保存目录已设置。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

setDefaultDirectoryButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    if (!directoryHandle) {
      throw new Error("请先选择一个保存目录。");
    }

    await writeStoredDefaultDirectory(directoryHandle);
    await clearProjectDownloadIndex();
    defaultDirectoryHandle = directoryHandle;
    defaultDirectoryName = directoryHandle.name || "已保存目录";
    activeDirectoryIsDefault = true;
    renderDirectorySummary();
    updateDirectoryActionButtons();
    setStatus(`已将 ${defaultDirectoryName} 设为默认目录。`);
    await refreshBoundPageDownloadStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

restoreDefaultDirectoryButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    setStatus("正在恢复默认目录...");
    await restoreDefaultDirectory({ requestAccess: true });
    hideSavedResources();
    setStatus(`已恢复默认目录：${defaultDirectoryName}。`);
    await refreshBoundPageDownloadStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

clearDefaultDirectoryButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    await clearStoredDefaultDirectory();
    await clearProjectDownloadIndex();
    clearDefaultDirectoryState();
    setStatus("已清除默认目录设置。");
    await refreshBoundPageDownloadStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

extractButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    await runExtractFlow();
  } catch (error) {
    currentRecord = null;
    selectedInstanceIds = new Set();
    selectionScopeKey = "";
    renderInstanceSelection();
    updateDirectoryActionButtons();
    jsonOutputNode.textContent = "解析失败";
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

quickSaveButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    await ensureDirectoryReady();
    await runExtractFlow();
    await runSaveFlow();
  } catch (error) {
    if (!currentRecord) {
      jsonOutputNode.textContent = "解析失败";
    }
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

saveButton.addEventListener("click", async () => {
  setBusyState(true);
  try {
    await runSaveFlow();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setBusyState(false);
  }
});

renderDirectorySummary();
updateDirectoryActionButtons();
renderInstanceSelection();
renderWorkbenchBanner();
hideSavedResources();

if (isStandaloneWorkbench || isInlinePanel) {
  openWorkbenchButton.classList.add("hidden");
}

if (isStandaloneWorkbench) {
  document.title = "MakerWorld Helper CN - 常驻工作台";
} else if (isInlinePanel) {
  document.title = "MakerWorld Helper CN - 页面面板";
}

loadDefaultDirectoryState()
  .then(async (hasDefault) => {
    if (!hasDefault) {
      return;
    }

    try {
      await restoreDefaultDirectory({ requestAccess: false });
      setStatus(`已自动恢复默认目录：${defaultDirectoryName}。`);
      await refreshBoundPageDownloadStatus();
    } catch {
      setStatus(`已识别默认目录：${defaultDirectoryName}，点击“恢复默认目录”后可继续使用。`);
    }
  })
  .catch(() => {
    setStatus("默认目录初始化失败，请重新设置。");
  });
