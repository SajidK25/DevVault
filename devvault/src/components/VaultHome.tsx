import { useCallback, useEffect, useState } from "react";
import type { Project, SearchHit } from "../types";
import { listProjects } from "../lib/ipc";
import Sidebar from "./Sidebar";
import ProjectView from "./ProjectView";
import SearchModal from "./SearchModal";
import BackupsModal from "./BackupsModal";
import type { Theme } from "../hooks/useTheme";

interface VaultHomeProps {
  onLock: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function VaultHome({
  onLock,
  theme,
  onToggleTheme,
}: VaultHomeProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [jumpEntryId, setJumpEntryId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ps = await listProjects();
    setProjects(ps);
    setSelectedId((cur) => {
      if (cur && ps.some((p) => p.id === cur)) return cur;
      return ps[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // Global Cmd/Ctrl+K to open search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handlePick(hit: SearchHit) {
    setSelectedId(hit.project_id);
    if (hit.entry_id) setJumpEntryId(hit.entry_id);
    setSearchOpen(false);
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={refresh}
        onLock={onLock}
        onOpenBackups={() => setBackupsOpen(true)}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      {selected ? (
        <ProjectView
          key={selected.id}
          project={selected}
          openEntryId={jumpEntryId}
          onOpenConsumed={() => setJumpEntryId(null)}
          onProjectsChanged={refresh}
          onProjectDeleted={refresh}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          <p>Create or select a project to begin. Press ⌘/Ctrl+K to search.</p>
        </div>
      )}

      {searchOpen && (
        <SearchModal onClose={() => setSearchOpen(false)} onPick={handlePick} />
      )}

      {backupsOpen && (
        <BackupsModal
          onClose={() => setBackupsOpen(false)}
          onLocked={() => {
            setBackupsOpen(false);
            onLock();
          }}
        />
      )}
    </div>
  );
}
