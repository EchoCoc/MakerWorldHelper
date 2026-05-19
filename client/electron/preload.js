const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  showInstanceContextMenu: (targetPath) => ipcRenderer.invoke("instance:show-context-menu", targetPath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  readLibraryCache: (rootPath) => ipcRenderer.invoke("library:read-cache", rootPath),
  scanRoot: (rootPath) => ipcRenderer.invoke("library:scan-root", rootPath),
  refreshProject: (rootPath, projectPath) =>
    ipcRenderer.invoke("library:refresh-project", rootPath, projectPath),
  createRepo: (rootPath, repoName) => ipcRenderer.invoke("library:create-repo", rootPath, repoName),
  renameRepo: (rootPath, repoName, nextRepoName) =>
    ipcRenderer.invoke("library:rename-repo", rootPath, repoName, nextRepoName),
  deleteRepo: (rootPath, repoName) => ipcRenderer.invoke("library:delete-repo", rootPath, repoName),
  moveProject: (projectPath, targetRepoPath) =>
    ipcRenderer.invoke("library:move-project", projectPath, targetRepoPath)
});
