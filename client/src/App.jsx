import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { LibraryPage } from "./pages/LibraryPage";

const ROOT_PATH_STORAGE_KEY = "mw-helper.desktop.root-path";
const PROJECTS_PER_PAGE = 24;

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

function pickTargetRepo(project, repositories) {
  const targets = repositories.filter(
    (repo) => repo.kind !== "overview" && repo.id !== project.repoId
  );

  if (targets.length === 0) {
    return null;
  }

  if (targets.length === 1) {
    return targets[0];
  }

  const optionsText = targets.map((repo, index) => `${index + 1}. ${repo.name}`).join("\n");
  const answer = window.prompt(`请选择目标仓库：\n${optionsText}`, "1");
  if (!answer) {
    return undefined;
  }

  const numericIndex = Number.parseInt(answer, 10);
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= targets.length) {
    return targets[numericIndex - 1];
  }

  return targets.find((repo) => repo.name.toLowerCase() === answer.trim().toLowerCase()) || null;
}

function applyLibrarySnapshot({
  repositories,
  projects,
  nextRepoId = "all",
  nextProjectId = null,
  setRepositories,
  setAllProjects,
  setSelectedRepoId,
  setSelectedProjectId,
  setCurrentPage
}) {
  const repoExists = repositories.some((repo) => repo.id === nextRepoId);
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

export default function App() {
  const hasDesktopApi =
    typeof window !== "undefined" &&
    typeof window.desktopAPI?.pickDirectory === "function" &&
    typeof window.desktopAPI?.scanRoot === "function";
  const [rootPath, setRootPath] = useState("");
  const [repositories, setRepositories] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState("all");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [status, setStatus] = useState(() =>
    hasDesktopApi ? "等待选择根目录。" : "当前为浏览器模式，请使用桌面端打开本地资源库。"
  );
  const deferredSearchText = useDeferredValue(searchText);

  const filteredProjects = useMemo(() => {
    const keyword = deferredSearchText.trim().toLowerCase();
    const repoFiltered =
      selectedRepoId === "all"
        ? allProjects
        : allProjects.filter((project) => project.repoId === selectedRepoId);

    if (!keyword) {
      return repoFiltered;
    }

    return repoFiltered.filter((project) =>
      [project.title, project.author, project.modelId, ...(project.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [allProjects, deferredSearchText, selectedRepoId]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE));
  const pageProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * PROJECTS_PER_PAGE;
    return filteredProjects.slice(startIndex, startIndex + PROJECTS_PER_PAGE);
  }, [currentPage, filteredProjects]);

  const selectedProject =
    selectedProjectId == null
      ? null
      : allProjects.find((project) => project.id === selectedProjectId) || null;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedRepoId, searchText]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!hasDesktopApi) {
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
        applyLibrarySnapshot({
          repositories: cacheResult.data.repositories || [],
          projects: cacheResult.data.projects || [],
          setRepositories,
          setAllProjects,
          setSelectedRepoId,
          setSelectedProjectId,
          setCurrentPage
        });
        setStatus(
          `已从缓存恢复 ${cacheResult.data.projects?.length || 0} 个项目，正在后台刷新…`
        );
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
    const { repoExists, projectExists } = applyLibrarySnapshot({
      repositories: nextRepositories,
      projects: nextProjects,
      nextRepoId,
      nextProjectId,
      setRepositories,
      setAllProjects,
      setSelectedRepoId,
      setSelectedProjectId,
      setCurrentPage
    });

    setStatus(nextStatusText || `已加载 ${nextProjects.length} 个项目。`);

    return {
      ok: true,
      repoExists,
      projectExists,
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

  async function handleRefreshProject(project) {
    if (!rootPath || !project) {
      setStatus("当前没有可刷新的项目。");
      return;
    }

    setStatus(`正在刷新项目“${project.title}”…`);
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
      setStatus(`项目“${project.title}”已不存在，已从列表移除。`);
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
    setSelectedRepoId(result.project.repoId || selectedRepoId);
    setSelectedProjectId(result.project.id);
    setStatus(`项目“${result.project.title}”已刷新。`);
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <LibraryPage
            repositories={repositories}
            projects={pageProjects}
            totalProjectCount={filteredProjects.length}
            currentPage={currentPage}
            totalPages={totalPages}
            selectedRepoId={selectedRepoId}
            selectedProject={selectedProject}
            rootPath={rootPath}
            searchText={searchText}
            status={status}
            canPickRoot={hasDesktopApi}
            onPickRoot={handlePickRoot}
            onRefresh={async () => {
              if (!rootPath) {
                setStatus("请先选择根目录。");
                return;
              }

              setStatus("正在重新扫描全部项目…");
              await refreshRoot(rootPath, selectedRepoId);
            }}
            onRefreshProject={handleRefreshProject}
            onRepoChange={(repoId) => {
              setSelectedRepoId(repoId);
              setSelectedProjectId(null);
            }}
            onProjectChange={setSelectedProjectId}
            onPageChange={setCurrentPage}
            onSearchChange={setSearchText}
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

              const repoName = window.prompt("请输入新仓库名称。");
              if (!repoName) {
                setStatus("已取消创建仓库。");
                return;
              }

              const result = await window.desktopAPI?.createRepo?.(rootPath, repoName);
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

              const nextName = window.prompt("请输入新的仓库名称。", repo.name);
              if (!nextName) {
                setStatus("已取消重命名仓库。");
                return;
              }

              const result = await window.desktopAPI?.renameRepo?.(rootPath, repo.name, nextName);
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

              const confirmed = window.confirm(`确认删除空仓库“${repo.name}”吗？`);
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

              const targetRepo = pickTargetRepo(project, repositories);
              if (targetRepo === undefined) {
                setStatus("已取消移动项目。");
                return;
              }

              if (!targetRepo) {
                setStatus("没有可用的目标仓库。");
                return;
              }

              const confirmed = window.confirm(
                `确认将“${project.title}”移动到“${targetRepo.name}”吗？`
              );
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
          />
        }
      />
    </Routes>
  );
}
