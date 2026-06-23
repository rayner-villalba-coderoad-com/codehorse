"use client";
import React from "react";
import { signOut } from "@/lib/auth-client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";

type LogoutProps = React.HTMLAttributes<HTMLSpanElement> & {
  children: React.ReactNode;
};

// Rendered as the `asChild` target of a DropdownMenuItem, so it must forward the
// ref and the props Radix injects (role, tabIndex, keyboard/click handlers).
const Logout = React.forwardRef<HTMLSpanElement, LogoutProps>(
  ({ children, className, onClick, ...props }, ref) => {
    // Wrapped in a mutation so logout also drives the global loading overlay.
    const logoutMutation = useMutation({
      mutationFn: async () => {
        await signOut();
      },
      onSuccess: () => {
        // Hard navigation guarantees the server-side auth check re-runs and all
        // client state (RSC router cache, React Query cache, better-auth session
        // store) is cleared. A soft router.push() can leave stale auth behind.
        window.location.href = "/login";
      },
      onError: (error) => {
        console.error("Logout failed:", error);
        toast.error("Logout failed. Please try again.");
      }
    });

    const isPending = logoutMutation.isPending;

    return (
      <span
        ref={ref}
        className={className}
        aria-busy={isPending}
        {...props}
        onClick={(e) => {
          // Preserve the menu item's own selection handler, then sign out.
          onClick?.(e);
          if (!isPending) logoutMutation.mutate();
        }}
      >
        {isPending ? (
          <>
            <Spinner className="mr-2 size-4" />
            Signing out...
          </>
        ) : (
          children
        )}
      </span>
    );
  }
);

Logout.displayName = "Logout";

export default Logout;
