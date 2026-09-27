import { Archive, ArchiveRestore, Folder, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  addProject,
  archiveSession,
  deleteSession,
  fetchProjects,
  getToken,
  renameSession,
  setCurrentProject,
  type ProjectsResponse,
  type SessionMeta,
} from '@/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DirectoryBrowser } from '@/components/directory-browser'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

function relativeTime(value: number): string {
  const minutes = Math.round((Date.now() - value) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function Layout() {
  const { t } = useI18n()
  const app = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [showArchived, setShowArchived] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SessionMeta | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [addPath, setAddPath] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [browserOpen, setBrowserOpen] = useState(false)
  const [projectData, setProjectData] = useState<ProjectsResponse | null>(null)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectLoadError, setProjectLoadError] = useState(false)

  const needsLogin = app.info?.auth.required === true && getToken() === null
  const loadProjects = useCallback(() => {
    if (app.info === null || needsLogin) return
    fetchProjects()
      .then((data) => {
        setProjectData(data)
        setProjectLoadError(false)
      })
      .catch((cause: unknown) => {
        setProjectLoadError(true)
        toast.error(cause instanceof Error ? cause.message : String(cause))
      })
  }, [app.info, needsLogin])
  useEffect(loadProjects, [loadProjects])
  useEffect(() => {
    if (app.unauthorized) navigate('/auth/login')
  }, [app.unauthorized, navigate])
  if (needsLogin && location.pathname !== '/auth/login') return <Navigate to="/auth/login" replace />

  const visible = app.sessions.filter((session) => showArchived || !session.archived)

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      app.refreshInfo()
      app.refreshSessions()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function pickProject(): void {
    setBrowserOpen(true)
  }

  function onBrowserOpen(path: string): void {
    setBrowserOpen(false)
    setAddPath(path)
    setAddName(path.split(/[\\/]/).filter(Boolean).pop() ?? '')
  }

  async function submitAddProject(): Promise<void> {
    const path = (addPath ?? '').trim()
    if (path.length === 0) return
    const name = addName.trim()
    setAddPath(null)
    try {
      const updated = await addProject(path, name.length > 0 ? name : undefined)
      setProjectData(updated)
      app.clearSession()
      app.refreshInfo()
      app.refreshSessions()
      navigate('/')
      toast.success(t('projects.added'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function switchProject(id: string): Promise<void> {
    if (id === projectData?.current || projectBusy) return
    setProjectBusy(true)
    try {
      setProjectData(await setCurrentProject(id))
      app.clearSession()
      app.refreshInfo()
      app.refreshSessions()
      navigate('/')
      toast.success(t('projects.switched'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProjectBusy(false)
    }
  }

  function submitRename(): void {
    const target = renameTarget
    const title = renameValue.trim()
    if (!target || title.length === 0) return
    setRenameTarget(null)
    void run(() => renameSession(target.id, title))
  }

  function confirmDelete(): void {
    const id = deleteTarget
    if (!id) return
    setDeleteTarget(null)
    void run(async () => {
      await deleteSession(id)
      if (app.sessionId === id) app.clearSession()
    })
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                onClick={() => {
                  app.newChat()
                  navigate('/')
                }}
              >
                <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">R</div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">{t('app.name')}</span>
                  <span className="text-xs text-muted-foreground">{app.info?.model ?? t('header.noModel')}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => {
              app.newChat()
              navigate('/')
            }}
          >
            <Plus data-icon="inline-start" />
            {t('sidebar.new')}
          </Button>
          <Button variant="outline" size="sm" className="justify-start" onClick={() => void pickProject()}>
            <FolderPlus data-icon="inline-start" />
            {t('projects.add')}
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <div className="flex items-center justify-between pr-1">
              <SidebarGroupLabel>{t('settings.projects')}</SidebarGroupLabel>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={t('projects.add')}
                onClick={() => void pickProject()}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </div>
            <SidebarMenu>
              {projectLoadError ? (
                <Button variant="ghost" size="sm" className="h-auto justify-start px-2 py-2 text-xs text-destructive" onClick={loadProjects}>
                  {t('projects.loadFailed')} · {t('settings.reload')}
                </Button>
              ) : !projectData ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">{t('projects.loading')}</p>
              ) : projectData.projects.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">{t('projects.empty')}</p>
              ) : (
                projectData.projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={project.id === projectData.current}
                      disabled={projectBusy}
                      title={project.path}
                      onClick={() => void switchProject(project.id)}
                    >
                      <Folder />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{project.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{project.path}</span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <div className="flex items-center justify-between pr-1">
              <SidebarGroupLabel>{t('sidebar.sessions')}</SidebarGroupLabel>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={showArchived ? t('session.hideArchived') : t('session.showArchived')}
                onClick={() => setShowArchived((value) => !value)}
              >
                <Archive className="size-3.5" />
              </Button>
            </div>
            <SidebarMenu>
              {visible.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">{t('sidebar.empty')}</p>
              ) : (
                visible.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton
                      isActive={session.id === app.sessionId && location.pathname === '/'}
                      className={session.archived ? 'opacity-60' : undefined}
                      onClick={() => {
                        app.openSession(session.id)
                        navigate('/')
                      }}
                    >
                      <MessageSquare />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">
                          {session.title ?? t('sidebar.untitled')}
                          {session.archived ? ` · ${t('session.archived')}` : ''}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {relativeTime(session.createdAt)}
                        </span>
                      </span>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover title={t('session.actions')}>
                          <MoreHorizontal />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem
                          onClick={() => {
                            setRenameTarget(session)
                            setRenameValue(session.title ?? '')
                          }}
                        >
                          <Pencil />
                          {t('session.rename')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void run(() => archiveSession(session.id, !session.archived))}>
                          {session.archived ? <ArchiveRestore /> : <Archive />}
                          {session.archived ? t('session.unarchive') : t('session.archive')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(session.id)}>
                          <Trash2 />
                          {t('session.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/'}>
                <NavLink to="/">
                  <MessageSquare />
                  <span>{t('nav.chat')}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname.startsWith('/settings')}>
                <NavLink to="/settings/general">
                  <SettingsIcon />
                  <span>{t('nav.settings')}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="flex h-svh min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">
              {app.info?.project ? `${app.info.project.name} · ${app.info.workspace}` : (app.info?.workspace ?? '')}
            </span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {app.info ? `${t('header.tools', { count: app.info.tools.length })} · ${app.info.access.label}` : ''}
            </span>
          </div>
        </header>
        <Outlet />
      </SidebarInset>

      <AlertDialog open={app.approval !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('approval.title', { tool: app.approval?.toolName ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{app.approval?.reason}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => app.decide(false)}>{t('approval.deny')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => app.decide(true)}>{t('approval.approve')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('session.renameTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitRename()
            }}
            placeholder={t('session.titlePlaceholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitRename} disabled={renameValue.trim().length === 0}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DirectoryBrowser open={browserOpen} onOpen={onBrowserOpen} onClose={() => setBrowserOpen(false)} />

      <Dialog open={addPath !== null} onOpenChange={(open) => { if (!open) setAddPath(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={addPath ?? ''}
              onChange={(event) => setAddPath(event.target.value)}
              placeholder={t('projects.path')}
              className="font-mono text-xs"
            />
            <Input
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitAddProject()
              }}
              placeholder={t('projects.name')}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPath(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submitAddProject()} disabled={(addPath ?? '').trim().length === 0}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('session.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('session.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t('session.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
