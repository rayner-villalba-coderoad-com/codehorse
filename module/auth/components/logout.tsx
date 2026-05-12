"use client";
import React from "react";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

const Logout = ({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const router = useRouter();
  const handleLogout = async () => {
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            // Redirect to login page after successful logout
            router.push("/login");
          }
        }
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <span className={className} onClick={handleLogout}>
      {children}
    </span>
  );
};

export default Logout;