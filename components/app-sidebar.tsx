"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type CSSProperties } from "react"
import {
  ArchiveIcon,
  ChevronUpIcon,
  CircleHelpIcon,
  LogOutIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react"

import { signOutAction } from "@/app/(auth)/actions"
import { ThemePreference } from "@/components/theme-preference"
import { ZenoteLogo } from "@/components/zenote-logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { mockConversations } from "@/lib/mock-chat"

type AppSidebarProps = {
  user: { name: string; email: string }
}

type SettingsSection = "general" | "appearance" | "help"

const settingsSections = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "help", label: "Help", icon: CircleHelpIcon },
] satisfies {
  id: SettingsSection
  label: string
  icon: typeof SettingsIcon
}[]

const settingsCopy: Record<
  SettingsSection,
  { title: string; description: string }
> = {
  general: {
    title: "General",
    description: "Your Zenote account and chat preferences.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose how the authenticated chat surface looks.",
  },
  help: {
    title: "Help",
    description: "Shortcuts and guidance for using Zenote chat.",
  },
}

function initials(name: string, email: string) {
  return (name.trim() || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { setOpenMobile, toggleSidebar } = useSidebar()
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general")

  function goToChat(id?: string) {
    router.push(id ? `/chat/${id}` : "/chat")
    setOpenMobile(false)
  }

  function openSettings() {
    setOpenMobile(false)
    setSettingsOpen(true)
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault()
        router.push("/chat")
        setOpenMobile(false)
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [router, setOpenMobile])

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-sidebar-border/70"
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3.75rem",
          } as CSSProperties
        }
      >
        <SidebarHeader className="gap-1.5 px-2 py-2.5">
          <div className="flex h-8 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Link
              href="/chat"
              className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              onClick={() => setOpenMobile(false)}
            >
              <ZenoteLogo className="size-5 text-[#f26a21]" />
              <span className="truncate text-sm font-semibold tracking-[-0.035em] group-data-[collapsible=icon]:hidden">
                Zenote
              </span>
            </Link>
            <button
              type="button"
              onClick={toggleSidebar}
              className="ml-auto rounded-md p-1.5 text-sidebar-foreground/60 transition-colors outline-none group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label="Collapse sidebar"
            >
              <PanelLeftCloseIcon className="size-4" />
            </button>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="New chat"
                onClick={() => goToChat()}
                className="font-medium"
              >
                <PlusIcon />
                <span className="group-data-[collapsible=icon]:hidden">
                  New chat
                </span>
                <kbd className="ml-auto text-[10px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
                  Ctrl N
                </kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Search chats"
                onClick={() => setSearchOpen(true)}
              >
                <SearchIcon />
                <span className="group-data-[collapsible=icon]:hidden">
                  Search
                </span>
                <kbd className="ml-auto text-[10px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
                  Ctrl K
                </kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pt-3 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="h-7 px-2">Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1 px-1">
                {mockConversations.map((conversation) => (
                  <SidebarMenuItem key={conversation.id} className="py-px">
                    <SidebarMenuButton
                      render={
                        <Link
                          href={`/chat/${conversation.id}`}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                      isActive={pathname === `/chat/${conversation.id}`}
                      className="h-9 px-2 pr-8 text-[13px]"
                    >
                      <span>{conversation.title}</span>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <SidebarMenuAction
                            showOnHover
                            aria-label={`Actions for ${conversation.title}`}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        className="w-40"
                      >
                        <DropdownMenuItem>
                          <PencilIcon /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <ArchiveIcon /> Archive
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive">
                          <Trash2Icon /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-0.5 px-2 py-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" onClick={openSettings}>
                <SettingsIcon />
                <span className="group-data-[collapsible=icon]:hidden">
                  Settings
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="mx-1 my-2 rounded-lg bg-sidebar-accent/55 px-2.5 py-2.5 group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium">Free plan</p>
            <Link
              href="/pricing"
              className="mt-1 block text-xs text-sidebar-foreground/55 hover:text-sidebar-foreground"
            >
              View plans
            </Link>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex h-11 w-full items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
              }
            >
              <Avatar size="sm">
                <AvatarFallback className="bg-primary/15 text-xs text-primary">
                  {initials(user.name, user.email)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span className="block truncate text-xs font-medium">
                  {user.name || "Zenote user"}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/50">
                  {user.email}
                </span>
              </span>
              <ChevronUpIcon className="size-3.5 text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block truncate text-foreground">
                    {user.name || "Zenote user"}
                  </span>
                  <span className="block truncate font-normal">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openSettings}>
                <SettingsIcon /> Settings
              </DropdownMenuItem>
              <form action={signOutAction}>
                <DropdownMenuItem
                  nativeButton
                  render={<button type="submit" className="w-full" />}
                >
                  <LogOutIcon /> Sign out
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search chats"
        description="Find a recent conversation"
      >
        <Command>
          <CommandInput placeholder="Search conversations..." autoFocus />
          <CommandList>
            <CommandEmpty>No chats found.</CommandEmpty>
            <CommandGroup heading="Recent chats">
              {mockConversations.map((conversation) => (
                <CommandItem
                  key={conversation.id}
                  value={conversation.title}
                  onSelect={() => goToChat(conversation.id)}
                >
                  <MessageSquareIcon />
                  <span className="truncate">{conversation.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {conversation.updatedAt}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="h-[min(42rem,calc(100svh-2rem))] w-[calc(100%-2rem)] max-w-none grid-cols-1 gap-0 overflow-hidden bg-[#111111] p-0 text-[#f2f2f2] ring-white/10 sm:max-w-[54rem] sm:grid-cols-[15.5rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-white/[0.09] p-3 max-sm:hidden">
            <p className="px-2 pt-1 text-sm font-medium">Settings</p>
            <nav className="mt-5 space-y-1" aria-label="Settings sections">
              {settingsSections.map((section) => {
                const Icon = section.icon
                return (
                  <Button
                    key={section.id}
                    type="button"
                    variant="ghost"
                    onClick={() => setSettingsSection(section.id)}
                    aria-current={
                      settingsSection === section.id ? "page" : undefined
                    }
                    className="w-full justify-start text-[#b9b9b9] aria-[current=page]:bg-white/[0.09] aria-[current=page]:text-[#f2f2f2]"
                  >
                    <Icon /> {section.label}
                  </Button>
                )
              })}
            </nav>
            <div className="mt-auto border-t border-white/[0.09] px-2 pt-3">
              <p className="truncate text-sm font-medium">
                {user.name || "Zenote user"}
              </p>
              <p className="mt-0.5 truncate text-xs text-[#a8a8a8]">
                {user.email}
              </p>
            </div>
          </aside>

          <section className="min-w-0 overflow-x-hidden overflow-y-auto px-6 pt-6 pb-10 sm:px-8">
            <nav
              className="mb-5 flex gap-1 overflow-x-auto sm:hidden"
              aria-label="Settings sections"
            >
              {settingsSections.map((section) => (
                <Button
                  key={section.id}
                  type="button"
                  size="sm"
                  variant={
                    settingsSection === section.id ? "secondary" : "ghost"
                  }
                  onClick={() => setSettingsSection(section.id)}
                >
                  {section.label}
                </Button>
              ))}
            </nav>
            <DialogHeader className="border-b border-white/[0.09] pb-6">
              <DialogTitle className="text-xl">
                {settingsCopy[settingsSection].title}
              </DialogTitle>
              <DialogDescription className="text-[#a8a8a8]">
                {settingsCopy[settingsSection].description}
              </DialogDescription>
            </DialogHeader>
            {settingsSection === "general" && (
              <div className="divide-y divide-white/[0.09]">
                <div className="py-5">
                  <p className="text-sm font-medium">Account</p>
                  <p className="mt-1 truncate text-sm text-[#a8a8a8]">
                    {user.email}
                  </p>
                </div>
                <div className="py-5">
                  <p className="text-sm font-medium">Plan</p>
                  <p className="mt-1 text-sm text-[#a8a8a8]">Free plan</p>
                </div>
              </div>
            )}
            {settingsSection === "appearance" && (
              <div className="flex min-w-0 flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Chat theme</p>
                  <p className="mt-1 text-sm text-[#a8a8a8]">
                    Select the surface tone for this session.
                  </p>
                </div>
                <div className="shrink-0">
                  <ThemePreference />
                </div>
              </div>
            )}
            {settingsSection === "help" && (
              <div className="divide-y divide-white/[0.09] py-1">
                <div className="flex items-center justify-between gap-4 py-4 text-sm">
                  <span>Search recent chats</span>
                  <kbd className="text-[#a8a8a8]">Ctrl K</kbd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4 text-sm">
                  <span>Start a new chat</span>
                  <kbd className="text-[#a8a8a8]">Ctrl N</kbd>
                </div>
              </div>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </>
  )
}
