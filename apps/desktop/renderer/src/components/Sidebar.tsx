import type { JSX } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { APP_SECTIONS, type AppSection } from "../state/useCanonkeeperApp";

type SidebarProps = {
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showCollapseControl?: boolean;
};

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
  showCollapseControl = true
}: SidebarProps): JSX.Element {
  return (
    <aside
      className={`flex flex-col border-r border-border bg-linear-to-b from-surface-2 to-surface-1 transition-all duration-200 ${
        collapsed ? "w-16 px-2 py-4" : "w-[260px] px-4 py-5"
      }`}
    >
      {/* Brand */}
      <div className={`mb-4 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        {collapsed ? (
          <span className="font-display text-lg font-bold text-accent">CK</span>
        ) : (
          <div>
            <h1 className="m-0 font-display text-xl font-bold tracking-wide">CanonKeeper</h1>
            <p className="m-0 text-xs text-text-muted">Editorial Workstation</p>
          </div>
        )}
        {showCollapseControl ? (
          <button
            className="rounded-sm border border-transparent bg-transparent p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1" aria-label="Primary navigation">
        {APP_SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`group relative flex items-center gap-2.5 rounded-sm border border-transparent px-3 py-2 text-left text-sm transition-all duration-100 cursor-pointer ${
                active
                  ? "border-accent/25 bg-accent-soft font-semibold text-accent-strong dark:text-accent"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text-primary dark:hover:bg-surface-2/50"
              } ${collapsed ? "justify-center px-0" : ""}`}
              onClick={() => onSectionChange(section.id)}
              title={collapsed ? section.label : undefined}
            >
              {active ? (
                <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent transition-transform duration-200" />
              ) : null}
              <Icon size={18} className={active ? "text-accent" : "text-text-muted group-hover:text-text-primary"} />
              {collapsed ? null : <span>{section.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className={`mt-auto flex flex-col gap-3 pt-4 ${collapsed ? "items-center" : ""}`}>
        {collapsed ? null : (
          <div className="rounded-md border border-border bg-white/40 p-2.5 text-xs text-text-muted dark:bg-surface-2/30">
            <p className="m-0 font-medium">Keyboard</p>
            <p className="m-0 mt-1">
              <kbd>Cmd</kbd>+<kbd>K</kbd> palette
            </p>
            <p className="m-0">
              <kbd>[</kbd>/<kbd>]</kbd> sections
            </p>
            <p className="m-0">
              <kbd>J</kbd>/<kbd>K</kbd> list nav
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
