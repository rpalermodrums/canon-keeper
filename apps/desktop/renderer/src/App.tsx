import type { JSX } from "react";
import { Play, RefreshCw } from "lucide-react";
import { AsyncToast } from "./components/AsyncToast";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmModal } from "./components/ConfirmModal";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { InlineError } from "./components/InlineError";
import { Sidebar } from "./components/Sidebar";
import { StatusBadge } from "./components/StatusBadge";
import { TopBar } from "./components/TopBar";
import { useTheme } from "./context/ThemeContext";
import { APP_SECTIONS, type AppSection, useCanonkeeperApp } from "./state/useCanonkeeperApp";
import { BibleView } from "./views/BibleView";
import { DashboardView } from "./views/DashboardView";
import { ExportView } from "./views/ExportView";
import { IssuesView } from "./views/IssuesView";
import { ScenesView } from "./views/ScenesView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { SetupView } from "./views/SetupView";
import { StyleView } from "./views/StyleView";

const mobileSections: AppSection[] = ["dashboard", "setup", "search", "scenes", "issues", "bible"];

function formatLastSuccess(ts: string | null | undefined): string {
  if (!ts) {
    return "Never";
  }
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return ts;
  }
  return date.toLocaleString();
}

function sourceLabel(source: string, sourceId: string): string {
  const sourceName =
    source === "issue"
      ? "Continuity Question"
      : source === "scene"
        ? "Scene"
        : source === "claim"
          ? "Claim"
          : "Style Signal";
  return sourceId ? `${sourceName} · ${sourceId}` : sourceName;
}

export function App(): JSX.Element {
  const app = useCanonkeeperApp();
  const { theme, setTheme } = useTheme();
  const isMobile = app.layoutMode === "mobile";

  const commandItems = [
    ...APP_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      subtitle: section.subtitle,
      icon: section.icon,
      category: "Navigate",
      enabled: true
    })),
    {
      id: "run.diagnostics",
      label: "Run Diagnostics",
      subtitle: "Check IPC, worker, sqlite, and writable state",
      icon: RefreshCw,
      category: "Project",
      enabled: true
    },
    {
      id: "jump.issue",
      label: "Resume Last Issue",
      subtitle: "Return to last selected issue",
      icon: Play,
      category: "Resume",
      enabled: Boolean(app.continueContext.issueId),
      disabledReason: "No recent issue yet"
    },
    {
      id: "jump.entity",
      label: "Resume Last Entity",
      subtitle: "Return to last selected entity",
      icon: Play,
      category: "Resume",
      enabled: Boolean(app.continueContext.entityId),
      disabledReason: "No recent entity yet"
    },
    {
      id: "jump.scene",
      label: "Resume Last Scene",
      subtitle: "Return to last selected scene",
      icon: Play,
      category: "Resume",
      enabled: Boolean(app.continueContext.sceneId),
      disabledReason: "No recent scene yet"
    }
  ];

  const hasProject = Boolean(app.project);
  const hasDocuments = Boolean(app.lastIngest) || app.processingState.length > 0;

  return (
    <div className="flex min-h-screen">
      {!isMobile ? (
        <Sidebar
          activeSection={app.activeSection}
          onSectionChange={app.setActiveSection}
          collapsed={app.layoutMode === "tablet" ? true : app.sidebarCollapsed}
          onCollapsedChange={app.setSidebarCollapsed}
        />
      ) : null}

      {isMobile && app.mobileNavOpen ? (
        <div className="fixed inset-0 z-50 bg-black/35 md:hidden" onClick={() => app.setMobileNavOpen(false)}>
          <div className="h-full w-[280px] border-r border-border bg-surface-1" onClick={(event) => event.stopPropagation()}>
            <Sidebar
              activeSection={app.activeSection}
              onSectionChange={app.setActiveSection}
              collapsed={false}
              onCollapsedChange={() => {
                // no-op in mobile drawer
              }}
              showCollapseControl={false}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeSection={app.activeSection}
          projectName={app.project?.name ?? null}
          status={app.status}
          statusLabel={app.statusLabel}
          theme={theme}
          onThemeChange={setTheme}
          layoutMode={app.layoutMode}
          onToggleMobileNav={() => app.setMobileNavOpen((open) => !open)}
          onOpenCommandPalette={() => app.setCommandPaletteOpen(true)}
        />

        <div className="border-b border-border bg-surface-2/60 px-5 py-2 text-xs text-text-secondary">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={`phase:${app.status?.phase ?? "idle"}`} status={app.status?.phase ?? "down"} />
            <span>queue:{app.status?.queueDepth ?? 0}</span>
            {app.status?.activeJobLabel ? <span>job:{app.status.activeJobLabel}</span> : null}
            <span>last-success:{formatLastSuccess(app.status?.lastSuccessfulRunAt)}</span>
            {app.status?.lastError ? (
              <span className="rounded-sm border border-danger/25 bg-danger-soft px-2 py-0.5 text-danger">
                {app.status.lastError.subsystem}: {app.status.lastError.message}
              </span>
            ) : null}
          </div>
        </div>

        <main className={`flex flex-1 flex-col gap-4 ${isMobile ? "p-3 pb-20" : "p-6"}`}>
          {app.error ? <InlineError error={app.error} onDismiss={app.clearError} onAction={app.onRunDiagnostics} /> : null}

          <div className="animate-fade-in">
            {app.activeSection === "dashboard" ? (
              <DashboardView
                project={app.project}
                status={app.status}
                processingState={app.processingState}
                history={app.history}
                lastIngest={app.lastIngest}
                continueIssueId={app.continueContext.issueId}
                continueEntityId={app.continueContext.entityId}
                continueSceneId={app.continueContext.sceneId}
                onJumpToIssue={app.onJumpToIssue}
                onJumpToEntity={app.onJumpToEntity}
                onJumpToScene={app.onJumpToScene}
              />
            ) : null}

            {app.activeSection === "setup" ? (
              <SetupView
                busy={app.busy}
                rootPath={app.rootPath}
                docPath={app.docPath}
                healthCheck={app.healthCheck}
                hasProject={hasProject}
                hasDocuments={hasDocuments}
                onRootPathChange={app.setRootPath}
                onDocPathChange={app.setDocPath}
                onPickProjectRoot={app.onPickProjectRoot}
                onCreateProject={app.onCreateProject}
                onPickDocument={app.onPickDocument}
                onUseFixture={app.onUseFixture}
                onAddDocument={app.onAddDocument}
                onRunPreflight={app.onRunDiagnostics}
              />
            ) : null}

            {app.activeSection === "search" ? (
              <SearchView
                busy={app.busy}
                searchQuery={app.searchQuery}
                searchResults={app.searchResults}
                questionText={app.questionText}
                askResult={app.askResult}
                onSearchQueryChange={app.setSearchQuery}
                onQuestionTextChange={app.setQuestionText}
                onSearch={app.onSearch}
                onAsk={app.onAsk}
              />
            ) : null}

            {app.activeSection === "scenes" ? (
              <ScenesView
                busy={app.busy}
                scenes={app.scenes}
                selectedSceneId={app.selectedSceneId}
                sceneDetail={app.sceneDetail}
                query={app.sceneQuery}
                onQueryChange={app.setSceneQuery}
                onRefresh={() => void app.refreshScenes()}
                onSelectScene={(sceneId) => void app.onSelectScene(sceneId)}
                onOpenEvidence={(title, detail) => app.onOpenEvidenceFromScene(title, detail)}
              />
            ) : null}

            {app.activeSection === "issues" ? (
              <IssuesView
                busy={app.busy}
                issues={app.issues}
                selectedIssueId={app.selectedIssueId}
                filters={app.issueFilters}
                onFiltersChange={app.setIssueFilters}
                onRefresh={() => void app.refreshIssues()}
                onSelectIssue={app.onSelectIssue}
                onRequestDismiss={app.onRequestDismissIssue}
                onResolve={(issueId) => void app.onResolveIssue(issueId)}
                onOpenEvidence={(title, issue) => app.onOpenEvidenceFromIssue(title, issue)}
              />
            ) : null}

            {app.activeSection === "style" ? (
              <StyleView
                busy={app.busy}
                report={app.styleReport}
                styleIssues={app.styleIssues}
                onRefresh={() => void app.refreshStyle()}
                onOpenIssueEvidence={(title, issue) => app.onOpenEvidenceFromIssue(title, issue)}
                onOpenMetricEvidence={(title, evidence) =>
                  app.openEvidence(title, evidence, {
                    source: "style",
                    sourceId: title.toLowerCase().replace(/\s+/g, "-")
                  })
                }
              />
            ) : null}

            {app.activeSection === "bible" ? (
              <BibleView
                busy={app.busy}
                entities={app.entities}
                selectedEntityId={app.selectedEntityId}
                entityDetail={app.entityDetail}
                filters={app.entityFilters}
                onFiltersChange={app.setEntityFilters}
                onRefresh={() => void app.refreshEntities()}
                onSelectEntity={(entityId) => void app.onSelectEntity(entityId)}
                onOpenEvidence={(title, detail, context) => app.onOpenEvidenceFromClaim(title, detail, context)}
                onRequestConfirmClaim={app.setConfirmClaimDraft}
              />
            ) : null}

            {app.activeSection === "export" ? (
              <ExportView
                busy={app.busy}
                exportDir={app.exportDir}
                exportKind={app.exportKind}
                lastResult={app.lastExportResult}
                onExportDirChange={app.setExportDir}
                onExportKindChange={app.setExportKind}
                onPickExportDir={app.onPickExportDir}
                onRunExport={app.onRunExport}
              />
            ) : null}

            {app.activeSection === "settings" ? (
              <SettingsView
                status={app.status}
                healthCheck={app.healthCheck}
                onRunDiagnostics={app.onRunDiagnostics}
                theme={theme}
                onThemeChange={setTheme}
                sidebarCollapsed={app.sidebarCollapsed}
                onSidebarCollapsedChange={app.setSidebarCollapsed}
              />
            ) : null}
          </div>
        </main>
      </div>

      {isMobile ? (
        <nav className="fixed right-0 bottom-0 left-0 z-40 border-t border-border bg-surface-2/95 px-2 py-2 backdrop-blur md:hidden">
          <div className="flex items-center gap-1 overflow-x-auto">
            {mobileSections.map((sectionId) => {
              const section = APP_SECTIONS.find((item) => item.id === sectionId);
              if (!section) {
                return null;
              }
              const Icon = section.icon;
              const active = app.activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`inline-flex min-w-[78px] flex-col items-center gap-1 rounded-sm px-2 py-1 text-[11px] cursor-pointer ${
                    active ? "bg-accent-soft text-accent-strong dark:text-accent" : "text-text-muted"
                  }`}
                  onClick={() => app.setActiveSection(section.id)}
                >
                  <Icon size={14} />
                  <span>{section.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="inline-flex min-w-[78px] flex-col items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-muted cursor-pointer"
              onClick={() => app.setCommandPaletteOpen(true)}
            >
              <Play size={14} />
              <span>More</span>
            </button>
          </div>
        </nav>
      ) : null}

      <EvidenceDrawer
        open={app.evidenceDrawer.open}
        title={app.evidenceDrawer.title}
        sourceLabel={sourceLabel(app.evidenceDrawer.source, app.evidenceDrawer.sourceId)}
        evidence={app.evidenceDrawer.evidence}
        layoutMode={app.layoutMode}
        pinned={app.evidencePinned}
        onTogglePin={() => app.setEvidencePinned((current) => !current)}
        onClose={app.closeEvidence}
      />

      <CommandPalette
        open={app.commandPaletteOpen}
        items={commandItems}
        onSelect={app.onCommandSelect}
        onClose={() => app.setCommandPaletteOpen(false)}
      />

      <ConfirmModal
        open={Boolean(app.confirmClaimDraft)}
        title="Confirm Canon Claim"
        message="This creates a confirmed claim and supersedes inferred claims for the same field/value pair while preserving evidence links."
        confirmLabel="Confirm Claim"
        onCancel={() => app.setConfirmClaimDraft(null)}
        onConfirm={() => void app.onConfirmClaim()}
      >
        {app.confirmClaimDraft ? (
          <div className="rounded-sm border border-border bg-surface-1 p-2 font-mono text-sm">
            field={app.confirmClaimDraft.field}, evidence={app.confirmClaimDraft.evidenceCount}
          </div>
        ) : null}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(app.dismissIssueDraft)}
        title="Dismiss Issue"
        message="Enter a reason before dismissing. You can undo within the toast timeout."
        confirmLabel="Dismiss Issue"
        danger
        onCancel={() => app.setDismissIssueDraft(null)}
        onConfirm={() => void app.onConfirmDismissIssue()}
      >
        {app.dismissIssueDraft ? (
          <label className="flex flex-col gap-1 text-sm text-text-secondary">
            Reason
            <textarea
              value={app.dismissIssueDraft.reason}
              onChange={(event) =>
                app.setDismissIssueDraft((current) =>
                  current ? { ...current, reason: event.target.value } : current
                )
              }
              placeholder="Why is this issue being dismissed?"
            />
          </label>
        ) : null}
      </ConfirmModal>

      <AsyncToast toasts={app.toasts} onDismiss={app.dismissToast} />
    </div>
  );
}
