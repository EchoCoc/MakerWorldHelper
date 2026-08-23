const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  showInstanceContextMenu: (targetPath) => ipcRenderer.invoke("instance:show-context-menu", targetPath),
  openProjectWindow: (rootPath, projectPath, projectTitle) =>
    ipcRenderer.invoke("window:open-project", rootPath, projectPath, projectTitle),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  readPrintQueue: () => ipcRenderer.invoke("queue:read"),
  writePrintQueue: (entries) => ipcRenderer.invoke("queue:write", entries),
  readLibraryCache: (rootPath) => ipcRenderer.invoke("library:read-cache", rootPath),
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
  createRepo: (rootPath, repoName) => ipcRenderer.invoke("library:create-repo", rootPath, repoName),
  renameRepo: (rootPath, repoName, nextRepoName) =>
    ipcRenderer.invoke("library:rename-repo", rootPath, repoName, nextRepoName),
  deleteRepo: (rootPath, repoName) => ipcRenderer.invoke("library:delete-repo", rootPath, repoName),
  deleteProject: (rootPath, projectPath) =>
    ipcRenderer.invoke("library:delete-project", rootPath, projectPath),
  updateProjectTags: (rootPath, projectPath, tags) =>
    ipcRenderer.invoke("library:update-project-tags", rootPath, projectPath, tags),
  moveProject: (projectPath, targetRepoPath) =>
    ipcRenderer.invoke("library:move-project", projectPath, targetRepoPath)
});
