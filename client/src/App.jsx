import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { LibraryPage } from "./pages/LibraryPage";

const ROOT_PATH_STORAGE_KEY = "mw-helper.desktop.root-path";
const PRINT_QUEUE_STORAGE_KEY = "mw-helper.desktop.print-queue";
const PROJECTS_PER_PAGE = 24;
const DEFAULT_SORT_KEY = "updated-desc";
const QUEUE_REPO_ID = "queue";
const APP_WINDOW_PARAMS = new URLSearchParams(window.location.search);
const IS_PROJECT_DETAIL_WINDOW = APP_WINDOW_PARAMS.get("window") === "project";
const PROJECT_DETAIL_ROOT_PATH = APP_WINDOW_PARAMS.get("rootPath") || "";
const PROJECT_DETAIL_PROJECT_PATH = APP_WINDOW_PARAMS.get("projectPath") || "";
const QUEUE_STAGE_OPTIONS = [
  { id: "printing", label: "打印中" },
  { id: "assembly", label: "拼装中" }
];

function normalizeSortText(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function getProjectSortTimestamp(project, fieldName) {
  const rawValue = project?.[fieldName];
  const parsedValue = rawValue ? Date.parse(rawValue) : Number.NaN;
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function sortProjects(projects, sortKey) {
  const nextProjects = [...projects];

  nextProjects.sort((left, right) => {
    switch (sortKey) {
      case "added-desc":
        return getProjectSortTimestamp(right, "addedAt") - getProjectSortTimestamp(left, "addedAt");
      case "added-asc":
        return getProjectSortTimestamp(left, "addedAt") - getProjectSortTimestamp(right, "addedAt");
      case "updated-asc":
        return getProjectSortTimestamp(left, "updatedAt") - getProjectSortTimestamp(right, "updatedAt");
      case "title-asc":
        return normalizeSortText(left.title).localeCompare(normalizeSortText(right.title), "zh-CN");
      case "title-desc":
        return normalizeSortText(right.title).localeCompare(normalizeSortText(left.title), "zh-CN");
      case "author-asc":
        return normalizeSortText(left.author).localeCompare(normalizeSortText(right.author), "zh-CN");
      case "author-desc":
        return normalizeSortText(right.author).localeCompare(normalizeSortText(left.author), "zh-CN");
      case "updated-desc":
      default:
        return getProjectSortTimestamp(right, "updatedAt") - getProjectSortTimestamp(left, "updatedAt");
    }
  });

  return nextProjects;
}

function readCachedRootPath() {
  try {
    return window.localStorage.getItem(ROOT_PATH_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeCachedRootPath(rootPath) {
  try {
    if (rootPath) {
      window.localStorage.setItem(ROOT_PATH_STORAGE_KEY, rootPath);
    } else {
      window.localStorage.removeItem(ROOT_PATH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures and continue without persistence.
  }
}

function readCachedQueueEntries() {
  try {
    const rawValue = window.localStorage.getItem(PRINT_QUEUE_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue) ? parsedValue : {};
  } catch {
    return {};
  }
}

function writeCachedQueueEntries(queueEntries) {
  try {
    const hasEntries = Object.keys(queueEntries || {}).length > 0;
    if (hasEntries) {
      window.localStorage.setItem(PRINT_QUEUE_STORAGE_KEY, JSON.stringify(queueEntries));
    } else {
      window.localStorage.removeItem(PRINT_QUEUE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures and continue without persistence.
  }
}

function mergeQueueEntries(...entryGroups) {
  const merged = {};

  for (const entries of entryGroups) {
    for (const [key, entry] of Object.entries(entries || {})) {
      const existingTime = Date.parse(merged[key]?.markedAt || "") || 0;
      const candidateTime = Date.parse(entry?.markedAt || "") || 0;
      if (!merged[key] || candidateTime >= existingTime) {
        merged[key] = entry;
      }
    }
  }

  return merged;
}

function getProjectQueueKey(project) {
  if (project?.modelId) {
    return `model:${project.modelId}`;
  }

  return `path:${project?.projectPath || project?.id || ""}`;
}

function normalizeQueueStage(stage) {
  return stage === "assembly" ? "assembly" : "printing";
}

function normalizeQueueEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const stage = normalizeQueueStage(entry.stage);

  return {
    stage,
    printCompleted: stage === "assembly" || entry.printCompleted === true,
    markedAt:
      typeof entry.markedAt === "string" && entry.markedAt.trim() ? entry.markedAt : new Date().toISOString()
  };
}

function getQueueStageLabel(stage) {
  return normalizeQueueStage(stage) === "assembly" ? "拼装中" : "打印中";
}

function parseTagInput(value) {
  const normalizedText = String(value || "").replace(/，/g, ",");
  const nextTags = [];
  const seenTags = new Set();

  for (const item of normalizedText.split(",")) {
    const tag = item.trim();
    if (!tag) {
      continue;
    }

    const normalizedTag = tag.toLocaleLowerCase("zh-CN");
    if (seenTags.has(normalizedTag)) {
      continue;
    }

    seenTags.add(normalizedTag);
    nextTags.push(tag);
  }

  return nextTags;
}

function syncRepositoryCounts(repositories, projects) {
  const projectCounts = new Map();

  for (const project of projects) {
    projectCounts.set(project.repoId, (projectCounts.get(project.repoId) || 0) + 1);
  }

  return repositories
    .map((repo) => {
      if (repo.id === "all") {
        return {
          ...repo,
          projectCount: projects.length
        };
      }

      return {
        ...repo,
        projectCount: projectCounts.get(repo.id) || 0
      };
    })
    .filter((repo) => !(repo.id === "root" && repo.projectCount === 0));
}

function upsertProject(projects, previousProjectPath, nextProject) {
  const nextProjects = [...projects];
  const projectIndex = nextProjects.findIndex(
    (project) => project.projectPath === previousProjectPath || project.id === nextProject.id
  );

  if (projectIndex >= 0) {
    nextProjects[projectIndex] = nextProject;
    return nextProjects;
  }

  return [nextProject, ...nextProjects];
}

function applyLibrarySnapshot({
  repositories,
  projects,
  nextRepoId = "all",
  nextProjectId = null,
  virtualRepoIds = [],
  setRepositories,
  setAllProjects,
  setSelectedRepoId,
  setSelectedProjectId,
  setCurrentPage
}) {
  const repoExists =
    repositories.some((repo) => repo.id === nextRepoId) || virtualRepoIds.includes(nextRepoId);
  const projectExists = nextProjectId ? projects.some((project) => project.id === nextProjectId) : false;

  setRepositories(repositories);
  setAllProjects(projects);
  setSelectedRepoId(repoExists ? nextRepoId : "all");
  setSelectedProjectId(projectExists ? nextProjectId : null);
  setCurrentPage(1);

  return {
    repoExists,
    projectExists
  };
}

function ModalShell({ title, children, actions, onClose }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div className="appModalOverlay" onMouseDown={onClose}>
      <div className="appModalCard" onMouseDown={(event) => event.stopPropagation()}>
        <div className="appModalHeader">
          <h3>{title}</h3>
        </div>
        <div className="appModalBody">{children}</div>
        <div className="appModalActions">{actions}</div>
      </div>
    </div>
  );
}

function TextInputDialog({ dialog, onCancel, onConfirm }) {
  const [value, setValue] = useState(dialog.initialValue || "");
  const allowEmpty = Boolean(dialog.allowEmpty);
  const canConfirm = allowEmpty || Boolean(value.trim());

  return (
    <ModalShell
      title={dialog.title}
      onClose={onCancel}
      actions={
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="primaryButton"
            type="button"
            onClick={() => onConfirm(value)}
            disabled={!canConfirm}
          >
            {dialog.confirmLabel || "确定"}
          </button>
        </>
      }
    >
      {dialog.message ? <p className="appModalText">{dialog.message}</p> : null}
      <input
        className="appModalInput"
        autoFocus
        value={value}
        placeholder={dialog.placeholder || ""}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canConfirm) {
            onConfirm(value);
          }
        }}
      />
    </ModalShell>
  );
}

function ConfirmDialog({ dialog, onCancel, onConfirm }) {
  return (
    <ModalShell
      title={dialog.title}
      onClose={onCancel}
      actions={
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primaryButton" type="button" onClick={onConfirm}>
            {dialog.confirmLabel || "确定"}
          </button>
        </>
      }
    >
      <p className="appModalText">{dialog.message}</p>
    </ModalShell>
  );
}

function ChoiceDialog({ dialog, onCancel, onConfirm }) {
  const [selectedId, setSelectedId] = useState(dialog.initialSelectedId || dialog.options[0]?.id || "");

  return (
    <ModalShell
      title={dialog.title}
      onClose={onCancel}
      actions={
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="primaryButton"
            type="button"
            onClick={() => onConfirm(selectedId)}
            disabled={!selectedId}
          >
            {dialog.confirmLabel || "确定"}
          </button>
        </>
      }
    >
      {dialog.message ? <p className="appModalText">{dialog.message}</p> : null}
      <div className="appChoiceList">
        {dialog.options.map((option) => (
          <button
            key={option.id}
            className={`appChoiceItem ${selectedId === option.id ? "active" : ""}`}
            type="button"
            onClick={() => setSelectedId(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

export default function App() {
  const hasDesktopApi =
    typeof window !== "undefined" &&
    typeof window.desktopAPI?.pickDirectory === "function" &&
    typeof window.desktopAPI?.scanRoot === "function";
  const [rootPath, setRootPath] = useState(() =>
    IS_PROJECT_DETAIL_WINDOW ? PROJECT_DETAIL_ROOT_PATH : ""
  );
  const [repositories, setRepositories] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState("all");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState(DEFAULT_SORT_KEY);
  const [currentPage, setCurrentPage] = useState(1);
  const [queueEntries, setQueueEntries] = useState(() => readCachedQueueEntries());
  const [status, setStatus] = useState(() =>
    hasDesktopApi
      ? IS_PROJECT_DETAIL_WINDOW
        ? "正在加载项目详情…"
        : "等待选择根目录。"
      : "当前为浏览器模式，请使用桌面端打开本地资源库。"
  );
  const [textDialog, setTextDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [choiceDialog, setChoiceDialog] = useState(null);
  const deferredSearchText = useDeferredValue(searchText);

  function updateQueueEntries(updater) {
    setQueueEntries((currentEntries) => {
      const resolvedEntries =
        typeof updater === "function" ? updater(currentEntries) : updater || {};
      writeCachedQueueEntries(resolvedEntries);
      void window.desktopAPI?.writePrintQueue?.(resolvedEntries);
      return resolvedEntries;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function hydratePrintQueue() {
      const result = await window.desktopAPI?.readPrintQueue?.();
      if (cancelled || !result?.ok) {
        return;
      }

      setQueueEntries((currentEntries) => {
        const mergedEntries = mergeQueueEntries(result.entries, currentEntries);
        writeCachedQueueEntries(mergedEntries);
        void window.desktopAPI?.writePrintQueue?.(mergedEntries);
        return mergedEntries;
      });
    }

    void hydratePrintQueue();
    return () => {
      cancelled = true;
    };
  }, []);

  const decoratedProjects = useMemo(
    () =>
      allProjects.map((project) => {
        const queueEntry = normalizeQueueEntry(queueEntries[getProjectQueueKey(project)]);

        return {
          ...project,
          queueEntry,
          queueStage: queueEntry?.stage || null,
          queueStageLabel: queueEntry ? getQueueStageLabel(queueEntry.stage) : "",
          printCompleted: queueEntry?.printCompleted === true
        };
      }),
    [allProjects, queueEntries]
  );

  const queueProjectCount = useMemo(
    () => decoratedProjects.filter((project) => project.queueEntry).length,
    [decoratedProjects]
  );

  const visibleRepositories = useMemo(() => {
    if (!repositories.length) {
      return repositories;
    }

    const queueRepo = {
      id: QUEUE_REPO_ID,
      name: "打印队列",
      kind: "queue",
      path: "",
      projectCount: queueProjectCount
    };
    const nextRepositories = [...repositories];
    const allRepoIndex = nextRepositories.findIndex((repo) => repo.id === "all");

    if (allRepoIndex >= 0) {
      nextRepositories.splice(allRepoIndex + 1, 0, queueRepo);
    } else {
      nextRepositories.unshift(queueRepo);
    }

    return nextRepositories;
  }, [queueProjectCount, repositories]);

  const filteredProjects = useMemo(() => {
    const keyword = deferredSearchText.trim().toLowerCase();
    const repoFiltered =
      selectedRepoId === "all"
        ? decoratedProjects
        : selectedRepoId === QUEUE_REPO_ID
          ? decoratedProjects.filter((project) => project.queueEntry)
          : decoratedProjects.filter((project) => project.repoId === selectedRepoId);

    const keywordFiltered = !keyword
      ? repoFiltered
      : repoFiltered.filter((project) =>
          [project.title, project.author, project.modelId, ...(project.tags || [])]
            .join(" ")
            .toLowerCase()
            .includes(keyword)
        );

    return sortProjects(keywordFiltered, sortKey);
  }, [decoratedProjects, deferredSearchText, selectedRepoId, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE));
  const pageProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * PROJECTS_PER_PAGE;
    return filteredProjects.slice(startIndex, startIndex + PROJECTS_PER_PAGE);
  }, [currentPage, filteredProjects]);

  const selectedProject =
    selectedProjectId == null
      ? null
      : decoratedProjects.find((project) => project.id === selectedProjectId) || null;

  useEffect(() => {
    if (!IS_PROJECT_DETAIL_WINDOW) {
      return undefined;
    }

    document.title = selectedProject
      ? `${selectedProject.title} - MakerWorld Helper`
      : "项目详情 - MakerWorld Helper";
    return undefined;
  }, [selectedProject]);

  useEffect(() => {
    function handleStorage(event) {
      if (event.key === PRINT_QUEUE_STORAGE_KEY) {
        setQueueEntries(readCachedQueueEntries());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (
      !hasDesktopApi ||
      !rootPath ||
      typeof window.desktopAPI?.watchRoot !== "function" ||
      typeof window.desktopAPI?.onProjectChanged !== "function"
    ) {
      return undefined;
    }

    let disposed = false;
    const unsubscribe = window.desktopAPI.onProjectChanged((payload) => {
      const changedProjectPath = String(payload?.projectPath || "").toLocaleLowerCase();
      const isCurrentRoot =
        String(payload?.rootPath || "").toLocaleLowerCase() === rootPath.toLocaleLowerCase();
      const isCurrentDetailProject =
        !IS_PROJECT_DETAIL_WINDOW ||
        changedProjectPath === PROJECT_DETAIL_PROJECT_PATH.toLocaleLowerCase();

      if (disposed || !payload?.project || !isCurrentRoot || !isCurrentDetailProject) {
        return;
      }

      let nextProjectsSnapshot = null;
      setAllProjects((currentProjects) => {
        nextProjectsSnapshot = upsertProject(
          currentProjects,
          payload.projectPath,
          payload.project
        );
        return nextProjectsSnapshot;
      });
      setRepositories((currentRepositories) =>
        syncRepositoryCounts(currentRepositories, nextProjectsSnapshot || allProjects)
      );
      if (IS_PROJECT_DETAIL_WINDOW) {
        setSelectedProjectId(payload.project.id);
      }
      setStatus(`已自动刷新项目 “${payload.project.title}”。`);
    });

    window.desktopAPI.watchRoot(rootPath).then((result) => {
      if (!disposed && !result?.ok) {
        console.warn("无法监听资源库变化：", result?.error || "未知错误");
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
      void window.desktopAPI?.unwatchRoot?.();
    };
  }, [hasDesktopApi, rootPath]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedRepoId, searchText, sortKey]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (IS_PROJECT_DETAIL_WINDOW) {
      return;
    }

    if (!repositories.length && allProjects.length === 0) {
      return;
    }

    const validQueueKeys = new Set(allProjects.map((project) => getProjectQueueKey(project)));

    updateQueueEntries((currentEntries) => {
      let changed = false;
      const nextEntries = {};

      for (const [queueKey, entry] of Object.entries(currentEntries)) {
        if (!validQueueKeys.has(queueKey)) {
          changed = true;
          continue;
        }

        const normalizedEntry = normalizeQueueEntry(entry);
        if (!normalizedEntry) {
          changed = true;
          continue;
        }

        if (
          normalizedEntry.stage !== entry?.stage ||
          normalizedEntry.printCompleted !== (entry?.printCompleted === true) ||
          normalizedEntry.markedAt !== entry?.markedAt
        ) {
          changed = true;
        }

        nextEntries[queueKey] = normalizedEntry;
      }

      return changed ? nextEntries : currentEntries;
    });
  }, [allProjects, repositories.length]);

  useEffect(() => {
    if (!hasDesktopApi || !IS_PROJECT_DETAIL_WINDOW) {
      return undefined;
    }

    if (!PROJECT_DETAIL_ROOT_PATH || !PROJECT_DETAIL_PROJECT_PATH) {
      setStatus("缺少项目路径，无法打开项目详情。");
      return undefined;
    }

    let cancelled = false;

    setRootPath(PROJECT_DETAIL_ROOT_PATH);
    setStatus("正在读取项目详情…");

    (async () => {
      const result = await window.desktopAPI?.refreshProject?.(
        PROJECT_DETAIL_ROOT_PATH,
        PROJECT_DETAIL_PROJECT_PATH
      );
      if (cancelled) {
        return;
      }

      if (!result?.ok) {
        setStatus(result?.error || "项目详情加载失败。");
        return;
      }

      if (!result.project) {
        setStatus("项目已被移动或删除，无法打开项目详情。");
        return;
      }

      setRepositories([]);
      setAllProjects([result.project]);
      setSelectedRepoId(result.project.repoId || "all");
      setSelectedProjectId(result.project.id);
      setCurrentPage(1);
      setStatus("项目详情已加载。");
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDesktopApi]);

  useEffect(() => {
    if (!hasDesktopApi || IS_PROJECT_DETAIL_WINDOW) {
      return undefined;
    }

    const cachedRootPath = readCachedRootPath();
    if (!cachedRootPath) {
      return undefined;
    }

    let cancelled = false;

    setRootPath(cachedRootPath);
    setStatus("正在恢复上次的根目录…");

    (async () => {
      const cacheResult = await window.desktopAPI?.readLibraryCache?.(cachedRootPath);
      if (!cancelled && cacheResult?.ok && cacheResult?.data) {
        const cachedProjects = cacheResult.data.projects || [];
        applyLibrarySnapshot({
          repositories: cacheResult.data.repositories || [],
          projects: cachedProjects,
          nextProjectId: null,
          virtualRepoIds: [QUEUE_REPO_ID],
          setRepositories,
          setAllProjects,
          setSelectedRepoId,
          setSelectedProjectId,
          setCurrentPage
        });
        setStatus(`已从缓存恢复 ${cachedProjects.length} 个项目，正在后台刷新…`);
      } else if (!cancelled) {
        setStatus("正在扫描本地项目…");
      }

      const scanResult = await window.desktopAPI.scanRoot(cachedRootPath);
      if (cancelled) {
        return;
      }

      if (!scanResult?.ok) {
        writeCachedRootPath("");
        setRootPath("");
        setRepositories([]);
        setAllProjects([]);
        setSelectedRepoId("all");
        setSelectedProjectId(null);
        setCurrentPage(1);
        setStatus("上次保存的根目录不可用，请重新选择。");
        return;
      }

      const nextRepositories = scanResult.data.repositories || [];
      const nextProjects = scanResult.data.projects || [];

      applyLibrarySnapshot({
        repositories: nextRepositories,
        projects: nextProjects,
        nextProjectId: null,
        virtualRepoIds: [QUEUE_REPO_ID],
        setRepositories,
        setAllProjects,
        setSelectedRepoId,
        setSelectedProjectId,
        setCurrentPage
      });
      setStatus(`已自动恢复 ${nextProjects.length} 个项目。`);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDesktopApi]);

  function requestTextDialog(dialog) {
    return new Promise((resolve) => {
      setTextDialog({
        ...dialog,
        resolve
      });
    });
  }

  function requestConfirmDialog(dialog) {
    return new Promise((resolve) => {
      setConfirmDialog({
        ...dialog,
        resolve
      });
    });
  }

  function requestChoiceDialog(dialog) {
    return new Promise((resolve) => {
      setChoiceDialog({
        ...dialog,
        resolve
      });
    });
  }

  async function pickTargetRepo(project) {
    const targets = repositories.filter(
      (repo) => repo.kind !== "overview" && repo.kind !== "queue" && repo.id !== project.repoId
    );

    if (targets.length === 0) {
      return null;
    }

    if (targets.length === 1) {
      return targets[0];
    }

    const selectedRepoIdValue = await requestChoiceDialog({
      title: "选择目标仓库",
      message: `请选择 “${project.title}” 要移动到哪个仓库。`,
      confirmLabel: "移动到这里",
      options: targets.map((repo) => ({
        id: repo.id,
        label: repo.name
      }))
    });

    if (!selectedRepoIdValue) {
      return undefined;
    }

    return targets.find((repo) => repo.id === selectedRepoIdValue) || null;
  }

  async function handleQueueProject(project) {
    if (!project) {
      return;
    }

    const queueKey = getProjectQueueKey(project);
    const currentEntry = normalizeQueueEntry(queueEntries[queueKey]);
    const selectedStage = await requestChoiceDialog({
      title: currentEntry ? "更新队列状态" : "加入打印队列",
      message: `为 “${project.title}” 选择当前阶段。`,
      confirmLabel: currentEntry ? "更新状态" : "加入队列",
      initialSelectedId: currentEntry?.stage || "printing",
      options: QUEUE_STAGE_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label
      }))
    });

    if (!selectedStage) {
      setStatus(currentEntry ? "已取消更新队列状态。" : "已取消加入打印队列。");
      return;
    }

    const nextStage = normalizeQueueStage(selectedStage);
    const nextEntry = {
      stage: nextStage,
      printCompleted: nextStage === "assembly",
      markedAt: currentEntry?.markedAt || new Date().toISOString()
    };

    updateQueueEntries((currentEntries) => ({
      ...currentEntries,
      [queueKey]: nextEntry
    }));
    setStatus(`项目 “${project.title}” 已标记为${getQueueStageLabel(nextEntry.stage)}。`);
  }

  function handleMarkPrintCompleted(project) {
    if (!project) {
      return;
    }

    const queueKey = getProjectQueueKey(project);
    const currentEntry = normalizeQueueEntry(queueEntries[queueKey]);
    if (!currentEntry || currentEntry.printCompleted) {
      return;
    }

    updateQueueEntries((currentEntries) => ({
      ...currentEntries,
      [queueKey]: {
        ...currentEntry,
        printCompleted: true
      }
    }));
    setStatus(`项目 “${project.title}” 已标记为已打印完成。`);
  }

  function handleMarkPrintIncomplete(project) {
    if (!project) {
      return;
    }

    const queueKey = getProjectQueueKey(project);
    const currentEntry = normalizeQueueEntry(queueEntries[queueKey]);
    if (!currentEntry || !currentEntry.printCompleted) {
      return;
    }

    const nextEntry = {
      ...currentEntry,
      stage: currentEntry.stage === "assembly" ? "printing" : currentEntry.stage,
      printCompleted: false
    };

    updateQueueEntries((currentEntries) => ({
      ...currentEntries,
      [queueKey]: nextEntry
    }));
    setStatus(`项目 “${project.title}” 已标记为未打印完成。`);
  }

  function handleRemoveQueuedProject(project) {
    if (!project) {
      return;
    }

    const queueKey = getProjectQueueKey(project);
    updateQueueEntries((currentEntries) => {
      if (!currentEntries[queueKey]) {
        return currentEntries;
      }

      const nextEntries = { ...currentEntries };
      delete nextEntries[queueKey];
      return nextEntries;
    });
    setStatus(`项目 “${project.title}” 已从打印队列移除。`);
  }

  async function refreshRoot(
    targetRootPath,
    nextRepoId = selectedRepoId,
    nextProjectId = null,
    nextStatusText = null
  ) {
    if (!targetRootPath) {
      return false;
    }

    const scanResult = await window.desktopAPI?.scanRoot?.(targetRootPath);
    if (!scanResult?.ok) {
      setStatus(scanResult?.error || "扫描失败。");
      return false;
    }

    const nextRepositories = scanResult.data.repositories || [];
    const nextProjects = scanResult.data.projects || [];

    applyLibrarySnapshot({
      repositories: nextRepositories,
      projects: nextProjects,
      nextRepoId,
      nextProjectId,
      virtualRepoIds: [QUEUE_REPO_ID],
      setRepositories,
      setAllProjects,
      setSelectedRepoId,
      setSelectedProjectId,
      setCurrentPage
    });

    setStatus(nextStatusText || `已加载 ${nextProjects.length} 个项目。`);

    return {
      ok: true,
      projectCount: nextProjects.length,
      repositories: nextRepositories,
      projects: nextProjects
    };
  }

  async function handlePickRoot() {
    if (!hasDesktopApi) {
      setStatus("当前页面运行在浏览器中，无法调用桌面目录选择器。请使用桌面端打开。");
      return;
    }

    const result = await window.desktopAPI?.pickDirectory?.();
    if (!result?.ok) {
      setStatus(result?.canceled ? "已取消选择根目录。" : "选择根目录失败。");
      return;
    }

    setRootPath(result.path);
    writeCachedRootPath(result.path);
    setStatus("正在扫描本地项目…");
    await refreshRoot(result.path, "all");
  }

  async function handleImport3mf() {
    if (!rootPath) {
      setStatus("请先选择根目录。");
      return;
    }

    const selectedRepo = repositories.find((repo) => repo.id === selectedRepoId) || null;
    const targetDirectory = selectedRepo && selectedRepo.kind !== "overview" ? selectedRepo.path : rootPath;

    setStatus("正在导入 3MF 文件…");
    const result = await window.desktopAPI?.import3mf?.(rootPath, targetDirectory);

    if (!result?.ok) {
      if (result?.canceled) {
        setStatus("已取消导入 3MF 文件。");
        return;
      }

      setStatus(result?.error || "导入 3MF 文件失败。");
      return;
    }

    const importedCount = result.imported?.length || 0;
    const failedCount = result.failed?.length || 0;
    const statusText =
      failedCount > 0
        ? `已导入 ${importedCount} 个项目，失败 ${failedCount} 个。`
        : `已导入 ${importedCount} 个项目。`;

    await refreshRoot(rootPath, selectedRepoId, null, statusText);
  }

  async function handleRefreshProject(project) {
    if (!rootPath || !project) {
      setStatus("当前没有可刷新的项目。");
      return;
    }

    setStatus(`正在刷新项目 “${project.title}”…`);
    const result = await window.desktopAPI?.refreshProject?.(rootPath, project.projectPath);

    if (!result?.ok) {
      setStatus(result?.error || "刷新项目失败。");
      return;
    }

    if (!result.project) {
      let nextProjectsSnapshot = null;
      setAllProjects((currentProjects) => {
        nextProjectsSnapshot = currentProjects.filter(
          (currentProject) => currentProject.projectPath !== project.projectPath
        );
        return nextProjectsSnapshot;
      });
      setRepositories((currentRepositories) =>
        syncRepositoryCounts(currentRepositories, nextProjectsSnapshot || allProjects)
      );
      setSelectedProjectId((currentProjectId) => (currentProjectId === project.id ? null : currentProjectId));
      setStatus(`项目 “${project.title}” 已不存在，已从列表移除。`);
      return;
    }

    let nextProjectsSnapshot = null;
    setAllProjects((currentProjects) => {
      nextProjectsSnapshot = upsertProject(currentProjects, project.projectPath, result.project);
      return nextProjectsSnapshot;
    });
    setRepositories((currentRepositories) =>
      syncRepositoryCounts(currentRepositories, nextProjectsSnapshot || allProjects)
    );
    setSelectedRepoId((currentRepoId) =>
      currentRepoId === QUEUE_REPO_ID ? QUEUE_REPO_ID : result.project.repoId || currentRepoId
    );
    setSelectedProjectId(result.project.id);
    setStatus(`项目 “${result.project.title}” 已刷新。`);
  }

  async function handleEditProjectTags(project) {
    if (!rootPath || !project) {
      setStatus("当前没有可编辑标签的项目。");
      return;
    }

    const nextTagText = await requestTextDialog({
      title: "编辑标签",
      message: `请编辑“${project.title}”的标签，多个标签用逗号分隔。留空可清空标签。`,
      initialValue: (project.tags || []).join(", "),
      placeholder: "例如：手办, 磁吸, 可动",
      confirmLabel: "保存标签",
      allowEmpty: true
    });

    if (nextTagText == null) {
      setStatus("已取消编辑标签。");
      return;
    }

    const nextTags = parseTagInput(nextTagText);
    const result = await window.desktopAPI?.updateProjectTags?.(rootPath, project.projectPath, nextTags);

    if (!result?.ok || !result.project) {
      setStatus(result?.error || "更新标签失败。");
      return;
    }

    let nextProjectsSnapshot = null;
    setAllProjects((currentProjects) => {
      nextProjectsSnapshot = upsertProject(currentProjects, project.projectPath, result.project);
      return nextProjectsSnapshot;
    });
    setRepositories((currentRepositories) =>
      syncRepositoryCounts(currentRepositories, nextProjectsSnapshot || allProjects)
    );
    setSelectedProjectId(result.project.id);
    setStatus(
      nextTags.length > 0
        ? `项目“${result.project.title}”的标签已更新。`
        : `项目“${result.project.title}”的标签已清空。`
    );
  }

  async function handleDeleteProject(project) {
    if (!rootPath || !project) {
      setStatus("当前没有可删除的项目。");
      return;
    }

    const confirmed = await requestConfirmDialog({
      title: "删除项目",
      message: `确认删除项目 “${project.title}” 吗？此操作会删除本地项目目录及其中的文件。`,
      confirmLabel: "确认删除"
    });
    if (!confirmed) {
      setStatus("已取消删除项目。");
      return;
    }

    const result = await window.desktopAPI?.deleteProject?.(rootPath, project.projectPath);
    if (!result?.ok) {
      setStatus(result?.error || "删除项目失败。");
      return;
    }

    let nextProjectsSnapshot = null;
    setAllProjects((currentProjects) => {
      nextProjectsSnapshot = currentProjects.filter(
        (currentProject) => currentProject.projectPath !== project.projectPath
      );
      return nextProjectsSnapshot;
    });
    setRepositories((currentRepositories) =>
      syncRepositoryCounts(currentRepositories, nextProjectsSnapshot || allProjects)
    );
    setSelectedProjectId((currentProjectId) => (currentProjectId === project.id ? null : currentProjectId));
    setStatus(`项目 “${project.title}” 已删除。`);
  }

  async function handleOpenProject(projectId) {
    if (projectId == null) {
      setSelectedProjectId(null);
      return;
    }

    const project = decoratedProjects.find((item) => item.id === projectId);
    if (!project) {
      setStatus("未找到要打开的项目。");
      return;
    }

    if (
      !IS_PROJECT_DETAIL_WINDOW &&
      rootPath &&
      typeof window.desktopAPI?.openProjectWindow === "function"
    ) {
      const result = await window.desktopAPI.openProjectWindow(
        rootPath,
        project.projectPath,
        project.title
      );
      if (!result?.ok) {
        setStatus(result?.error || "打开项目详情窗口失败。");
        return;
      }

      setStatus(result.reused ? `已切换到“${project.title}”的详情窗口。` : `已打开“${project.title}”。`);
      return;
    }

    setSelectedProjectId(projectId);
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <LibraryPage
              repositories={visibleRepositories}
              projects={pageProjects}
              totalProjectCount={filteredProjects.length}
              queueProjectCount={queueProjectCount}
              currentPage={currentPage}
              totalPages={totalPages}
              selectedRepoId={selectedRepoId}
              selectedProject={selectedProject}
              rootPath={rootPath}
              searchText={searchText}
              sortKey={sortKey}
              status={status}
              isProjectWindow={IS_PROJECT_DETAIL_WINDOW}
              canPickRoot={hasDesktopApi}
              onPickRoot={handlePickRoot}
              onImport3mf={handleImport3mf}
              onRefresh={async () => {
                if (!rootPath) {
                  setStatus("请先选择根目录。");
                  return;
                }

                setStatus("正在重新扫描全部项目…");
                await refreshRoot(rootPath, selectedRepoId);
              }}
              onRefreshProject={handleRefreshProject}
              onEditProjectTags={handleEditProjectTags}
              onQueueProject={handleQueueProject}
              onMarkPrintCompleted={handleMarkPrintCompleted}
              onMarkPrintIncomplete={handleMarkPrintIncomplete}
              onRemoveQueuedProject={handleRemoveQueuedProject}
              onRepoChange={(repoId) => {
                setSelectedRepoId(repoId);
                setSelectedProjectId(null);
              }}
              onProjectChange={handleOpenProject}
              onCloseProjectWindow={() => window.close()}
              onPageChange={setCurrentPage}
              onSearchChange={setSearchText}
              onSortChange={setSortKey}
              onOpenExternal={async (url) => {
                if (!url) {
                  return;
                }

                await window.desktopAPI?.openExternal?.(url);
              }}
              onOpenPath={async (targetPath) => {
                if (!targetPath) {
                  return;
                }

                const result = await window.desktopAPI?.openPath?.(targetPath);
                if (!result?.ok) {
                  setStatus(result?.error || "打开路径失败。");
                }
              }}
              onCreateRepo={async () => {
                if (!rootPath) {
                  setStatus("请先选择根目录。");
                  return;
                }

                const repoName = await requestTextDialog({
                  title: "创建仓库",
                  message: "请输入新仓库名称。",
                  placeholder: "例如：动漫手办",
                  confirmLabel: "创建"
                });
                if (!repoName?.trim()) {
                  setStatus("已取消创建仓库。");
                  return;
                }

                const result = await window.desktopAPI?.createRepo?.(rootPath, repoName.trim());
                if (!result?.ok) {
                  setStatus(result?.error || "创建仓库失败。");
                  return;
                }

                setStatus(`仓库 ${result.name} 已创建。`);
                await refreshRoot(rootPath, result.name);
              }}
              onRenameRepo={async (repo) => {
                if (!rootPath || !repo || repo.kind !== "custom") {
                  return;
                }

                const nextName = await requestTextDialog({
                  title: "重命名仓库",
                  message: `请输入 “${repo.name}” 的新名称。`,
                  initialValue: repo.name,
                  confirmLabel: "保存"
                });
                if (!nextName?.trim()) {
                  setStatus("已取消重命名仓库。");
                  return;
                }

                const result = await window.desktopAPI?.renameRepo?.(rootPath, repo.name, nextName.trim());
                if (!result?.ok) {
                  setStatus(result?.error || "重命名仓库失败。");
                  return;
                }

                setStatus(`仓库已重命名为 ${result.name}。`);
                await refreshRoot(rootPath, result.name);
              }}
              onDeleteRepo={async (repo) => {
                if (!rootPath || !repo || repo.kind !== "custom") {
                  return;
                }

                const confirmed = await requestConfirmDialog({
                  title: "删除仓库",
                  message: `确认删除空仓库 “${repo.name}” 吗？`,
                  confirmLabel: "确认删除"
                });
                if (!confirmed) {
                  setStatus("已取消删除仓库。");
                  return;
                }

                const result = await window.desktopAPI?.deleteRepo?.(rootPath, repo.name);
                if (!result?.ok) {
                  setStatus(result?.error || "删除仓库失败。");
                  return;
                }

                setStatus(`仓库 ${repo.name} 已删除。`);
                await refreshRoot(rootPath, "all");
              }}
              onMoveProject={async (project) => {
                if (!project) {
                  return;
                }

                const targetRepo = await pickTargetRepo(project);
                if (targetRepo === undefined) {
                  setStatus("已取消移动项目。");
                  return;
                }

                if (!targetRepo) {
                  setStatus("没有可用的目标仓库。");
                  return;
                }

                const confirmed = await requestConfirmDialog({
                  title: "移动项目",
                  message: `确认将 “${project.title}” 移动到 “${targetRepo.name}” 吗？`,
                  confirmLabel: "确认移动"
                });
                if (!confirmed) {
                  setStatus("已取消移动项目。");
                  return;
                }

                const result = await window.desktopAPI?.moveProject?.(project.projectPath, targetRepo.path);
                if (!result?.ok) {
                  setStatus(result?.error || "移动项目失败。");
                  return;
                }

                setStatus(`项目已移动到 ${targetRepo.name}。`);
                await refreshRoot(rootPath, targetRepo.id);
              }}
              onDeleteProject={handleDeleteProject}
            />
          }
        />
      </Routes>

      {textDialog ? (
        <TextInputDialog
          dialog={textDialog}
          onCancel={() => {
            textDialog.resolve(null);
            setTextDialog(null);
          }}
          onConfirm={(value) => {
            textDialog.resolve(value);
            setTextDialog(null);
          }}
        />
      ) : null}

      {confirmDialog ? (
        <ConfirmDialog
          dialog={confirmDialog}
          onCancel={() => {
            confirmDialog.resolve(false);
            setConfirmDialog(null);
          }}
          onConfirm={() => {
            confirmDialog.resolve(true);
            setConfirmDialog(null);
          }}
        />
      ) : null}

      {choiceDialog ? (
        <ChoiceDialog
          dialog={choiceDialog}
          onCancel={() => {
            choiceDialog.resolve("");
            setChoiceDialog(null);
          }}
          onConfirm={(value) => {
            choiceDialog.resolve(value);
            setChoiceDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
