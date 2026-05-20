import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

function getVisiblePageNumbers(currentPage, totalPages) {
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);
  const pages = [];

  for (let page = Math.max(1, endPage - 4); page <= endPage; page += 1) {
    pages.push(page);
  }

  return pages;
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
            {project.queueEntry ? (
              <span className={`queueStageBadge ${project.queueStage}`}>{project.queueStageLabel}</span>
            ) : null}
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
  onRemoveQueuedProject,
  onDeleteProject,
  onAuthorSearch,
  onTagSearch,
  onPageChange,
  onSortChange
}) {
  const visiblePages = getVisiblePageNumbers(currentPage, totalPages);

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
          <button
            className="paginationButton"
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            上一页
          </button>
          <div className="paginationPages">
            {visiblePages.map((pageNumber) => (
              <button
                key={pageNumber}
                className={`paginationButton ${pageNumber === currentPage ? "active" : ""}`}
                type="button"
                onClick={() => onPageChange(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
          </div>
          <button
            className="paginationButton"
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            下一页
          </button>
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
  onOpenExternal,
  onOpenPath,
  onMoveProject,
  onEditProjectTags,
  onQueueProject,
  onRemoveQueuedProject,
  onRefreshProject,
  onDeleteProject
}) {
  const detailPictures = selectedProject.pictureItems || [];
  const [detailPictureIndex, setDetailPictureIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
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
  }, [selectedProject.id]);

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
  const hasDocuments = documentItems.length > 0;
  const hasMaterials = materialSections.length > 0;

  return (
    <section className="panel detailPanel fullDetailPanel">
      <div className="detailTopbar">
        <button className="ghostButton backButton" onClick={onBack}>
          返回项目列表
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
          {selectedProject.queueEntry ? (
            <span className={`queueStageBadge ${selectedProject.queueStage}`}>
              {selectedProject.queueStageLabel}
            </span>
          ) : null}
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
                  <div className="instanceCoverWrap">
                    <img
                      className="instanceCover"
                      src={instance.coverSrc || selectedProject.coverSrc || selectedProject.coverUrl}
                      alt={instance.title}
                      loading="lazy"
                      decoding="async"
                    />
                    {instance.plateItems?.length > 0 ? (
                      <div className="platePreviewPopover coverPlatePreview">
                        <div className="platePreviewTitle">Plate 缩略图</div>
                        <div className="platePreviewGrid">
                          {instance.plateItems.slice(0, 3).map((plate) => (
                            <img
                              key={plate.path}
                              src={plate.src}
                              alt={plate.fileName}
                              loading="lazy"
                              decoding="async"
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="instanceBody">
                    <div className="instanceTopline">
                      <div className="instanceInfo">
                        <div className="instanceTitle">{instance.title}</div>
                        <div className="projectMeta" title={instance.machine}>
                          {instance.machine}
                        </div>
                      </div>
                      <InstanceFileAction files={instance.modelFiles} onOpenPath={onOpenPath} />
                    </div>
                    <div className="instanceMeta">
                      <span className="miniChip">耗材 {instance.materialCount}</span>
                      <span className="miniChip">下载 {instance.downloadCount}</span>
                      <span className="miniChip">Plate {instance.plateItems?.length || 0}</span>
                      <span className="miniChip">文件 {instance.modelFiles?.length || 0}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>

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
  canPickRoot = true,
  onPickRoot,
  onImport3mf,
  onRefresh,
  onRepoChange,
  onProjectChange,
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
  onRemoveQueuedProject,
  onRefreshProject,
  onDeleteProject
}) {
  const isDetailMode = Boolean(selectedProject);

  return (
    <main className="shell">
      <header className="hero">
        <div className="heroTopbar">
          <div>
            <p className="eyebrow">MakerWorld Helper CN Desktop</p>
            <h1>本地资源库客户端</h1>
            <p className="subtle">首页浏览仓库和项目，点击卡片进入项目详情页。</p>
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
            <ProjectDetailView
              selectedProject={selectedProject}
              onBack={() => onProjectChange(null)}
              onOpenExternal={onOpenExternal}
              onOpenPath={onOpenPath}
              onMoveProject={onMoveProject}
              onEditProjectTags={onEditProjectTags}
              onQueueProject={onQueueProject}
              onRemoveQueuedProject={onRemoveQueuedProject}
              onRefreshProject={onRefreshProject}
              onDeleteProject={onDeleteProject}
            />
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
