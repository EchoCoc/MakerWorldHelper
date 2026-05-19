(function () {
  const DESIGN_SERVICE_HEADERS = {
    "X-BBL-Client-Type": "web",
    "X-BBL-Client-Version": "00.00.00.01",
    "X-BBL-App-Source": "makerworld",
    "X-BBL-Client-Name": "MakerWorld",
    "Content-Type": "application/json"
  };

  function isMakerWorldModelPage(url) {
    return /^https:\/\/makerworld\.(?:com\.cn|com)(?:\/[a-z]{2})?\/models\/.+/i.test(url || "");
  }

  function parseNextDataFromHtml(html) {
    const match = html.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/
    );

    if (!match?.[1]) {
      throw new Error("Missing __NEXT_DATA__ payload.");
    }

    return JSON.parse(match[1]);
  }

  function getNextDataFromDocument() {
    const node = document.getElementById("__NEXT_DATA__");

    if (!node?.textContent) {
      throw new Error("Missing __NEXT_DATA__ payload.");
    }

    return JSON.parse(node.textContent);
  }

  function getFetchablePageUrl() {
    const url = new URL(location.href);
    url.hash = "";
    return url.toString();
  }

  async function getLatestNextData() {
    const response = await fetch(getFetchablePageUrl(), {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Failed to reload page HTML: HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseNextDataFromHtml(html);
  }

  function stripHtml(html) {
    if (!html) {
      return "";
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent?.trim() || "";
  }

  function slugifySegment(value) {
    return String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function mapPlate(plate) {
    return {
      index: plate?.index ?? null,
      name: plate?.name || "",
      predictionSeconds: plate?.prediction ?? null,
      weightGrams: plate?.weight ?? null,
      thumbnailUrl: plate?.thumbnail?.url || "",
      topPictureUrl: plate?.top_picture?.url || "",
      pickPictureUrl: plate?.pick_picture?.url || "",
      filaments: Array.isArray(plate?.filaments)
        ? plate.filaments.map((filament) => ({
            id: filament?.id || "",
            type: filament?.type || "",
            color: filament?.color || "",
            usedMeters: filament?.usedM || "",
            usedGrams: filament?.usedG || ""
          }))
        : []
    };
  }

  const INVALID_COMPATIBILITY_CODES = new Set(["O1D", "O1S", "N1"]);

  function normalizeCompatibilityName(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    return INVALID_COMPATIBILITY_CODES.has(text.toUpperCase()) ? "" : text;
  }

  function sanitizeCompatibilityValue(value) {
    if (!value) {
      return value;
    }

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => sanitizeCompatibilityValue(item))
        .filter((item) => item !== null && item !== undefined);
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
          collectCompatibilityParts(value[key], bucket);
        }
      }
    }
  }

  function formatCompatibility(value, otherValue) {
    const bucket = [];
    collectCompatibilityParts(value, bucket);
    collectCompatibilityParts(otherValue, bucket);
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

  async function fetchJson(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: DESIGN_SERVICE_HEADERS
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    return response.json();
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isRetryableDownloadError(message) {
    return /HTTP 418|HTTP 429|HTTP 5\d\d|not a robot|Failed to fetch|NetworkError/i.test(message || "");
  }

  async function resolveInstanceDownload(instanceId) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const data = await fetchJson(`/api/v1/design-service/instance/${instanceId}/f3mf?type=download`);
        return {
          ok: true,
          name: data?.name || "",
          url: data?.url || ""
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldRetry = attempt < maxAttempts && isRetryableDownloadError(message);

        if (!shouldRetry) {
          return {
            ok: false,
            error: message
          };
        }

        await delay(300 * attempt);
      }
    }
  }

  async function mapInstance(instance) {
    const modelInfo = instance?.extention?.modelInfo || {};
    const compatibility = sanitizeCompatibilityValue(modelInfo.compatibility || null);
    const otherCompatibility = Array.isArray(modelInfo.otherCompatibility)
      ? sanitizeCompatibilityValue(modelInfo.otherCompatibility)
      : [];
    const download3mf = await resolveInstanceDownload(instance?.id);

    return {
      id: instance?.id ?? null,
      profileId: instance?.profileId ?? null,
      title: instance?.title || "",
      summary: instance?.summary || "",
      coverUrl: instance?.cover || "",
      createdAt: instance?.createTime || "",
      updatedAt: instance?.updateTime || "",
      publishTime: instance?.publishTime || "",
      downloadCount: instance?.downloadCount ?? 0,
      printCount: instance?.printCount ?? 0,
      ratingCount: instance?.ratingCount ?? 0,
      ratingScoreTotal: instance?.ratingScoreTotal ?? 0,
      score: instance?.score ?? null,
      hasZipStl: Boolean(instance?.hasZipStl),
      appCanPrint: Boolean(instance?.appCanPrint),
      materialCount: instance?.materialCnt ?? 0,
      materialColorCount: instance?.materialColorCnt ?? 0,
      needAms: Boolean(instance?.needAms),
      predictionSeconds: instance?.prediction ?? null,
      weightGrams: instance?.weight ?? null,
      compatibility,
      compatibilityText: formatCompatibility(compatibility, otherCompatibility),
      otherCompatibility,
      filaments: Array.isArray(instance?.instanceFilaments)
        ? instance.instanceFilaments.map((filament) => ({
            type: filament?.type || "",
            color: filament?.color || "",
            usedMeters: filament?.usedM || "",
            usedGrams: filament?.usedG || ""
          }))
        : [],
      pictures: Array.isArray(instance?.pictures)
        ? instance.pictures.map((picture) => ({
            name: picture?.name || "",
            url: picture?.url || "",
            isRealLifePhoto: picture?.isRealLifePhoto ?? 0
          }))
        : [],
      plates: Array.isArray(modelInfo.plates) ? modelInfo.plates.map(mapPlate) : [],
      downloads: {
        f3mf: download3mf
      }
    };
  }

  async function buildModelRecord() {
    if (!isMakerWorldModelPage(location.href)) {
      throw new Error("Current page is not a MakerWorld model page.");
    }

    let nextData;

    try {
      nextData = await getLatestNextData();
    } catch (_error) {
      nextData = getNextDataFromDocument();
    }

    const pageProps = nextData?.props?.pageProps || {};
    const design = pageProps.design || {};
    const extension = design.designExtension || {};
    const creator = design.designCreator || {};

    const title = design.title || document.title || "makerworld-model";
    const slugBase = slugifySegment(`${design.id || "model"}-${title}`);
    const instances = [];

    for (const instance of Array.isArray(design.instances) ? design.instances : []) {
      instances.push(await mapInstance(instance));
      await delay(80);
    }

    return {
      parserVersion: 2,
      site: location.hostname,
      pageType: "model",
      sourceUrl: location.href,
      capturedAt: new Date().toISOString(),
      folderName: slugBase || "makerworld-model",
      model: {
        id: design.id ?? null,
        modelId: design.modelId || "",
        title,
        slug: design.slug || "",
        summaryHtml: design.summary || "",
        summaryText: stripHtml(design.summary || ""),
        coverUrl: design.coverUrl || "",
        coverLandscapeUrl: design.coverLandscape || "",
        coverPortraitUrl: design.coverPortrait || "",
        license: design.license || "",
        createdAt: design.createTime || "",
        updatedAt: design.updateTime || "",
        likeCount: design.likeCount ?? 0,
        collectionCount: design.collectionCount ?? 0,
        shareCount: design.shareCount ?? 0,
        printCount: design.printCount ?? 0,
        commentCount: design.commentCount ?? 0,
        downloadCount: design.downloadCount ?? 0,
        rawModelFileDownloadCount: design.rawModelFileDownloadCount ?? 0,
        categories: Array.isArray(design.categories) ? design.categories : [],
        tags: Array.isArray(design.tags) ? design.tags : [],
        pictures: Array.isArray(extension.design_pictures) ? extension.design_pictures : []
      },
      creator: {
        uid: creator.uid ?? null,
        name: creator.name || "",
        handle: creator.handle || "",
        avatar: creator.avatar || "",
        fanCount: creator.fanCount ?? 0,
        followCount: creator.followCount ?? 0,
        level: creator.level ?? null,
        certificated: Boolean(creator.certificated)
      },
      instances,
      downloadHints: {
        designId: design.id ?? null,
        modelId: design.modelId || "",
        defaultInstanceId: design.defaultInstanceId ?? null,
        instanceHints: instances.map((instance) => ({
          instanceId: instance.id,
          profileId: instance.profileId,
          hasZipStl: instance.hasZipStl,
          appCanPrint: instance.appCanPrint,
          f3mf: instance.downloads?.f3mf || null
        }))
      },
      commentsPreview: Array.isArray(pageProps.commentsAndInstRating)
        ? pageProps.commentsAndInstRating.slice(0, 10)
        : []
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "mwqs:extract-model") {
      return false;
    }

    buildModelRecord()
      .then((record) => {
        sendResponse({ ok: true, data: record });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });
})();
