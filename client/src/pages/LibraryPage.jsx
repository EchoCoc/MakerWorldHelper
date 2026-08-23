import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

function getVisiblePageItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const visiblePages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);

  if (currentPage <= 4) {
    [2, 3, 4, 5].forEach((page) => visiblePages.add(page));
  }

  if (currentPage >= totalPages - 3) {
    [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) =>
      visiblePages.add(page)
    );
  }

  const pages = [...visiblePages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  const items = [];

  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) {
      items.push(`ellipsis-${pages[index - 1]}-${page}`);
    }
    items.push(page);
  });

  return items;
}

function getRepoBadge(kind) {
  if (kind === "default") {
    return "默认仓库";
  }

  if (kind === "custom") {
    return "自定义仓库";
  }

  if (kind === "queue") {
    return "进行中";
  }

  return "总览";
}

function getSafeHtml(project) {
  return project.summaryHtml || `<p>${project.summaryText || "暂无摘要。"}</p>`;
}

function formatPrintDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const hours = value / 3600;
  return `${Number(hours.toFixed(hours >= 10 ? 1 : 2))} 小时`;
}

function formatPrintWeight(grams) {
  const value = Number(grams);
  return Number.isFinite(value) && value > 0 ? `${Math.round(value)} g` : "-";
}

function formatInstanceRating(instance) {
  const count = Number(instance?.ratingCount);
  const total = Number(instance?.ratingScoreTotal);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(total)) {
    return "-";
  }

  return (total / count).toFixed(1);
}

function getFilamentColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) ? color : "#d8d0c5";
}

const TAG_SWATCHES = [
  { bg: "rgba(182, 81, 0, 0.16)", text: "#8e3d00" },
  { bg: "rgba(24, 119, 242, 0.14)", text: "#185abc" },
  { bg: "rgba(46, 160, 67, 0.14)", text: "#216e39" },
  { bg: "rgba(167, 29, 42, 0.14)", text: "#8f1d2c" },
  { bg: "rgba(123, 97, 255, 0.14)", text: "#5b43d6" },
  { bg: "rgba(0, 140, 140, 0.14)", text: "#006d6d" }
];

function getTagColor(tag) {
  const source = String(tag || "");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % TAG_SWATCHES.length;
  }

  return TAG_SWATCHES[hash];
}

function ProjectCard({
  project,
  onProjectChange,
  onOpenPath,
  onMoveProject,
  onEditProjectTags,
  onQueueProject,
  onMarkPrintCompleted,
  onMarkPrintIncomplete,
  onRemoveQueuedProject,
  onDeleteProject,
  onAuthorSearch,
  onTagSearch
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <article className="projectCard compactCard">
      <div className="projectThumbWrap">
        <button className="projectThumbButton" onClick={() => onProjectChange(project.id)}>
          <img
            src={project.coverSrc || project.coverUrl}
            alt={project.title}
            loading="lazy"
            decoding="async"
          />
          <div className="projectThumbOverlay">
            <span className="projectOverlayChip">{project.repoLabel}</span>
            <span className="projectOverlayChip">{project.instanceItems?.length || 0} 个配置</span>
          </div>
        </button>

        <div className="projectMenu" ref={menuRef}>
          <button
            className="projectMenuButton"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="打开项目菜单"
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="projectMenuDropdown">
              <button
                className="projectMenuItem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenPath(project.projectPath);
                }}
              >
                打开目录
              </button>
              <button
                className="projectMenuItem"
                onClick={() => {
                  setMenuOpen(false);
                  onMoveProject(project);
                }}
              >
                移动项目
              </button>
              <button
                className="projectMenuItem"
                onClick={() => {
                  setMenuOpen(false);
                  onEditProjectTags(project);
                }}
              >
                编辑标签
              </button>
              <button
                className="projectMenuItem"
                onClick={() => {
                  setMenuOpen(false);
                  onQueueProject(project);
                }}
              >
                {project.queueEntry ? "更新队列状态" : "加入打印队列"}
              </button>
              {project.queueEntry ? (
                <button
                  className="projectMenuItem"
                  onClick={() => {
                    setMenuOpen(false);
                    if (project.printCompleted) {
                      onMarkPrintIncomplete(project);
                    } else {
                      onMarkPrintCompleted(project);
                    }
                  }}
                >
                  {project.printCompleted ? "标记未打印完成" : "标记打印完成"}
                </button>
              ) : null}
              {project.queueEntry ? (
                <button
                  className="projectMenuItem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveQueuedProject(project);
                  }}
                >
                  移出打印队列
                </button>
              ) : null}
              <button
                className="projectMenuItem"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteProject(project);
                }}
              >
                删除项目
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="projectBody">
        <div className="projectHeading">
          <button className="projectTitleButton" onClick={() => onProjectChange(project.id)}>
            {project.title}
          </button>
          <div className="projectHeadingMeta">
            <button className="projectAuthorButton" onClick={() => onAuthorSearch(project.author)}>
              {project.author}
            </button>
            <div className="projectStatusBadges">
              {project.queueEntry ? (
                <span className={`queueStageBadge ${project.queueStage}`}>{project.queueStageLabel}</span>
              ) : null}
              {project.printCompleted ? <span className="printCompleteBadge">已打印完成</span> : null}
            </div>
          </div>
        </div>
        <div className="projectChipRow">
          <span className="miniChip">ID {project.modelId || "-"}</span>
          <span className="miniChip">{project.tags?.length || 0} 标签</span>
          <span className="miniChip">{project.pictureItems?.length || 0} 图片</span>
        </div>
        <p className="projectExcerpt">{project.summaryText || "已保存本地资源，可进入详情页查看完整内容。"}</p>
        {project.tags?.length ? (
          <div className="projectTagRow">
            {project.tags.slice(0, 4).map((tag) => {
              const colors = getTagColor(tag);
              return (
                <span
                  key={tag}
                  className="projectTag"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text
                  }}
                >
                  <button
                    className="projectTagButton"
                    type="button"
                    onClick={() => onTagSearch(tag)}
                    style={{ color: colors.text }}
                  >
                    {tag}
                  </button>
                </span>
              );
            })}
            {project.tags.length > 4 ? <span className="projectTagMore">+{project.tags.length - 4}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ProjectListView({
  projects,
  totalProjectCount,
  currentPage,
  totalPages,
  selectedRepoId,
  queueProjectCount,
  sortKey,
  onProjectChange,
  onOpenPath,
  onMoveProject,
  onEditProjectTags,
  onQueueProject,
  onMarkPrintCompleted,
  onMarkPrintIncomplete,
  onRemoveQueuedProject,
  onDeleteProject,
  onAuthorSearch,
  onTagSearch,
  onPageChange,
  onSortChange
}) {
  const visiblePageItems = getVisiblePageItems(currentPage, totalPages);

  return (
    <section className="panel libraryPanel">
      <div className="panelHeader">
        <div>
          <h2>项目</h2>
          <p className="panelSubtle">
            {selectedRepoId === "all"
              ? "当前显示全部项目"
              : selectedRepoId === "queue"
                ? `当前显示打印队列中的 ${queueProjectCount} 个项目`
                : "当前显示选中仓库中的项目"}
          </p>
        </div>
        <div className="panelHeaderActions">
          <label className="sortControl">
            <span>排序</span>
            <select value={sortKey} onChange={(event) => onSortChange(event.target.value)}>
              <option value="added-desc">最近添加</option>
              <option value="added-asc">最早添加</option>
              <option value="updated-desc">最近更新</option>
              <option value="updated-asc">最早更新</option>
              <option value="title-asc">标题 A-Z</option>
              <option value="title-desc">标题 Z-A</option>
              <option value="author-asc">作者 A-Z</option>
              <option value="author-desc">作者 Z-A</option>
            </select>
          </label>
          <span className="panelHint">
            {totalProjectCount} 个结果 · 第 {currentPage} / {totalPages} 页
          </span>
        </div>
      </div>

      <div className="projectGrid compactGrid">
        {projects.length > 0 ? (
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onProjectChange={onProjectChange}
              onOpenPath={onOpenPath}
              onMoveProject={onMoveProject}
              onEditProjectTags={onEditProjectTags}
              onQueueProject={onQueueProject}
              onMarkPrintCompleted={onMarkPrintCompleted}
              onMarkPrintIncomplete={onMarkPrintIncomplete}
              onRemoveQueuedProject={onRemoveQueuedProject}
              onDeleteProject={onDeleteProject}
              onAuthorSearch={onAuthorSearch}
              onTagSearch={onTagSearch}
            />
          ))
        ) : (
          <div className="emptyState">
            {selectedRepoId === "queue" ? "打印队列还是空的，先把项目标记进来吧。" : "当前没有可展示的项目。"}
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="paginationBar">
          <div className="paginationSummary" aria-live="polite">
            <strong>第 {currentPage} 页</strong>
            <span>共 {totalPages} 页 · {totalProjectCount} 个项目</span>
          </div>
          <div className="paginationControls">
            <button
              className="paginationButton paginationEdgeButton"
              type="button"
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1}
            >
              首页
            </button>
            <button
              className="paginationButton paginationEdgeButton"
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              上一页
            </button>
            <div className="paginationPages" aria-label="项目列表分页">
              {visiblePageItems.map((item) =>
                typeof item === "string" ? (
                  <span key={item} className="paginationEllipsis" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    className={`paginationButton ${item === currentPage ? "active" : ""}`}
                    type="button"
                    aria-label={`第 ${item} 页`}
                    aria-current={item === currentPage ? "page" : undefined}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </button>
                )
              )}
            </div>
            <button
              className="paginationButton paginationEdgeButton"
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              下一页
            </button>
            <button
              className="paginationButton paginationEdgeButton"
              type="button"
              onClick={() => onPageChange(totalPages)}
              disabled={currentPage === totalPages}
            >
              末页
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RepoListItem({
  repo,
  index,
  selectedRepoId,
  onRepoChange,
  onProjectChange,
  onRenameRepo,
  onDeleteRepo
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const menuDropdownRef = useRef(null);
  const canManage = repo.id === selectedRepoId && repo.kind === "custom";
  let menuStyle = undefined;

  if (menuOpen && menuButtonRef.current && typeof window !== "undefined") {
    const rect = menuButtonRef.current.getBoundingClientRect();
    const menuWidth = 164;
    const menuHeight = 108;
    const viewportPadding = 12;
    const fitsBelow = rect.bottom + 8 + menuHeight <= window.innerHeight - viewportPadding;
    const top = fitsBelow
      ? rect.bottom + 8
      : Math.max(viewportPadding, rect.top - menuHeight - 8);
    const left = Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding);

    menuStyle = {
      top: `${top}px`,
      left: `${Math.max(viewportPadding, left)}px`
    };
  }

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      const clickedInsideButton = menuRef.current?.contains(event.target);
      const clickedInsideDropdown = menuDropdownRef.current?.contains(event.target);

      if (!clickedInsideButton && !clickedInsideDropdown) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <div
      className={`repoCard repoListItem ${repo.id === selectedRepoId ? "active" : ""} ${
        index === 0 ? "repoPinned" : ""
      }`}
    >
      <button
        className={`repoSelect ${canManage ? "repoSelectWithMenu" : ""}`}
        onClick={() => {
          onRepoChange(repo.id);
          onProjectChange(null);
        }}
      >
        <div className="repoTop">
          <div className="repoIdentity">
            <span className="repoDot" />
            <span className="repoName">{repo.name}</span>
          </div>
          <span className={`repoBadge ${repo.kind}`}>{getRepoBadge(repo.kind)}</span>
        </div>
        <div className="repoMeta">{repo.projectCount} 个项目</div>
      </button>

      {canManage ? (
        <div className="repoMenu" ref={menuRef}>
          <button
            className="repoMenuButton"
            type="button"
            aria-label="打开仓库菜单"
            ref={menuButtonRef}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <svg className="repoMenuIcon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen && menuStyle
            ? createPortal(
                <div className="repoMenuDropdown" style={menuStyle} ref={menuDropdownRef}>
              <button
                className="repoMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRenameRepo(repo);
                }}
              >
                重命名
              </button>
              <button
                className="repoMenuItem repoMenuItemDanger"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteRepo(repo);
                }}
                disabled={repo.projectCount > 0}
              >
                删除空仓库
              </button>
                </div>,
                document.body
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

function InstanceFileAction({ files, onOpenPath }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (!files?.length) {
    return null;
  }

  const arrowIcon = (
    <svg className="instanceArrowIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.5 10 8l-5 4.5" />
    </svg>
  );

  if (files.length === 1) {
    return (
      <div className="instanceFileAction">
        <button
          className="instanceArrowButton"
          onClick={() => onOpenPath(files[0].path)}
          aria-label="用 Bambu Studio 打开"
          title="用 Bambu Studio 打开"
        >
          {arrowIcon}
        </button>
      </div>
    );
  }

  return (
    <div className="instanceFileAction" ref={menuRef}>
      <button
        className="instanceArrowButton"
        onClick={() => setMenuOpen((current) => !current)}
        aria-label="选择文件打开"
        title="选择文件打开"
      >
        {arrowIcon}
      </button>
      {menuOpen ? (
        <div className="instanceFileDropdown">
          {files.map((file) => (
            <button
              key={file.path}
              className="instanceFileItem"
              onClick={() => {
                setMenuOpen(false);
                onOpenPath(file.path);
              }}
            >
              {file.fileName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectDetailView({
  selectedProject,
  onBack,
  backLabel = "返回项目列表",
  onOpenExternal,
  onOpenPath,
  onMoveProject,
  onEditProjectTags,
  onQueueProject,
  onMarkPrintCompleted,
  onMarkPrintIncomplete,
  onRemoveQueuedProject,
  onRefreshProject,
  onDeleteProject
}) {
  const detailPictures = selectedProject.pictureItems || [];
  const [detailPictureIndex, setDetailPictureIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openInstancePreviewId, setOpenInstancePreviewId] = useState(null);
  const menuRef = useRef(null);
  const instancePreviewRef = useRef(null);
  const thumbStripRef = useRef(null);
  const thumbButtonRefs = useRef([]);
  const carouselArrowIcon = (
    <svg className="detailCarouselArrowIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.5 10 8l-5 4.5" />
    </svg>
  );

  useEffect(() => {
    setDetailPictureIndex(0);
  }, [selectedProject.id]);

  useEffect(() => {
    setMenuOpen(false);
    setOpenInstancePreviewId(null);
  }, [selectedProject.id]);

  useEffect(() => {
    if (openInstancePreviewId == null) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!instancePreviewRef.current?.contains(event.target)) {
        setOpenInstancePreviewId(null);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpenInstancePreviewId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openInstancePreviewId]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const strip = thumbStripRef.current;
    const activeThumb = thumbButtonRefs.current[detailPictureIndex];

    if (!strip || !activeThumb) {
      return;
    }

    const stripLeft = strip.scrollLeft;
    const stripRight = stripLeft + strip.clientWidth;
    const thumbLeft = activeThumb.offsetLeft;
    const thumbRight = thumbLeft + activeThumb.offsetWidth;

    if (thumbLeft < stripLeft || thumbRight > stripRight) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    }
  }, [detailPictureIndex, detailPictures.length]);

  const activeDetailPicture = detailPictures[detailPictureIndex] || null;
  const documentItems = selectedProject.documentItems || [];
  const materialSections = selectedProject.materialSections || [];
  const customization = selectedProject.customization || null;
  const customizationOptions = Array.isArray(customization?.options)
    ? customization.options
    : [];
  const visibleCustomizationOptions = customizationOptions.length > 0
    ? customizationOptions
    : customization?.available
      ? [
          {
            id: "project-customization",
            name: "MakerWorld 参数定制",
            type: "在原项目中选择定制方案",
            thumbnailUrl: "",
            customizeUrl: selectedProject.sourceUrl
          }
        ]
      : [];
  const hasCustomization = visibleCustomizationOptions.length > 0;
  const hasDocuments = documentItems.length > 0;
  const hasMaterials = materialSections.length > 0;

  return (
    <section className="panel detailPanel fullDetailPanel">
      <div className="detailTopbar">
        <button className="ghostButton backButton" onClick={onBack}>
          {backLabel}
        </button>
        <div className="detailMenu" ref={menuRef}>
          <button
            className="detailMenuButton"
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="打开项目菜单"
          >
            <svg className="detailMenuIcon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="detailMenuDropdown">
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRefreshProject(selectedProject);
                }}
              >
                刷新项目
              </button>
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenExternal(selectedProject.sourceUrl);
                }}
                disabled={!selectedProject.sourceUrl}
              >
                打开原网页
              </button>
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenPath(selectedProject.projectPath);
                }}
              >
                打开项目目录
              </button>
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMoveProject(selectedProject);
                }}
              >
                移动到仓库
              </button>
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEditProjectTags(selectedProject);
                }}
              >
                编辑标签
              </button>
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onQueueProject(selectedProject);
                }}
              >
                {selectedProject.queueEntry ? "更新队列状态" : "加入打印队列"}
              </button>
              {selectedProject.queueEntry ? (
                <button
                  className="detailMenuItem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (selectedProject.printCompleted) {
                      onMarkPrintIncomplete(selectedProject);
                    } else {
                      onMarkPrintCompleted(selectedProject);
                    }
                  }}
                >
                  {selectedProject.printCompleted ? "标记未打印完成" : "标记打印完成"}
                </button>
              ) : null}
              {selectedProject.queueEntry ? (
                <button
                  className="detailMenuItem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveQueuedProject(selectedProject);
                  }}
                >
                  移出打印队列
                </button>
              ) : null}
              <button
                className="detailMenuItem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteProject(selectedProject);
                }}
              >
                删除项目
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="detailHeadline detailPageHeadline">
        <h2>{selectedProject.title}</h2>
        <div className="detailHeadlineMeta">
          <p className="subtle">{selectedProject.author}</p>
          <div className="projectStatusBadges">
            {selectedProject.queueEntry ? (
              <span className={`queueStageBadge ${selectedProject.queueStage}`}>
                {selectedProject.queueStageLabel}
              </span>
            ) : null}
            {selectedProject.printCompleted ? <span className="printCompleteBadge">已打印完成</span> : null}
          </div>
        </div>
      </div>

      <div className="detailHero">
        <div className="detailMediaColumn">
          {detailPictures.length > 0 ? (
            <section className="detailGalleryCard">
              <div className="panelHeader detailGalleryHeader">
                <h3>详情图片</h3>
                <span className="panelHint">
                  {detailPictureIndex + 1} / {detailPictures.length}
                </span>
              </div>
              <div className="detailCarousel">
                <div className="detailCarouselStage">
                  <img
                    className="detailCarouselImage"
                    src={activeDetailPicture?.src}
                    alt={activeDetailPicture?.fileName || "详情图片"}
                    loading="eager"
                    decoding="sync"
                  />
                  <button
                    className="detailCarouselNav prev"
                    type="button"
                    onClick={() =>
                      setDetailPictureIndex((current) =>
                        current === 0 ? detailPictures.length - 1 : current - 1
                      )
                    }
                    aria-label="Previous image"
                  >
                    {carouselArrowIcon}
                  </button>
                  <button
                    className="detailCarouselNav next"
                    type="button"
                    onClick={() =>
                      setDetailPictureIndex((current) =>
                        current === detailPictures.length - 1 ? 0 : current + 1
                      )
                    }
                    aria-label="Next image"
                  >
                    {carouselArrowIcon}
                  </button>
                </div>
              </div>
              {detailPictures.length > 1 ? (
                <div className="detailCarouselThumbs" ref={thumbStripRef}>
                  {detailPictures.map((picture, index) => (
                    <button
                      key={picture.path}
                      className={`detailCarouselThumb ${index === detailPictureIndex ? "active" : ""}`}
                      type="button"
                      ref={(element) => {
                        thumbButtonRefs.current[index] = element;
                      }}
                      onClick={() => setDetailPictureIndex(index)}
                    >
                      <img src={picture.src} alt={picture.fileName} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            <div className="emptyState">当前项目没有本地详情图片。</div>
          )}
        </div>
        <div className="detailSide">
          <div className="instancePanel">
            <div className="panelHeader">
              <h3>打印配置 <span className="panelCount">{selectedProject.instanceItems?.length || 0}</span></h3>
            </div>
            <div className="instanceList">
              {(selectedProject.instanceItems || []).map((instance) => (
                <article
                  key={instance.id}
                  className="instanceCard"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const targetPath = instance.filesDirectoryPath || instance.modelFiles?.[0]?.path;
                    if (targetPath) {
                      window.desktopAPI?.showInstanceContextMenu?.(targetPath);
                    }
                  }}
                >
                  <div
                    className="instanceCoverWrap"
                    ref={openInstancePreviewId === instance.id ? instancePreviewRef : null}
                  >
                    <button
                      className="instanceCoverButton"
                      type="button"
                      aria-label={`查看 ${instance.title} 的打印详情`}
                      aria-expanded={openInstancePreviewId === instance.id}
                      onClick={() =>
                        setOpenInstancePreviewId((current) => current === instance.id ? null : instance.id)
                      }
                    >
                      <img
                        className="instanceCover"
                        src={instance.coverSrc || selectedProject.coverSrc || selectedProject.coverUrl}
                        alt={instance.title}
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                    {openInstancePreviewId === instance.id ? (
                      <div className="platePreviewPopover coverPlatePreview open">
                        <div className="instancePreviewHeader">
                          <div>
                            <div className="instancePreviewTitle">{instance.title}</div>
                            {instance.creator?.name ? (
                              <div className="instancePreviewCreator">{instance.creator.name}</div>
                            ) : null}
                          </div>
                          {instance.isDesigner ? <span className="designerBadge">设计师</span> : null}
                        </div>
                        {instance.summaryText ? (
                          <div className="instancePreviewDescription">
                            <div className="instancePreviewSectionLabel">配置说明</div>
                            <div className="instancePreviewSummary">{instance.summaryText}</div>
                          </div>
                        ) : null}
                        <div className="instancePreviewStats">
                          <span><b>{instance.plateCount || instance.plateItems?.length || 0}</b> 盘</span>
                          <span><b>{formatPrintDuration(instance.predictionSeconds)}</b></span>
                          <span><b>{instance.nozzleDiameter ? `${instance.nozzleDiameter} mm` : "-"}</b> 喷嘴</span>
                          <span><b>{formatPrintWeight(instance.weightGrams)}</b></span>
                        </div>
                        {instance.printSettings?.layerHeight ||
                        instance.printSettings?.wallLoops ||
                        instance.printSettings?.sparseInfillDensity ? (
                          <div className="instancePrintSettings">
                            {instance.printSettings.layerHeight ? <span>层高 {instance.printSettings.layerHeight} mm</span> : null}
                            {instance.printSettings.wallLoops ? <span>墙数 {instance.printSettings.wallLoops}</span> : null}
                            {instance.printSettings.sparseInfillDensity ? <span>填充 {instance.printSettings.sparseInfillDensity}</span> : null}
                          </div>
                        ) : null}
                        {instance.filaments?.length > 0 ? (
                          <div className="instanceFilaments">
                            {instance.filaments.map((filament, index) => (
                              <span className="filamentChip" key={`${filament.type}-${filament.color}-${index}`}>
                                <i style={{ backgroundColor: getFilamentColor(filament.color) }} />
                                {filament.type || "耗材"}{filament.usedGrams ? ` ${filament.usedGrams} g` : ""}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {instance.plateItems?.length > 0 ? (
                          <>
                            <div className="platePreviewTitle">Plate 缩略图</div>
                            <div className="platePreviewGrid">
                              {instance.plateItems.slice(0, 6).map((plate) => (
                                <img
                                  key={plate.path}
                                  src={plate.src}
                                  alt={plate.fileName}
                                  loading="lazy"
                                  decoding="async"
                                />
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="instanceBody">
                    <div className="instanceTopline">
                      <div className="instanceInfo">
                        <div className="instanceTitle">{instance.title}</div>
                        <div className="instanceQuickFacts">
                          {instance.isDesigner ? <span className="designerBadge">设计师</span> : null}
                          <span title="打印时间">
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="10" cy="10" r="7" />
                              <path d="M10 6v4l2.7 1.7" />
                            </svg>
                            {formatPrintDuration(instance.predictionSeconds)}
                          </span>
                          <span title="打印盘数">
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <rect x="4" y="3.5" width="12" height="13" rx="1.5" />
                              <path d="M9 4v12" />
                            </svg>
                            {instance.plateCount || instance.plateItems?.length || 0} 盘
                          </span>
                          <span className="instanceRating" title="评分">
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="m10 2.8 2.1 4.3 4.8.7-3.5 3.4.8 4.8-4.2-2.3L5.8 16l.8-4.8-3.5-3.4 4.8-.7L10 2.8Z" />
                            </svg>
                            {formatInstanceRating(instance)}
                            {instance.ratingCount > 0 ? <small>({instance.ratingCount})</small> : null}
                          </span>
                        </div>
                      </div>
                      <InstanceFileAction files={instance.modelFiles} onOpenPath={onOpenPath} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>

      {hasCustomization ? (
        <section className="detailSection detailCompactSection">
          <div className="panelHeader">
            <h3>
              参数定制
              {customization?.count != null ? (
                <span className="panelCount">{customization.count}</span>
              ) : null}
            </h3>
          </div>
          <div className="customizationOptionList">
            {visibleCustomizationOptions.map((option, index) => {
              const targetUrl = option.customizeUrl || selectedProject.sourceUrl;
              return (
                <button
                  key={`${option.id || option.unikey || option.name}-${index}`}
                  className="customizationOptionCard"
                  type="button"
                  onClick={() => targetUrl && onOpenExternal(targetUrl)}
                  disabled={!targetUrl}
                >
                  {option.thumbnailUrl ? (
                    <img
                      className="customizationOptionImage"
                      src={option.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="customizationOptionIcon" aria-hidden="true">&lt;/&gt;</span>
                  )}
                  <span className="customizationOptionBody">
                    <span className="customizationOptionName">{option.name || option.modelName}</span>
                    <span className="customizationOptionType">{option.type || "参数化模型"}</span>
                  </span>
                  <span className="customizationOptionAction">打开定制</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasDocuments ? (
        <section className="detailSection detailCompactSection">
          <div className="panelHeader">
            <h3>文档</h3>
          </div>
          <div className="detailDocumentList">
            {documentItems.map((documentItem) => (
              <button
                key={`${documentItem.title}-${documentItem.path || documentItem.sourceUrl}`}
                className="detailDocumentItem"
                type="button"
                onClick={() =>
                  documentItem.path
                    ? onOpenPath(documentItem.path)
                    : documentItem.sourceUrl
                      ? onOpenExternal(documentItem.sourceUrl)
                      : undefined
                }
                disabled={!documentItem.path && !documentItem.sourceUrl}
              >
                <span className="detailDocumentTitle">{documentItem.title}</span>
                <span className="detailDocumentMeta">
                  {documentItem.fileName || (documentItem.sourceUrl ? "在线文档" : "无可用文件")}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {hasMaterials ? (
        <section className="detailSection detailCompactSection">
          <div className="panelHeader">
            <h3>物料清单</h3>
          </div>
          <div className="materialSectionList">
            {materialSections.map((section) => (
              <article key={section.title} className="materialSectionCard">
                {!/^boms_of_filaments$/i.test(section.title || "") ? <h4>{section.title}</h4> : null}
                <div className="materialItemList">
                  {section.items.map((item) => (
                    <div key={`${item.name}-${item.sku}-${item.url}`} className="materialItem">
                      <div className="materialItemMain">
                        <div className="materialItemName">{item.name}</div>
                        <div className="materialItemMeta">
                          {item.sku ? <span className="miniChip">{item.sku}</span> : null}
                          {item.quantity != null ? <span className="miniChip">x {item.quantity}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="detailSection">
        <div className="panelHeader">
          <h3>项目描述</h3>
        </div>
        <div className="detailSummary" dangerouslySetInnerHTML={{ __html: getSafeHtml(selectedProject) }} />
      </section>
    </section>
  );
}

export function LibraryPage({
  repositories,
  projects,
  totalProjectCount,
  queueProjectCount,
  currentPage,
  totalPages,
  selectedRepoId,
  selectedProject,
  rootPath,
  searchText,
  sortKey,
  status,
  isProjectWindow = false,
  canPickRoot = true,
  onPickRoot,
  onImport3mf,
  onRefresh,
  onRepoChange,
  onProjectChange,
  onCloseProjectWindow,
  onPageChange,
  onSearchChange,
  onSortChange,
  onOpenExternal,
  onOpenPath,
  onCreateRepo,
  onRenameRepo,
  onDeleteRepo,
  onMoveProject,
  onEditProjectTags,
  onQueueProject,
  onMarkPrintCompleted,
  onMarkPrintIncomplete,
  onRemoveQueuedProject,
  onRefreshProject,
  onDeleteProject
}) {
  const isDetailMode = Boolean(selectedProject);
  const detailView = isDetailMode ? (
    <ProjectDetailView
      selectedProject={selectedProject}
      onBack={isProjectWindow ? onCloseProjectWindow : () => onProjectChange(null)}
      backLabel={isProjectWindow ? "关闭详情窗口" : "返回项目列表"}
      onOpenExternal={onOpenExternal}
      onOpenPath={onOpenPath}
      onMoveProject={onMoveProject}
      onEditProjectTags={onEditProjectTags}
      onQueueProject={onQueueProject}
      onMarkPrintCompleted={onMarkPrintCompleted}
      onMarkPrintIncomplete={onMarkPrintIncomplete}
      onRemoveQueuedProject={onRemoveQueuedProject}
      onRefreshProject={onRefreshProject}
      onDeleteProject={onDeleteProject}
    />
  ) : null;

  if (isProjectWindow) {
    const projectOpenFailed = /(失败|无法|缺少|不存在|移动|删除)/.test(status);

    return (
      <main className="shell projectWindowShell">
        {detailView || (
          <section className="panel projectWindowLoading">
            <h2>{projectOpenFailed ? "无法打开项目" : "正在打开项目"}</h2>
            <p className="subtle">{status}</p>
            <button className="ghostButton" type="button" onClick={onCloseProjectWindow}>
              关闭窗口
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="heroTopbar">
          <div>
            <p className="eyebrow">MakerWorld Helper CN Desktop</p>
            <h1>本地资源库客户端</h1>
            <p className="subtle">首页浏览仓库和项目，点击卡片在独立窗口中查看详情。</p>
          </div>
          <div className="heroToolbar">
            <div className="searchBar">
              <label htmlFor="search">搜索项目</label>
              <div className="searchInputWrap">
                <input
                  id="search"
                  value={searchText}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="标题、作者、标签、模型 ID"
                />
                {searchText ? (
                  <button
                    className="searchClearButton"
                    type="button"
                    onClick={() => onSearchChange("")}
                    aria-label="清除搜索内容"
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
            <div className="heroButtons">
              <button
                className="secondaryButton"
                onClick={onPickRoot}
                disabled={!canPickRoot}
                title={canPickRoot ? "选择本地资源库根目录" : "浏览器模式不支持选择根目录，请使用桌面端"}
              >
                选择根目录
              </button>
              <button className="primaryButton" onClick={onCreateRepo} disabled={!rootPath}>
                创建仓库
              </button>
              <button className="secondaryButton" onClick={onImport3mf} disabled={!rootPath}>
                导入 3MF
              </button>
              <button className="secondaryButton" onClick={onRefresh} disabled={!rootPath}>
                重新扫描
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel sidebar">
          <div className="panelHeader">
            <h2>仓库</h2>
          </div>
          <div className="repoRootCard">
            <div className="repoRootLabel">资源库路径</div>
            <button
              className="repoRootPath"
              onClick={() => rootPath && onOpenPath(rootPath)}
              disabled={!rootPath}
              title={rootPath || "尚未选择根目录"}
            >
              {rootPath || "尚未选择根目录"}
            </button>
            <div className="repoRootHint">{status}</div>
          </div>
          <div className="repoList">
            {repositories.length > 0 ? (
              repositories.map((repo, index) => (
                <RepoListItem
                  key={repo.id}
                  repo={repo}
                  index={index}
                  selectedRepoId={selectedRepoId}
                  onRepoChange={onRepoChange}
                  onProjectChange={onProjectChange}
                  onRenameRepo={onRenameRepo}
                  onDeleteRepo={onDeleteRepo}
                />
              ))
            ) : (
              <div className="emptyState">请选择根目录后开始扫描。</div>
            )}
          </div>
        </aside>

        <section className="content singleContent">
          {isDetailMode ? (
            detailView
          ) : (
            <ProjectListView
              projects={projects}
              totalProjectCount={totalProjectCount}
              queueProjectCount={queueProjectCount}
              currentPage={currentPage}
              totalPages={totalPages}
              selectedRepoId={selectedRepoId}
              sortKey={sortKey}
              onProjectChange={onProjectChange}
              onOpenPath={onOpenPath}
              onMoveProject={onMoveProject}
              onEditProjectTags={onEditProjectTags}
              onQueueProject={onQueueProject}
              onMarkPrintCompleted={onMarkPrintCompleted}
              onMarkPrintIncomplete={onMarkPrintIncomplete}
              onRemoveQueuedProject={onRemoveQueuedProject}
              onDeleteProject={onDeleteProject}
              onAuthorSearch={onSearchChange}
              onTagSearch={onSearchChange}
              onPageChange={onPageChange}
              onSortChange={onSortChange}
            />
          )}
        </section>
      </section>
    </main>
  );
}
