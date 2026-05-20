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

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toAbsoluteUrl(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    try {
      return new URL(text, location.href).href;
    } catch {
      return "";
    }
  }

  function isResolvableAssetReference(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }

    if (/^(https?:)?\/\//i.test(text)) {
      return true;
    }

    if (/^[./]/.test(text)) {
      return true;
    }

    return text.includes("/") || text.includes("?");
  }

  function sanitizeFileLikeTitle(value, fallback = "") {
    const text = normalizeText(value || fallback);
    return text.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-");
  }

  function isDocumentKeyword(value) {
    return /document|attachment|manual|guide|assembly|instructions?|pdf|file|download|文档|附件|文件|说明|指南/i.test(
      String(value || "")
    );
  }

  function isDocumentLikeAsset(url, title = "", path = "") {
    const normalizedUrl = String(url || "").trim();
    const normalizedTitle = String(title || "").trim();
    const normalizedPath = String(path || "").trim();
    const context = `${normalizedTitle} ${normalizedPath}`;

    if (/\.stl\.(png|jpe?g|webp)(?:[?#]|$)/i.test(normalizedUrl)) {
      return false;
    }

    if (/makerworld\.com(?:\.cn)?\/[a-z]{2}\/models\//i.test(normalizedUrl)) {
      return false;
    }

    if (/\.pdf(?:[?#]|$)/i.test(normalizedUrl) || /\.pdf$/i.test(normalizedTitle)) {
      return true;
    }

    if (!/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(normalizedUrl) && !/\.(png|jpe?g|webp)$/i.test(normalizedTitle)) {
      return false;
    }

    if (/\/msfile\//i.test(normalizedUrl)) {
      return false;
    }

    return isDocumentKeyword(context) && /\/design\//i.test(normalizedUrl);
  }

  function isUsableDocumentUrl(rawValue, absoluteUrl, title = "", path = "") {
    if (!absoluteUrl || !isDocumentLikeAsset(absoluteUrl, title, path)) {
      return false;
    }

    return isResolvableAssetReference(rawValue);
  }

  const DOCUMENT_URL_ATTRIBUTE_NAMES = ["href", "src", "data-href", "data-url", "data-download-url"];

  function dedupeBy(items, buildKey) {
    const nextItems = [];
    const seen = new Set();

    for (const item of items) {
      const key = buildKey(item);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      nextItems.push(item);
    }

    return nextItems;
  }

  function scoreDocumentTitle(title, url) {
    const text = String(title || "").trim();
    const fileName = String(url || "").split("/").pop() || "";
    let score = 0;

    if (text && text !== fileName) {
      score += 3;
    }

    if (/assembly|instructions?|guide|manual|说明|指南/i.test(text)) {
      score += 3;
    }

    if (/\.pdf$/i.test(text)) {
      score += 1;
    }

    return score;
  }

  function normalizeDocumentEntries(items) {
    const byUrl = new Map();

    for (const item of items.filter(Boolean)) {
      const url = String(item.url || "").trim();
      const title = sanitizeFileLikeTitle(item.title || "", url.split("/").pop() || "document");
      const source = String(item.source || "").trim();

      if (!url || !isDocumentLikeAsset(url, title, item.source || "")) {
        continue;
      }

      if (source === "dom-fallback" && !/^https:\/\/makerworld\.bblmw\.cn\/makerworld\/model\/.+\/design\/.+\.pdf(?:[?#].*)?$/i.test(url)) {
        continue;
      }

      const normalizedItem = {
        title,
        url,
        source: source || "unknown"
      };

      const existing = byUrl.get(url);
      if (!existing) {
        byUrl.set(url, normalizedItem);
        continue;
      }

      const existingScore = scoreDocumentTitle(existing.title, existing.url);
      const nextScore = scoreDocumentTitle(normalizedItem.title, normalizedItem.url);
      if (nextScore > existingScore) {
        byUrl.set(url, normalizedItem);
      }
    }

    return Array.from(byUrl.values());
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function collectDocumentCandidates(value, bucket, path = "root", visited = new WeakSet()) {
    if (value == null) {
      return;
    }

    if (typeof value === "string") {
      const url = toAbsoluteUrl(value);
      if (url && isUsableDocumentUrl(value, url, "", path) && isDocumentKeyword(path)) {
        bucket.push({
          title: sanitizeFileLikeTitle(url.split("/").pop() || "document", "document"),
          url,
          source: "data"
        });
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => collectDocumentCandidates(item, bucket, `${path}[${index}]`, visited));
      return;
    }

    const objectPath = String(path || "");
    const rawCandidateUrl =
      value.url ||
      value.href ||
      value.link ||
      value.downloadUrl ||
      value.fileUrl ||
      value.file_url ||
      value.src ||
      value.path ||
      "";
    const candidateUrl = toAbsoluteUrl(
      rawCandidateUrl
    );
    const candidateTitle = sanitizeFileLikeTitle(
      value.title || value.name || value.fileName || value.filename || value.label || value.displayName || "",
      "document"
    );

    if (
      candidateUrl &&
      isUsableDocumentUrl(rawCandidateUrl, candidateUrl, candidateTitle, objectPath) &&
      isDocumentKeyword(objectPath)
    ) {
      bucket.push({
        title: candidateTitle || sanitizeFileLikeTitle(candidateUrl.split("/").pop() || "document", "document"),
        url: candidateUrl,
        source: "data"
      });
    }

    for (const [key, item] of Object.entries(value)) {
      collectDocumentCandidates(item, bucket, `${objectPath}.${key}`, visited);
    }
  }

  function extractDocumentsFromDom() {
    const documentHeading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).find((element) =>
      /文档|文件|附件|Document/i.test(normalizeText(element.textContent))
    );
    if (!documentHeading) {
      return [];
    }

    const sectionRoot = documentHeading.parentElement;
    if (!sectionRoot) {
      return [];
    }

    const fileTitleElements = Array.from(sectionRoot.querySelectorAll("*")).filter((element) =>
      /\.(pdf|png|jpe?g|webp)\b/i.test(normalizeText(element.textContent))
    );

    const documents = fileTitleElements.map((titleElement) => {
      const title = sanitizeFileLikeTitle(titleElement.textContent, "document");
      let container = titleElement;
      let url = "";

      while (container && container !== sectionRoot && !url) {
        const linkElement = container.querySelector?.("a[href]");
        if (linkElement?.href) {
          url = toAbsoluteUrl(linkElement.href);
          break;
        }

        const downloadTarget =
          container.getAttribute?.("href") ||
          container.getAttribute?.("data-href") ||
          container.getAttribute?.("data-url") ||
          container.getAttribute?.("data-download-url");
        if (downloadTarget) {
          url = toAbsoluteUrl(downloadTarget);
          break;
        }

        container = container.parentElement;
      }

      return {
        title,
        url,
        source: "dom"
      };
    });

    return dedupeBy(
      documents.filter((item) => item.title && item.url),
      (item) => `${item.title}::${item.url}`
    );
  }

  function extractDocumentsWithFallback() {
    const domDocuments = extractDocumentsFromDom();
    if (domDocuments.length > 0) {
      return domDocuments;
    }

    const fileTitleElements = Array.from(document.querySelectorAll("*")).filter((element) =>
      /\.(pdf|png|jpe?g|webp)\b/i.test(normalizeText(element.textContent))
    );

    const documents = fileTitleElements.map((titleElement) => {
      const title = sanitizeFileLikeTitle(titleElement.textContent, "document");
      let container = titleElement;
      let url = "";
      let hopCount = 0;

      while (container && container !== document.body && !url && hopCount < 10) {
        for (const attributeName of DOCUMENT_URL_ATTRIBUTE_NAMES) {
          const rawValue = container.getAttribute?.(attributeName);
          const candidateUrl = toAbsoluteUrl(rawValue);
          if (candidateUrl && isUsableDocumentUrl(rawValue, candidateUrl, title, attributeName)) {
            url = candidateUrl;
            break;
          }
        }

        if (url) {
          break;
        }

        const linkCandidates = [
          container.closest?.("a[href]"),
          container.querySelector?.("a[href]"),
          container.querySelector?.("[data-url]"),
          container.querySelector?.("[data-download-url]"),
          container.querySelector?.("[data-href]")
        ].filter(Boolean);

        for (const linkCandidate of linkCandidates) {
          const downloadTarget = DOCUMENT_URL_ATTRIBUTE_NAMES
            .map((attributeName) => linkCandidate.getAttribute?.(attributeName))
            .find(Boolean);
          const candidateUrl = toAbsoluteUrl(downloadTarget);
          if (candidateUrl && isUsableDocumentUrl(downloadTarget, candidateUrl, title, linkCandidate.outerHTML || "")) {
            url = candidateUrl;
            break;
          }
        }

        if (url) {
          break;
        }

        const nearbyButtons = Array.from(container.parentElement?.querySelectorAll?.("a[href],button,[role='button']") || []);
        for (const buttonElement of nearbyButtons) {
          const aria = normalizeText(buttonElement.getAttribute?.("aria-label") || "");
          const buttonText = normalizeText(buttonElement.textContent || "");
          if (!/download|open|preview|预览|下载|打开/i.test(`${aria} ${buttonText}`)) {
            continue;
          }

          for (const attributeName of DOCUMENT_URL_ATTRIBUTE_NAMES) {
            const rawValue = buttonElement.getAttribute?.(attributeName);
            const candidateUrl = toAbsoluteUrl(rawValue);
            if (candidateUrl && isUsableDocumentUrl(rawValue, candidateUrl, title, attributeName)) {
              url = candidateUrl;
              break;
            }
          }

          if (url) {
            break;
          }
        }

        container = container.parentElement;
        hopCount += 1;
      }

      return {
        title,
        url,
        source: "dom-fallback"
      };
    });

    return dedupeBy(
      documents.filter((item) => item.title && item.url),
      (item) => `${item.title}::${item.url}`
    );
  }

  function toMaterialItem(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const name = normalizeText(
      value.name || value.title || value.productName || value.displayName || value.materialName || ""
    );
    const sku = normalizeText(value.sku || value.code || value.itemCode || value.productCode || "");
    const quantityRaw = value.quantity ?? value.qty ?? value.count ?? value.num ?? null;
    const quantity =
      typeof quantityRaw === "number"
        ? quantityRaw
        : Number.parseInt(String(quantityRaw || "").replace(/[^\d]/g, ""), 10) || null;
    const url = toAbsoluteUrl(value.url || value.link || value.href || value.productUrl || value.jumpUrl || "");

    if (!name) {
      return null;
    }

    if (!sku && quantity == null && !url) {
      return null;
    }

    return {
      name,
      sku,
      quantity,
      url
    };
  }

  function collectMaterialGroups(value, bucket, path = "root", visited = new WeakSet()) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      const materialItems = value.map((item) => toMaterialItem(item)).filter(Boolean);
      if (materialItems.length >= 1 && /material|bom|bill|consum|shop|part/i.test(path.toLowerCase())) {
        bucket.push({
          title: path.split(".").pop()?.replace(/\[\d+\]/g, "") || "物料",
          items: dedupeBy(materialItems, (item) => `${item.name}::${item.sku}::${item.url}`)
        });
      }

      value.forEach((item, index) => collectMaterialGroups(item, bucket, `${path}[${index}]`, visited));
      return;
    }

    for (const [key, item] of Object.entries(value)) {
      collectMaterialGroups(item, bucket, `${path}.${key}`, visited);
    }
  }

  function extractMaterialsFromDom() {
    const materialsHeading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).find((element) =>
      /物料清单|BOM|Material/i.test(normalizeText(element.textContent))
    );
    if (!materialsHeading) {
      return { groups: [], download: null };
    }

    const sectionRoot = materialsHeading.parentElement;
    if (!sectionRoot) {
      return { groups: [], download: null };
    }

    const materialLinks = Array.from(sectionRoot.querySelectorAll("a[href]")).filter((anchor) =>
      /store\.bambulab\.com/i.test(anchor.href)
    );
    const items = dedupeBy(
      materialLinks
        .map((anchor) => {
          const anchorText = normalizeText(anchor.textContent);
          const containerText = normalizeText(anchor.parentElement?.parentElement?.textContent || anchor.textContent);
          const skuMatch =
            containerText.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]{1,}){2,}\b/) ||
            containerText.match(/\b[A-Z]\d{2}-[A-Z0-9.-]+\b/);
          const quantityMatch = containerText.match(/[×xX*]\s*(\d+)/) || containerText.match(/\b(\d+)\s*$/);

          return {
            name: anchorText,
            sku: skuMatch?.[0] || "",
            quantity: quantityMatch ? Number.parseInt(quantityMatch[1], 10) : null,
            url: anchor.href
          };
        })
        .filter((item) => item.name),
      (item) => `${item.name}::${item.sku}::${item.url}`
    );

    const downloadControl = Array.from(sectionRoot.querySelectorAll("a[href],button")).find((element) =>
      /下载物料清单|下載物料清單|download/i.test(normalizeText(element.textContent || element.getAttribute("aria-label")))
    );

    return {
      groups: items.length
        ? [
            {
              title: "物料清单",
              items
            }
          ]
        : [],
      download:
        downloadControl && downloadControl.tagName.toLowerCase() === "a"
          ? {
              title: "物料清单",
              url: toAbsoluteUrl(downloadControl.href)
            }
          : null
    };
  }

  async function collectSupplementalContentWithRetry() {
    let documents = extractDocumentsFromDom();
    let materials = extractMaterialsFromDom();

    if (documents.length > 0 || materials.groups.length > 0 || materials.download) {
      return { documents, materials };
    }

    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
      await delay(180);
      documents = extractDocumentsFromDom();
      materials = extractMaterialsFromDom();

      if (documents.length > 0 || materials.groups.length > 0 || materials.download) {
        break;
      }
    }

    return { documents, materials };
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
    const documentCandidatesFromData = [];
    collectDocumentCandidates(pageProps, documentCandidatesFromData);
    const supplementalContent = await collectSupplementalContentWithRetry();
    const documents = normalizeDocumentEntries([
      ...documentCandidatesFromData,
      ...supplementalContent.documents,
      ...extractDocumentsWithFallback()
    ]);
    const materialGroupsFromData = [];
    collectMaterialGroups(pageProps, materialGroupsFromData);
    const domMaterials = supplementalContent.materials;
    const materials = {
      groups:
        materialGroupsFromData.length > 0
          ? materialGroupsFromData
          : domMaterials.groups,
      download: domMaterials.download
    };

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
        pictures: Array.isArray(extension.design_pictures) ? extension.design_pictures : [],
        documents,
        materials
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
