import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Shield, User as UserIcon } from "lucide-react";

export function UserMenu() {
  const { user, isAdmin, signOut, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return null;

  if (!user) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to="/auth">Sign in</Link>
      </Button>
    );
  }

  const initial = (user.email ?? "?").charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90">
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium truncate">{user.email}</span>
            {isAdmin && (
              <span className="text-xs text-primary mt-0.5 flex items-center gap-1">
                <Shield className="h-3 w-3" /> Admin
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate({ to: "/admin/library" })}>
            <Shield className="h-4 w-4 mr-2" />
            Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate({ to: "/admin/library" })}>
          <UserIcon className="h-4 w-4 mr-2" />
          My library
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
