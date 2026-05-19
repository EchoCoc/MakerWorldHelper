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

chrome.runtime.onInstalled.addListener(() => {
  console.log("MakerWorld Helper CN installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "mwqs:get-active-model") {
    return false;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;

    if (!tab?.id) {
      sendResponse({ ok: false, error: "没有找到当前活动标签页。" });
      return;
    }

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
