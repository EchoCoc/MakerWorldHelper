function isMakerWorldModelPage(url) {
  return /^https:\/\/makerworld\.(?:com\.cn|com)(?:\/[a-z]{2})?\/models\/.+/i.test(url || "");
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
