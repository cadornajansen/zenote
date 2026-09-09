"use client"

import Link from "next/link"
import { LogOutIcon, SettingsIcon } from "lucide-react"

import { signOutAction } from "@/app/(auth)/actions"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type UserMenuProps = {
  user: { name: string; email: string }
}

function initials(name: string, email: string) {
  const source = name.trim() || email
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function UserMenu({ user }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open user menu" />
        }
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-primary/15 text-primary">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2">
            <span className="block truncate text-sm text-foreground">
              {user.name || "Zenote user"}
            </span>
            <span className="mt-0.5 block truncate font-normal text-muted-foreground">
              {user.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
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
  )
}
