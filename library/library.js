const pickRootButton = document.getElementById("pickRootButton");
const createRepoButton = document.getElementById("createRepoButton");
const refreshButton = document.getElementById("refreshButton");
const renameRepoButton = document.getElementById("renameRepoButton");
const deleteRepoButton = document.getElementById("deleteRepoButton");
const searchInput = document.getElementById("searchInput");
const rootSummary = document.getElementById("rootSummary");
const scopeSummary = document.getElementById("scopeSummary");
const statusNode = document.getElementById("status");
const repoListNode = document.getElementById("repoList");
const repoCountNode = document.getElementById("repoCount");
const repoManageBar = document.getElementById("repoManageBar");
const repoManageTitle = document.getElementById("repoManageTitle");
const repoManageMeta = document.getElementById("repoManageMeta");
const projectGridNode = document.getElementById("projectGrid");
const projectCountNode = document.getElementById("projectCount");
const projectScopeNode = document.getElementById("projectScope");
const detailCard = document.getElementById("detailCard");
const detailRepoBadge = document.getElementById("detailRepoBadge");
const detailRepo = document.getElementById("detailRepo");
const detailTitle = document.getElementById("detailTitle");
const detailAuthor = document.getElementById("detailAuthor");
const detailStats = document.getElementById("detailStats");
const detailTags = document.getElementById("detailTags");
const detailSummary = document.getElementById("detailSummary");
const detailCover = document.getElementById("detailCover");
const detailPictures = document.getElementById("detailPictures");
const instanceList = document.getElementById("instanceList");
const instanceToggleWrap = document.getElementById("instanceToggleWrap");
const instanceToggleButton = document.getElementById("instanceToggleButton");
const moveProjectButton = document.getElementById("moveProjectButton");
const openSourceButton = document.getElementById("openSourceButton");

const ROOT_REPO_NAME = "__root__";

let rootHandle = null;
let repositories = [];
let selectedRepoName = "all";
let selectedProject = null;
let currentObjectUrls = [];
let detailInstancesExpanded = false;

function setStatus(message) {
  statusNode.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeRichTextHtml(html) {
  if (!html) {
    return "<p>暂无摘要。</p>";
  }

  const allowedTags = new Set([
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
    "h1",
    "h2",
    "h3",
    "h4"
  ]);

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const node of template.content.querySelectorAll("*")) {
    const tag = node.tagName.toLowerCase();

    if (!allowedTags.has(tag)) {
      node.replaceWith(...node.childNodes);
      continue;
    }

    for (const attr of [...node.attributes]) {
      const isLink = tag === "a" && attr.name === "href";
      if (!isLink) {
        node.removeAttribute(attr.name);
      }
    }

    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) {
        node.removeAttribute("href");
      } else {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  return template.innerHTML.trim() || "<p>暂无摘要。</p>";
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRepoDisplayLabel(repo) {
  return repo.label || repo.name;
}

function getRepoBadgeText(repoKind) {
  return repoKind === "default" ? "默认仓库" : "自定义仓库";
}

function getCanonicalModelUrl(project) {
  const sourceUrl = project?.metadata?.sourceUrl || "";
  const model = project?.metadata?.model || {};

  try {
    const parsed = new URL(sourceUrl);
    if (
      parsed.hostname === "makerworld.com.cn" &&
      /^\/zh\/models\/.+/.test(parsed.pathname)
    ) {
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    // ignore and fall back
  }

  const modelId = model.id ?? "";
  const slug = String(model.slug || "").replace(/^\/+/, "");
  if (modelId && slug) {
    return `https://makerworld.com.cn/zh/models/${modelId}-${slug}`;
  }

  if (modelId) {
    return `https://makerworld.com.cn/zh/models/${modelId}`;
  }

  return "";
}

function getSelectedRepository() {
  return repositories.find((repo) => repo.name === selectedRepoName) || null;
}

function getRepoScopeText() {
  if (selectedRepoName === "all") {
    return "当前显示：全部项目";
  }

  const repo = getSelectedRepository();
  if (!repo) {
    return "当前显示：全部项目";
  }

  return `当前显示：${getRepoDisplayLabel(repo)} · ${getRepoBadgeText(repo.kind)}`;
}

function releaseObjectUrls() {
  for (const url of currentObjectUrls) {
    URL.revokeObjectURL(url);
  }

  currentObjectUrls = [];
}

async function verifyDirectoryPermission(handle, readWrite) {
  const options = readWrite ? { mode: "readwrite" } : {};

  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function listDirectoryHandles(parentHandle) {
  const handles = [];

  for await (const entry of parentHandle.values()) {
    if (entry.kind === "directory") {
      handles.push(entry);
    }
  }

  handles.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return handles;
}

async function directoryHasProjectMetadata(directoryHandle) {
  try {
    await directoryHandle.getFileHandle("metadata.json", { create: false });
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(parentHandle, name) {
  const handle = await parentHandle.getFileHandle(name, { create: false });
  const file = await handle.getFile();
  return file.text();
}

async function getOptionalFileUrl(parentHandle, segments) {
  try {
    let currentHandle = parentHandle;

    for (let index = 0; index < segments.length - 1; index += 1) {
      currentHandle = await currentHandle.getDirectoryHandle(segments[index], { create: false });
    }

    const fileHandle = await currentHandle.getFileHandle(segments.at(-1), { create: false });
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    currentObjectUrls.push(url);
    return url;
  } catch {
    return "";
  }
}

async function loadProjectFromDirectory(repo, projectHandle) {
  try {
    const metadataText = await readTextFile(projectHandle, "metadata.json");
    const metadata = JSON.parse(metadataText);

    let manifest = null;
    try {
      manifest = JSON.parse(await readTextFile(projectHandle, "save-manifest.json"));
    } catch {
      manifest = null;
    }

    const coverFileName = manifest?.assets?.cover || "cover.jpg";
    const coverUrl =
      (await getOptionalFileUrl(projectHandle, ["model", "images", coverFileName])) ||
      metadata?.model?.coverUrl ||
      "";

    return {
      id: `${repo.name}/${projectHandle.name}`,
      repoName: repo.name,
      repoLabel: getRepoDisplayLabel(repo),
      repoKind: repo.kind,
      repoHandle: repo.handle,
      projectHandle,
      projectFolderName: projectHandle.name,
      metadata,
      manifest,
      coverUrl
    };
  } catch {
    return null;
  }
}

function updateRepositoryManageBar() {
  const repo = getSelectedRepository();

  if (!repo || selectedRepoName === "all") {
    repoManageBar.classList.add("hidden");
    renameRepoButton.disabled = true;
    deleteRepoButton.disabled = true;
    return;
  }

  repoManageBar.classList.remove("hidden");
  repoManageTitle.textContent = getRepoDisplayLabel(repo);
  repoManageMeta.textContent =
    repo.kind === "default"
      ? `默认仓库，当前包含 ${repo.projects.length} 个项目。`
      : `自定义仓库，当前包含 ${repo.projects.length} 个项目。`;
  renameRepoButton.disabled = repo.kind !== "custom";
  deleteRepoButton.disabled = !(repo.kind === "custom" && repo.projects.length === 0);
}

async function scanRepositories() {
  if (!rootHandle) {
    return;
  }

  setStatus("正在扫描仓库和项目...");
  releaseObjectUrls();
  detailCard.classList.add("hidden");
  selectedProject = null;
  moveProjectButton.disabled = true;

  const childHandles = await listDirectoryHandles(rootHandle);
  const result = [];
  const rootRepo = {
    name: ROOT_REPO_NAME,
    label: "当前目录",
    kind: "default",
    handle: rootHandle,
    projects: []
  };

  for (const childHandle of childHandles) {
    if (await directoryHasProjectMetadata(childHandle)) {
      const project = await loadProjectFromDirectory(rootRepo, childHandle);
      if (project) {
        rootRepo.projects.push(project);
      }
      continue;
    }

    const customRepo = {
      name: childHandle.name,
      label: childHandle.name,
      kind: "custom",
      handle: childHandle,
      projects: []
    };

    const projectHandles = await listDirectoryHandles(childHandle);
    for (const projectHandle of projectHandles) {
      if (!(await directoryHasProjectMetadata(projectHandle))) {
        continue;
      }

      const project = await loadProjectFromDirectory(customRepo, projectHandle);
      if (project) {
        customRepo.projects.push(project);
      }
    }

    result.push(customRepo);
  }

  if (rootRepo.projects.length > 0) {
    result.unshift(rootRepo);
  }

  repositories = result;

  if (selectedRepoName !== "all" && !repositories.some((repo) => repo.name === selectedRepoName)) {
    selectedRepoName = "all";
  }

  renderRepositories();
  renderProjects();
  updateRepositoryManageBar();
  setStatus("扫描完成。");
}

function getVisibleProjects() {
  const keyword = searchInput.value.trim().toLowerCase();
  const baseList =
    selectedRepoName === "all"
      ? repositories.flatMap((repo) => repo.projects)
      : getSelectedRepository()?.projects || [];

  if (!keyword) {
    return baseList;
  }

  return baseList.filter((project) => {
    const metadata = project.metadata || {};
    const haystack = [
      metadata?.model?.title,
      metadata?.model?.id,
      metadata?.model?.modelId,
      metadata?.creator?.name,
      metadata?.creator?.handle,
      project.repoLabel,
      ...(metadata?.model?.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(keyword);
  });
}

function findProjectById(projectId) {
  for (const repo of repositories) {
    const match = repo.projects.find((project) => project.id === projectId);
    if (match) {
      return match;
    }
  }

  return null;
}

function renderRepositories() {
  repoCountNode.textContent = String(repositories.length);

  if (repositories.length === 0) {
    repoListNode.className = "repo-list empty-state";
    repoListNode.textContent = "当前根目录下还没有可识别的仓库或项目。";
    return;
  }

  const totalProjectCount = repositories.reduce((total, repo) => total + repo.projects.length, 0);
  const items = [
    { name: "all", label: "全部项目", kind: "all", count: totalProjectCount },
    ...repositories.map((repo) => ({
      name: repo.name,
      label: getRepoDisplayLabel(repo),
      kind: repo.kind,
      count: repo.projects.length
    }))
  ];

  repoListNode.className = "repo-list";
  repoListNode.innerHTML = items
    .map((repo) => {
      const badgeClass = repo.kind === "default" ? "repo-badge default" : "repo-badge";
      const badgeText =
        repo.kind === "all" ? "总览" : repo.kind === "default" ? "默认仓库" : "自定义仓库";

      return `
        <article class="repo-card ${repo.name === selectedRepoName ? "active" : ""}">
          <div class="repo-head">
            <div class="repo-title">${escapeHtml(repo.label)}</div>
            <span class="${badgeClass}">${badgeText}</span>
          </div>
          <div class="repo-meta">${repo.count} 个项目</div>
          <div class="card-actions">
            <button class="ghost" data-select-repo="${escapeHtml(repo.name)}">查看</button>
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of repoListNode.querySelectorAll("[data-select-repo]")) {
    button.addEventListener("click", () => {
      selectedRepoName = button.dataset.selectRepo || "all";
      renderRepositories();
      renderProjects();
      updateRepositoryManageBar();
    });
  }
}

function getAvailableTargetRepositories(project) {
  return repositories.filter((repo) => repo.name !== project.repoName);
}

function getInstanceDirectoryName(instance) {
  return (
    sanitizeName(`${instance.id || "instance"}-${instance.title || "profile"}`) ||
    `instance-${instance.id || "x"}`
  );
}

function getInstanceModelFiles(project, instance) {
  return project.manifest?.assets?.modelFiles?.filter((item) => item.instanceId === instance.id) || [];
}

function getInstancePlateFiles(project, instance) {
  return project.manifest?.assets?.plates?.filter((item) => item.instanceId === instance.id) || [];
}

const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);

function normalizeCompatibilityName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return INVALID_COMPATIBILITY_CODES.has(text.toUpperCase()) ? "" : text;
}

function flattenCompatibilityParts(value, bucket) {
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
      flattenCompatibilityParts(item, bucket);
    }
    return;
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "name",
      "model",
      "modelName",
      "title",
      "displayName",
      "devProductName",
      "productName",
      "printerName"
    ];
    for (const key of preferredKeys) {
      if (key in value) {
        flattenCompatibilityParts(value[key], bucket);
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

  if (instance.compatibilityText) {
    collectCompatibilityTextParts(instance.compatibilityText, bucket);
  }

  if (bucket.length === 0) {
    flattenCompatibilityParts(instance.compatibility, bucket);
    flattenCompatibilityParts(instance.otherCompatibility, bucket);
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

function renderProjects() {
  const projects = getVisibleProjects();
  projectCountNode.textContent = String(projects.length);
  projectScopeNode.textContent = getRepoScopeText();
  updateRepositoryManageBar();

  if (projects.length === 0) {
    projectGridNode.className = "project-grid empty-state";
    projectGridNode.textContent = "没有匹配的项目。";
    return;
  }

  projectGridNode.className = "project-grid";
  projectGridNode.innerHTML = projects
    .map((project) => {
      const model = project.metadata?.model || {};
      const creator = project.metadata?.creator || {};
      const badgeClass = project.repoKind === "default" ? "repo-badge default" : "repo-badge";
      const moveDisabled = getAvailableTargetRepositories(project).length === 0 ? "disabled" : "";

      return `
        <article class="project-card">
          <img src="${escapeHtml(project.coverUrl)}" alt="${escapeHtml(model.title || "cover")}">
          <div class="project-body">
            <div class="project-head">
              <div class="project-title">${escapeHtml(model.title || project.projectFolderName)}</div>
              <span class="${badgeClass}">${project.repoKind === "default" ? "默认仓库" : "自定义仓库"}</span>
            </div>
            <div class="project-author">${escapeHtml(creator.name || "未知作者")}</div>
            <div class="project-repo">${escapeHtml(project.repoLabel)} / ${escapeHtml(project.projectFolderName)}</div>
            <div class="card-actions">
              <button class="ghost" data-open-project="${escapeHtml(project.id)}">查看详情</button>
              <button class="secondary" data-move-project="${escapeHtml(project.id)}" ${moveDisabled}>快捷移动</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of projectGridNode.querySelectorAll("[data-open-project]")) {
    button.addEventListener("click", () => {
      const project = findProjectById(button.dataset.openProject || "");
      if (project) {
        void renderProjectDetail(project);
      }
    });
  }

  for (const button of projectGridNode.querySelectorAll("[data-move-project]")) {
    button.addEventListener("click", async () => {
      const project = findProjectById(button.dataset.moveProject || "");
      if (!project) {
        return;
      }

      try {
        button.disabled = true;
        await moveProject(project);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        renderProjects();
      }
    });
  }
}

function buildStatItems(project) {
  const model = project.metadata?.model || {};

  return [
    `模型 ID ${model.id ?? "-"}`,
    `下载 ${model.downloadCount ?? 0}`,
    `打印 ${model.printCount ?? 0}`,
    `评论 ${model.commentCount ?? 0}`,
    `配置 ${project.metadata?.instances?.length ?? 0}`
  ];
}

async function buildInstanceCardMarkup(project, instance) {
  const modelFiles = getInstanceModelFiles(project, instance);
  const plateFiles = getInstancePlateFiles(project, instance);
  const compatibilityText = formatCompatibility(instance);
  const instanceDirName = getInstanceDirectoryName(instance);
  const localCoverUrl =
    (await getOptionalFileUrl(project.projectHandle, [
      "instances",
      instanceDirName,
      "instance-cover.jpg"
    ])) || instance.coverUrl || "";

  const plateThumbUrls = [];
  for (const plateFile of plateFiles.slice(0, 3)) {
    const url = await getOptionalFileUrl(project.projectHandle, [
      "instances",
      instanceDirName,
      "plates",
      plateFile.fileName
    ]);
    if (url) {
      plateThumbUrls.push(url);
    }
  }

  const badges = [
    `机型 ${compatibilityText}`,
    `耗材 ${instance.materialCount ?? 0}`,
    `下载 ${instance.downloadCount ?? 0}`
  ];

  const hoverLines = [
    `实例 ID: ${instance.id ?? "-"}`,
    `Profile ID: ${instance.profileId ?? "-"}`,
    `预计耗时: ${instance.predictionSeconds ?? "-"} 秒`,
    `估算重量: ${instance.weightGrams ?? "-"} g`,
    `Plate 数: ${plateFiles.length}`
  ];

  const plateMarkup =
    plateThumbUrls.length > 0
      ? plateThumbUrls
          .map((url, index) => `<img src="${escapeHtml(url)}" alt="plate-${index + 1}">`)
          .join("")
      : '<div class="instance-plate-placeholder">无 Plate</div>';

  return `
    <article class="instance-card" title="${escapeHtml(hoverLines.join("\n"))}">
      <div class="instance-media">
        <img class="instance-cover" src="${escapeHtml(localCoverUrl)}" alt="${escapeHtml(
          instance.title || `instance-${instance.id}`
        )}">
        <div class="instance-plates">${plateMarkup}</div>
      </div>
      <div class="instance-body">
        <div class="instance-title">${escapeHtml(instance.title || `实例 ${instance.id}`)}</div>
        <div class="instance-badges">
          ${badges.map((item) => `<span class="instance-badge">${escapeHtml(item)}</span>`).join("")}
        </div>
        <div class="instance-hint">悬浮卡片可查看更多配置属性。</div>
        <div class="file-list">${escapeHtml(
          modelFiles.length > 0
            ? modelFiles.map((item) => `模型文件: ${item.fileName}`).join("\n")
            : "当前实例没有记录到本地模型文件。"
        )}</div>
        <div class="instance-actions">
          <button class="secondary" data-open-bambu="${escapeHtml(String(instance.id))}" ${
            modelFiles.length === 0 ? "disabled" : ""
          }>尝试用 Bambu Studio 打开</button>
        </div>
      </div>
    </article>
  `;
}

async function renderInstanceCards(project, instances) {
  if (instances.length === 0) {
    instanceList.innerHTML = '<div class="empty-state">当前项目没有实例信息。</div>';
    instanceToggleWrap.classList.add("hidden");
    return;
  }

  const visibleInstances = detailInstancesExpanded ? instances : instances.slice(0, 3);
  const cards = [];

  for (const instance of visibleInstances) {
    cards.push(await buildInstanceCardMarkup(project, instance));
  }

  instanceList.innerHTML = cards.join("");

  if (instances.length > 3) {
    instanceToggleWrap.classList.remove("hidden");
    instanceToggleButton.textContent = detailInstancesExpanded ? "收起配置" : `展开更多配置（${instances.length - 3}）`;
  } else {
    instanceToggleWrap.classList.add("hidden");
  }
}

function bindInstanceButtons(project, instances) {
  for (const button of instanceList.querySelectorAll("[data-open-bambu]")) {
    button.addEventListener("click", async () => {
      const instance = instances.find((item) => String(item.id) === String(button.dataset.openBambu || ""));
      if (!instance) {
        return;
      }

      try {
        await promptOpenInBambuStudio(project, instance);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });
  }

  if (!instanceToggleWrap.classList.contains("hidden")) {
    instanceToggleButton.onclick = async () => {
      detailInstancesExpanded = !detailInstancesExpanded;
      await renderInstanceCards(project, instances);
      bindInstanceButtons(project, instances);
    };
  } else {
    instanceToggleButton.onclick = null;
  }
}

async function renderProjectDetail(project) {
  selectedProject = project;
  detailInstancesExpanded = false;

  const metadata = project.metadata || {};
  const model = metadata.model || {};
  const creator = metadata.creator || {};

  detailRepoBadge.className = project.repoKind === "default" ? "repo-badge default" : "repo-badge";
  detailRepoBadge.textContent = getRepoBadgeText(project.repoKind);
  detailRepo.textContent = `${project.repoLabel} / ${project.projectFolderName}`;
  detailTitle.textContent = model.title || project.projectFolderName;
  detailAuthor.textContent = `${creator.name || "未知作者"}${creator.handle ? ` · @${creator.handle}` : ""}`;
  detailSummary.innerHTML = sanitizeRichTextHtml(model.summaryHtml || model.summaryText || "");
  detailCover.src = project.coverUrl || "";
  detailCover.alt = model.title || "模型封面";

  detailStats.innerHTML = buildStatItems(project)
    .map((item) => `<span class="stat">${escapeHtml(item)}</span>`)
    .join("");

  detailTags.innerHTML = (model.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  const pictureNames = [
    ...(project.manifest?.assets?.pictures || []).map((item) => item.fileName),
    project.manifest?.assets?.cover || ""
  ].filter(Boolean);

  const pictureUrls = [];
  for (const fileName of [...new Set(pictureNames)]) {
    const url = await getOptionalFileUrl(project.projectHandle, ["model", "images", fileName]);
    if (url) {
      pictureUrls.push(url);
    }
  }

  detailPictures.innerHTML =
    pictureUrls.length > 0
      ? pictureUrls.map((url) => `<img src="${escapeHtml(url)}" alt="detail">`).join("")
      : `<div class="empty-state">当前项目没有本地详情图片。</div>`;

  const instances = metadata.instances || [];
  await renderInstanceCards(project, instances);

  moveProjectButton.disabled = getAvailableTargetRepositories(project).length === 0;
  openSourceButton.onclick = () => {
    const targetUrl = getCanonicalModelUrl(project);
    if (targetUrl) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      setStatus("未能生成有效的 MakerWorld 原网页地址。");
    }
  };

  detailCard.classList.remove("hidden");

  bindInstanceButtons(project, instances);
}

function resolveTargetRepository(input, candidates) {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }

  const byIndex = Number.parseInt(normalized, 10);
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= candidates.length) {
    return candidates[byIndex - 1];
  }

  return (
    candidates.find((repo) => repo.name === normalized) ||
    candidates.find((repo) => getRepoDisplayLabel(repo) === normalized) ||
    null
  );
}

async function ensureProjectNameAvailable(parentHandle, folderName) {
  try {
    await parentHandle.getDirectoryHandle(folderName, { create: false });
    throw new Error(`目标仓库中已存在同名项目文件夹：${folderName}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("目标仓库中已存在")) {
      throw error;
    }
  }
}

async function copyFileToDirectory(fileHandle, targetDirectoryHandle) {
  const file = await fileHandle.getFile();
  const targetFileHandle = await targetDirectoryHandle.getFileHandle(file.name, { create: true });
  const writable = await targetFileHandle.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
}

async function copyDirectoryRecursively(sourceDirectoryHandle, targetDirectoryHandle) {
  for await (const entry of sourceDirectoryHandle.values()) {
    if (entry.kind === "file") {
      await copyFileToDirectory(entry, targetDirectoryHandle);
      continue;
    }

    const nextTargetDirectory = await targetDirectoryHandle.getDirectoryHandle(entry.name, {
      create: true
    });
    await copyDirectoryRecursively(entry, nextTargetDirectory);
  }
}

async function promptOpenInBambuStudio(project, instance) {
  const modelFiles = getInstanceModelFiles(project, instance);
  if (modelFiles.length === 0) {
    throw new Error("当前配置没有可用的本地 3MF 文件。");
  }

  const confirmed = window.confirm(
    "将尝试打开这个配置对应的 3MF 文件。\n\n当前版本会先在浏览器中打开该本地模型文件；如果你的系统已经把 3MF 关联到 Bambu Studio，可以继续在 Bambu Studio 中打开。\n\n是否继续？"
  );

  if (!confirmed) {
    setStatus("已取消打开 Bambu Studio。");
    return false;
  }

  const instanceDirName = getInstanceDirectoryName(instance);
  const fileUrl = await getOptionalFileUrl(project.projectHandle, [
    "instances",
    instanceDirName,
    "files",
    modelFiles[0].fileName
  ]);

  if (!fileUrl) {
    throw new Error("未找到本地 3MF 文件。");
  }

  window.open(fileUrl, "_blank", "noopener,noreferrer");
  setStatus(`已尝试打开配置 ${instance.title || instance.id} 的 3MF 文件。`);
  return true;
}

async function moveProject(project) {
  const candidates = getAvailableTargetRepositories(project);
  if (candidates.length === 0) {
    throw new Error("当前没有可移动到的其他仓库。");
  }

  const promptText = [
    `要移动的项目：${project.metadata?.model?.title || project.projectFolderName}`,
    "",
    "请输入目标仓库编号或仓库名称：",
    ...candidates.map(
      (repo, index) => `${index + 1}. ${getRepoDisplayLabel(repo)} (${getRepoBadgeText(repo.kind)})`
    )
  ].join("\n");

  const input = window.prompt(promptText);
  const targetRepo = resolveTargetRepository(input, candidates);
  if (!targetRepo) {
    setStatus("已取消移动项目。");
    return false;
  }

  const sourceGranted = await verifyDirectoryPermission(project.repoHandle, true);
  const targetGranted = await verifyDirectoryPermission(targetRepo.handle, true);

  if (!sourceGranted || !targetGranted) {
    throw new Error("项目移动失败：未获得源仓库或目标仓库的写入权限。");
  }

  await ensureProjectNameAvailable(targetRepo.handle, project.projectFolderName);

  const confirmed = window.confirm(
    `确认将“${project.metadata?.model?.title || project.projectFolderName}”移动到“${getRepoDisplayLabel(targetRepo)}”吗？`
  );

  if (!confirmed) {
    setStatus("已取消移动项目。");
    return false;
  }

  const targetProjectDirectory = await targetRepo.handle.getDirectoryHandle(project.projectFolderName, {
    create: true
  });

  await copyDirectoryRecursively(project.projectHandle, targetProjectDirectory);
  await project.repoHandle.removeEntry(project.projectFolderName, { recursive: true });

  selectedRepoName = targetRepo.name;
  await scanRepositories();

  const movedProject = findProjectById(`${targetRepo.name}/${project.projectFolderName}`);
  if (movedProject) {
    await renderProjectDetail(movedProject);
  }

  setStatus(`项目已移动到 ${getRepoDisplayLabel(targetRepo)}。`);
  return true;
}

async function renameSelectedRepository() {
  const repo = getSelectedRepository();
  if (!repo || repo.kind !== "custom") {
    throw new Error("当前仓库不支持重命名。");
  }

  const input = window.prompt("请输入新的仓库名称。", repo.name);
  const nextName = sanitizeName(input);

  if (!nextName || nextName === repo.name) {
    setStatus("已取消重命名仓库。");
    return false;
  }

  try {
    await rootHandle.getDirectoryHandle(nextName, { create: false });
    throw new Error(`已存在同名仓库：${nextName}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("已存在同名仓库")) {
      throw error;
    }
  }

  const granted = await verifyDirectoryPermission(rootHandle, true);
  if (!granted) {
    throw new Error("未获得根目录写入权限。");
  }

  const targetHandle = await rootHandle.getDirectoryHandle(nextName, { create: true });
  await copyDirectoryRecursively(repo.handle, targetHandle);
  await rootHandle.removeEntry(repo.name, { recursive: true });

  selectedRepoName = nextName;
  await scanRepositories();
  setStatus(`仓库已重命名为 ${nextName}。`);
  return true;
}

async function deleteSelectedRepository() {
  const repo = getSelectedRepository();
  if (!repo || repo.kind !== "custom") {
    throw new Error("当前仓库不支持删除。");
  }

  if (repo.projects.length > 0) {
    throw new Error("只有空仓库才能删除。");
  }

  const confirmed = window.confirm(`确认删除空仓库“${repo.name}”吗？`);
  if (!confirmed) {
    setStatus("已取消删除仓库。");
    return false;
  }

  const granted = await verifyDirectoryPermission(rootHandle, true);
  if (!granted) {
    throw new Error("未获得根目录写入权限。");
  }

  await rootHandle.removeEntry(repo.name, { recursive: true });
  selectedRepoName = "all";
  await scanRepositories();
  setStatus(`仓库 ${repo.name} 已删除。`);
  return true;
}

async function pickRootDirectory() {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("当前浏览器不支持目录选择 API。");
  }

  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const granted = await verifyDirectoryPermission(handle, true);

  if (!granted) {
    throw new Error("未获得根目录读写权限。");
  }

  rootHandle = handle;
  rootSummary.textContent = handle.name || "已选择根目录";
  scopeSummary.textContent =
    "系统会自动识别：根目录下直接带 metadata.json 的项目属于默认仓库；其余包含项目子目录的文件夹会被识别为自定义仓库。";
  createRepoButton.disabled = false;
  refreshButton.disabled = false;
}

async function createRepository() {
  if (!rootHandle) {
    throw new Error("请先选择根目录。");
  }

  const input = window.prompt("请输入仓库名称，会在根目录下创建同名文件夹。");
  const repoName = sanitizeName(input);

  if (!repoName) {
    setStatus("已取消创建仓库。");
    return false;
  }

  await rootHandle.getDirectoryHandle(repoName, { create: true });
  selectedRepoName = repoName;
  await scanRepositories();
  setStatus(`仓库 ${repoName} 已创建。`);
  return true;
}

pickRootButton.addEventListener("click", async () => {
  try {
    setStatus("正在请求根目录权限...");
    await pickRootDirectory();
    await scanRepositories();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

createRepoButton.addEventListener("click", async () => {
  try {
    await createRepository();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    await scanRepositories();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

renameRepoButton.addEventListener("click", async () => {
  try {
    renameRepoButton.disabled = true;
    await renameSelectedRepository();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    updateRepositoryManageBar();
  }
});

deleteRepoButton.addEventListener("click", async () => {
  try {
    deleteRepoButton.disabled = true;
    await deleteSelectedRepository();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    updateRepositoryManageBar();
  }
});

moveProjectButton.addEventListener("click", async () => {
  try {
    if (!selectedProject) {
      throw new Error("请先打开一个项目详情。");
    }

    moveProjectButton.disabled = true;
    await moveProject(selectedProject);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    moveProjectButton.disabled = !selectedProject;
  }
});

searchInput.addEventListener("input", () => {
  renderProjects();
});

window.addEventListener("beforeunload", () => {
  releaseObjectUrls();
});
