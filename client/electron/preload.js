const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  showInstanceContextMenu: (targetPath) => ipcRenderer.invoke("instance:show-context-menu", targetPath),
  openProjectWindow: (rootPath, projectPath, projectTitle, projectSnapshot) =>
    ipcRenderer.invoke("window:open-project", rootPath, projectPath, projectTitle, projectSnapshot),
  getProjectSnapshot: (rootPath, projectPath) =>
    ipcRenderer.invoke("window:get-project-snapshot", rootPath, projectPath),
  onProjectSnapshot: (callback) => {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on("window:project-snapshot", listener);
    return () => ipcRenderer.removeListener("window:project-snapshot", listener);
  },
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  readPrintQueue: () => ipcRenderer.invoke("queue:read"),
  writePrintQueue: (entries) => ipcRenderer.invoke("queue:write", entries),
  readLibraryCache: (rootPath) => ipcRenderer.invoke("library:read-cache", rootPath),
  reconcileRoot: (rootPath) => ipcRenderer.invoke("library:reconcile-root", rootPath),
  scanRoot: (rootPath) => ipcRenderer.invoke("library:scan-root", rootPath),
  watchRoot: (rootPath) => ipcRenderer.invoke("library:watch-root", rootPath),
  unwatchRoot: () => ipcRenderer.invoke("library:unwatch-root"),
  onProjectChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("library:project-changed", listener);
    return () => ipcRenderer.removeListener("library:project-changed", listener);
  },
  refreshProject: (rootPath, projectPath) =>
    ipcRenderer.invoke("library:refresh-project", rootPath, projectPath),
  import3mf: (rootPath, targetDirectory) =>
    ipcRenderer.invoke("library:import-3mf", rootPath, targetDirectory),
  importCustomized3mf: (rootPath, projectPath) =>
    ipcRenderer.invoke("library:import-customized-3mf", rootPath, projectPath),
  createRepo: (rootPath, repoName) => ipcRenderer.invoke("library:create-repo", rootPath, repoName),
  renameRepo: (rootPath, repoName, nextRepoName) =>
    ipcRenderer.invoke("library:rename-repo", rootPath, repoName, nextRepoName),
  deleteRepo: (rootPath, repoName) => ipcRenderer.invoke("library:delete-repo", rootPath, repoName),
  deleteProject: (rootPath, projectPath) =>
    ipcRenderer.invoke("library:delete-project", rootPath, projectPath),
  updateProjectTags: (rootPath, projectPath, tags) =>
    ipcRenderer.invoke("library:update-project-tags", rootPath, projectPath, tags),
  updateInstanceFavorite: (rootPath, projectPath, instanceId, isFavorite) =>
    ipcRenderer.invoke("library:update-instance-favorite", rootPath, projectPath, instanceId, isFavorite),
  updateInstanceAlias: (rootPath, projectPath, instanceId, alias) =>
    ipcRenderer.invoke("library:update-instance-alias", rootPath, projectPath, instanceId, alias),
  moveProject: (projectPath, targetRepoPath) =>
    ipcRenderer.invoke("library:move-project", projectPath, targetRepoPath)
});
