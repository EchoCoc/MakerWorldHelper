function isMakerWorldModelPage(url) {
  return /^https:\/\/makerworld\.(?:com\.cn|com)(?:\/[a-z]{2})?\/models\/.+/i.test(url || "");
}

const DEFAULT_DIRECTORY_DB_NAME = "mw-helper-popup";
const DEFAULT_DIRECTORY_STORE_NAME = "settings";
const PROJECT_INDEX_STORE_NAME = "projects";
const SETTINGS_DATABASE_VERSION = 2;
const DEFAULT_DIRECTORY_KEY = "default-save-directory";
const LEGACY_DOWNLOAD_INDEX_KEY = "mwqs:download-index:v1";
const DOWNLOAD_STATUS_CACHE_TTL_MS = 10 * 60 * 1000;

function getModelIdFromUrl(url) {
  const match = String(url || "").match(/\/models\/(\d+)(?:[-/?#]|$)/i);
  return match?.[1] || "";
}

function sanitizeProjectFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getInstanceDirectoryName(instance) {
  return (
    sanitizeProjectFolderName(`${instance?.id || "instance"}-${instance?.title || "profile"}`) ||
    `instance-${instance?.id || "x"}`
  );
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
    const request = transaction.objectStore(DEFAULT_DIRECTORY_STORE_NAME).get(DEFAULT_DIRECTORY_KEY);
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

async function readJsonFromDirectory(directoryHandle, fileName) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function readProjectIndexEntry(modelId) {
  const database = await openSettingsDatabase();
  const indexedEntry = await new Promise((resolve, reject) => {
    const transaction = database.transaction(PROJECT_INDEX_STORE_NAME, "readonly");
    const request = transaction.objectStore(PROJECT_INDEX_STORE_NAME).get(String(modelId));
    request.onsuccess = () => {
      database.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("读取项目下载索引失败。"));
    };
  });

  if (indexedEntry) {
    return indexedEntry;
  }

  const stored = await chrome.storage.local.get(LEGACY_DOWNLOAD_INDEX_KEY);
  const legacyIndex = stored?.[LEGACY_DOWNLOAD_INDEX_KEY];
  const legacyEntry = legacyIndex?.[String(modelId)] || null;
  if (!legacyEntry) {
    return null;
  }

  const migratedEntry = {
    ...legacyEntry,
    modelId: String(modelId),
    relativePath: String(legacyEntry.folderName || ""),
    state: legacyEntry.metadataOnly
      ? "metadata-only"
      : Number(legacyEntry.missingModelFileCount || 0) > 0
        ? "incomplete"
        : "recorded",
    lastVerifiedAt: ""
  };
  await writeProjectIndexEntry(migratedEntry);
  delete legacyIndex[String(modelId)];
  if (Object.keys(legacyIndex).length > 0) {
    await chrome.storage.local.set({ [LEGACY_DOWNLOAD_INDEX_KEY]: legacyIndex });
  } else {
    await chrome.storage.local.remove(LEGACY_DOWNLOAD_INDEX_KEY);
  }
  return migratedEntry;
}

async function writeProjectIndexEntry(entry) {
  const database = await openSettingsDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(PROJECT_INDEX_STORE_NAME, "readwrite");
    transaction.objectStore(PROJECT_INDEX_STORE_NAME).put(entry);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("写入项目下载索引失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("写入项目下载索引失败。"));
  });
  database.close();
}

async function recordProjectDownload(entry) {
  const modelId = String(entry?.modelId ?? "").trim();
  if (!modelId) {
    return null;
  }

  const indexedEntry = {
    modelId,
    folderName: String(entry?.folderName || ""),
    relativePath: String(entry?.relativePath || entry?.folderName || ""),
    rootDirectoryName: String(entry?.rootDirectoryName || ""),
    savedAt: String(entry?.savedAt || new Date().toISOString()),
    metadataOnly: Boolean(entry?.metadataOnly),
    selectedInstanceIds: Array.isArray(entry?.selectedInstanceIds) ? entry.selectedInstanceIds : [],
    selectedCount: Number(entry?.selectedCount || 0),
    totalCount: Number(entry?.totalCount || 0),
    missingCount: Number(entry?.missingModelFileCount || 0),
    state: String(entry?.state || "recorded"),
    lastVerifiedAt: new Date().toISOString()
  };
  await writeProjectIndexEntry(indexedEntry);
  return indexedEntry;
}

async function resolveRelativeDirectory(rootHandle, relativePath) {
  const segments = String(relativePath || "").split(/[\\/]+/).filter(Boolean);
  let currentHandle = rootHandle;
  for (const segment of segments) {
    currentHandle = await currentHandle.getDirectoryHandle(segment, { create: false });
  }
  return currentHandle;
}

async function findProjectDirectory(rootHandle, modelId, indexedEntry) {
  const indexedRelativePath = String(indexedEntry?.relativePath || indexedEntry?.folderName || "");
  if (indexedRelativePath) {
    try {
      return {
        handle: await resolveRelativeDirectory(rootHandle, indexedRelativePath),
        folderName: String(indexedEntry?.folderName || indexedRelativePath.split(/[\\/]+/).pop() || ""),
        relativePath: indexedRelativePath
      };
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        throw error;
      }
    }
  }

  const folderPrefix = `${modelId}-`;
  const repositoryHandles = [];
  for await (const entry of rootHandle.values()) {
    if (entry.kind !== "directory") {
      continue;
    }

    if (entry.name.startsWith(folderPrefix)) {
      const manifest = await readJsonFromDirectory(entry, "save-manifest.json");
      if (String(manifest?.modelId ?? "") === modelId) {
        return { handle: entry, folderName: entry.name, relativePath: entry.name, manifest };
      }
    }

    if (await hasNonEmptyFile(entry, ".mw-repo.json")) {
      repositoryHandles.push(entry);
    }
  }

  // Projects may have been moved into a desktop repository after downloading.
  for (const repositoryHandle of repositoryHandles) {
    for await (const entry of repositoryHandle.values()) {
      if (entry.kind !== "directory" || !entry.name.startsWith(folderPrefix)) {
        continue;
      }

      const manifest = await readJsonFromDirectory(entry, "save-manifest.json");
      if (String(manifest?.modelId ?? "") === modelId) {
        return {
          handle: entry,
          folderName: entry.name,
          relativePath: `${repositoryHandle.name}/${entry.name}`,
          manifest
        };
      }
    }
  }

  return null;
}

async function hasNonEmptyFile(directoryHandle, fileName) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
    return (await fileHandle.getFile()).size > 0;
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

function shouldExpectModelFile(instance) {
  return Boolean(instance?.hasZipStl || instance?.appCanPrint);
}

async function inspectProjectDownload(projectDirectory, manifest) {
  const metadata = await readJsonFromDirectory(projectDirectory, "metadata.json");
  const instances = Array.isArray(metadata?.instances) ? metadata.instances : [];
  const selectedIds = new Set((manifest?.saveOptions?.selectedInstanceIds || []).map(String));
  const downloadableInstances = instances.filter(shouldExpectModelFile);
  const manifestFiles = new Map(
    (manifest?.assets?.modelFiles || []).map((item) => [String(item?.instanceId ?? ""), item])
  );
  const missingFromManifest = Array.isArray(manifest?.assets?.modelFilesMissing)
    ? manifest.assets.modelFilesMissing.length
    : 0;
  let missingOnDisk = 0;

  if (!manifest?.saveOptions?.metadataOnly) {
    let instancesDirectory = null;
    try {
      instancesDirectory = await projectDirectory.getDirectoryHandle("instances", { create: false });
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        throw error;
      }
    }

    for (const instance of downloadableInstances) {
      const instanceId = String(instance?.id ?? "");
      if (!selectedIds.has(instanceId)) {
        continue;
      }

      const savedFile = manifestFiles.get(instanceId);
      if (!instancesDirectory || !savedFile?.fileName) {
        missingOnDisk += 1;
        continue;
      }

      try {
        const instanceDirectory = await instancesDirectory.getDirectoryHandle(
          getInstanceDirectoryName(instance),
          { create: false }
        );
        const filesDirectory = await instanceDirectory.getDirectoryHandle("files", { create: false });
        if (!(await hasNonEmptyFile(filesDirectory, savedFile.fileName))) {
          missingOnDisk += 1;
        }
      } catch (error) {
        if (error?.name === "NotFoundError") {
          missingOnDisk += 1;
          continue;
        }
        throw error;
      }
    }
  }

  const metadataOnly = Boolean(manifest?.saveOptions?.metadataOnly);
  const selectedDownloadableCount = downloadableInstances.filter((instance) =>
    selectedIds.has(String(instance?.id ?? ""))
  ).length;
  const isPartial = !metadataOnly && selectedDownloadableCount < downloadableInstances.length;
  const missingCount = Math.max(missingFromManifest, missingOnDisk, metadata ? 0 : 1);

  return {
    state: metadataOnly
      ? "metadata-only"
      : missingCount > 0
        ? "incomplete"
        : isPartial
          ? "partial"
          : "complete",
    savedAt: String(manifest?.savedAt || ""),
    metadataOnly,
    selectedCount: selectedIds.size,
    totalCount: instances.length,
    missingCount
  };
}

async function checkProjectDownload({ url, modelId: requestedModelId, forceVerify = false } = {}) {
  const modelId = String(requestedModelId || getModelIdFromUrl(url)).trim();
  if (!modelId) {
    return { ok: false, state: "unknown", error: "无法识别当前模型 ID。" };
  }

  const indexedEntry = await readProjectIndexEntry(modelId);
  const rootHandle = await readStoredDefaultDirectory();
  const lastVerifiedTime = Date.parse(indexedEntry?.lastVerifiedAt || "");
  const hasFreshSnapshot =
    !forceVerify &&
    rootHandle &&
    indexedEntry?.rootDirectoryName === rootHandle.name &&
    Number.isFinite(lastVerifiedTime) &&
    Date.now() - lastVerifiedTime < DOWNLOAD_STATUS_CACHE_TTL_MS &&
    indexedEntry?.state &&
    indexedEntry.state !== "recorded";

  if (hasFreshSnapshot) {
    return {
      ok: true,
      modelId,
      folderName: indexedEntry.folderName || "",
      relativePath: indexedEntry.relativePath || "",
      state: indexedEntry.state,
      savedAt: indexedEntry.savedAt || "",
      metadataOnly: Boolean(indexedEntry.metadataOnly),
      selectedCount: Number(indexedEntry.selectedCount || 0),
      totalCount: Number(indexedEntry.totalCount || 0),
      missingCount: Number(indexedEntry.missingCount || 0),
      cached: true,
      message: "已从本地下载索引读取状态。"
    };
  }

  if (!rootHandle) {
    return {
      ok: true,
      state: indexedEntry ? "needs-permission" : "unknown",
      modelId,
      folderName: indexedEntry?.folderName || "",
      message: indexedEntry ? "存在历史记录，但尚未设置默认目录，无法确认项目是否仍在本地。" : "设置默认目录后可校验下载状态。"
    };
  }

  if (typeof rootHandle.queryPermission !== "function" || typeof rootHandle.values !== "function") {
    return {
      ok: true,
      state: "unknown",
      modelId,
      folderName: indexedEntry?.folderName || "",
      message: "当前浏览器无法直接校验默认目录，不能仅凭历史记录判断是否已下载。"
    };
  }

  const permission = await rootHandle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    return {
      ok: true,
      state: "needs-permission",
      modelId,
      folderName: indexedEntry?.folderName || "",
      message: "需要在助手面板中恢复默认目录权限后校验。"
    };
  }

  const project = await findProjectDirectory(rootHandle, modelId, indexedEntry);
  if (!project) {
    const missingProjectEntry = {
      ...(indexedEntry || {}),
      modelId,
      folderName: indexedEntry?.folderName || "",
      relativePath: indexedEntry?.relativePath || "",
      rootDirectoryName: rootHandle.name,
      savedAt: indexedEntry?.savedAt || "",
      metadataOnly: false,
      selectedInstanceIds: [],
      selectedCount: 0,
      totalCount: 0,
      missingCount: 0,
      state: "not-downloaded",
      lastVerifiedAt: new Date().toISOString()
    };
    await writeProjectIndexEntry(missingProjectEntry);
    return {
      ok: true,
      state: "not-downloaded",
      modelId,
      folderName: missingProjectEntry.folderName,
      message: indexedEntry
        ? "历史索引中曾有保存记录，但当前默认目录未找到该项目，已更新为未下载。"
        : "默认目录中未找到该项目。"
    };
  }

  const manifest = project.manifest || (await readJsonFromDirectory(project.handle, "save-manifest.json"));
  if (!manifest || String(manifest.modelId ?? "") !== modelId) {
    await writeProjectIndexEntry({
      modelId,
      folderName: project.folderName,
      relativePath: project.relativePath || project.folderName,
      rootDirectoryName: rootHandle.name,
      savedAt: "",
      metadataOnly: false,
      selectedInstanceIds: [],
      selectedCount: 0,
      totalCount: 0,
      missingCount: 0,
      state: "not-downloaded",
      lastVerifiedAt: new Date().toISOString()
    });
    return { ok: true, state: "not-downloaded", modelId, message: "项目目录中缺少有效保存清单。" };
  }

  const inspection = await inspectProjectDownload(project.handle, manifest);
  const verifiedEntry = {
    ...(indexedEntry || {}),
    modelId,
    folderName: project.folderName,
    relativePath: project.relativePath || project.folderName,
    rootDirectoryName: rootHandle.name,
    savedAt: inspection.savedAt || indexedEntry?.savedAt || "",
    metadataOnly: inspection.metadataOnly,
    selectedInstanceIds: Array.isArray(manifest?.saveOptions?.selectedInstanceIds)
      ? manifest.saveOptions.selectedInstanceIds
      : [],
    selectedCount: inspection.selectedCount,
    totalCount: inspection.totalCount,
    missingCount: inspection.missingCount,
    state: inspection.state,
    lastVerifiedAt: new Date().toISOString()
  };
  await writeProjectIndexEntry(verifiedEntry);
  return {
    ok: true,
    modelId,
    folderName: project.folderName,
    relativePath: project.relativePath || project.folderName,
    ...inspection
  };
}

async function notifyProjectDownloadStatus(modelId, status = null) {
  const tabs = await chrome.tabs.query({
    url: ["https://makerworld.com.cn/*", "https://makerworld.com/*"]
  });
  for (const tab of tabs) {
    if (!tab.id || getModelIdFromUrl(tab.url) !== String(modelId)) {
      continue;
    }
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "mwqs:download-status-updated",
        forceVerify: true,
        status: status
          ? { ok: true, ...status, message: "项目保存完成，正在复核本地文件。" }
          : null
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }
}

function sendExtractMessage(tabId, sendResponse) {
  chrome.tabs.sendMessage(tabId, { type: "mwqs:extract-model" }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({
        ok: false,
        error: chrome.runtime.lastError.message
      });
      return;
    }

    sendResponse(response);
  });
}

function resolveTargetTab(message, sendResponse, callback) {
  const explicitTabId = Number.parseInt(String(message?.tabId ?? ""), 10);
  if (Number.isInteger(explicitTabId) && explicitTabId > 0) {
    chrome.tabs.get(explicitTabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        sendResponse({ ok: false, error: "未找到绑定的 MakerWorld 页面，请重新打开常驻工作台。" });
        return;
      }

      callback(tab);
    });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;

    if (!tab?.id) {
      sendResponse({ ok: false, error: "没有找到当前活动标签页。" });
      return;
    }

    callback(tab);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("MakerWorld Helper CN installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "mwqs:check-project-download") {
    checkProjectDownload(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          state: "unknown",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  if (message?.type === "mwqs:record-project-download") {
    recordProjectDownload(message.entry)
      .then(async (indexedEntry) => {
        await notifyProjectDownloadStatus(message.entry?.modelId, indexedEntry);
        sendResponse({ ok: true, status: indexedEntry });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message?.type === "mwqs:refresh-project-download-status") {
    resolveTargetTab(message, sendResponse, (tab) => {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "mwqs:download-status-updated", forceVerify: true },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ok: true });
        }
      );
    });
    return true;
  }

  if (message?.type === "mwqs:toggle-inline-panel") {
    resolveTargetTab(message, sendResponse, (tab) => {
      chrome.tabs.sendMessage(tab.id, { type: "mwqs:toggle-inline-panel" }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        sendResponse(response || { ok: true });
      });
    });

    return true;
  }

  if (message?.type === "mwqs:open-workbench") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const [tab] = tabs;

      if (!tab?.id) {
        sendResponse({ ok: false, error: "没有找到当前活动标签页。" });
        return;
      }

      if (!isMakerWorldModelPage(tab.url)) {
        sendResponse({
          ok: false,
          error: "请先打开 MakerWorld 模型详情页，再打开常驻工作台。"
        });
        return;
      }

      const workbenchUrl =
        `${chrome.runtime.getURL("popup/popup.html")}?mode=standalone&sourceTabId=${tab.id}`;

      chrome.windows.create(
        {
          url: workbenchUrl,
          type: "popup",
          width: 520,
          height: 900
        },
        (createdWindow) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          sendResponse({
            ok: true,
            windowId: createdWindow?.id ?? null
          });
        }
      );
    });

    return true;
  }

  if (message?.type !== "mwqs:get-active-model") {
    return false;
  }

  resolveTargetTab(message, sendResponse, (tab) => {
    if (!isMakerWorldModelPage(tab.url)) {
      sendResponse({
        ok: false,
        error: "请先打开 MakerWorld 模型详情页。"
      });
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "mwqs:extract-model" }, (response) => {
      if (!chrome.runtime.lastError) {
        sendResponse(response);
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: ["src/content.js"]
        },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          sendExtractMessage(tab.id, sendResponse);
        }
      );
    });
  });

  return true;
});
