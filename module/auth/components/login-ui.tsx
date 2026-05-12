"use client";
import React, {useState} from "react";
import { signIn } from "@/lib/auth-client";
// import {GitHubIcon} from "lucide-react";

const LoginUI = () => {
  const [isLoading, setIsLoading] = useState(false);
  const handleGithubLogin = async () => {
    setIsLoading(true);
    try {
      await signIn.social({
        provider: "github",
      })
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <div className="min-h-screen bg-linear-to-br from-black via-black to-zinc-900 text-white dark flex">
      { /* Left Section - Hero Content */}
      <div className="flex-1 flex flex-col justify-center px-12 py-16">
        <div className="max-w-lg">
          {/* Logo */}
          <div className="mb-16">
            <div className="inline-flex items-center gap-2 text-2xl font-bold">
              <div className="w-8 h-8 bg-primary rounded-full"></div>
              <span>CodeHorse</span>
            </div>
          </div>

          {/* Main Content */}
          <h1 className="text-5xl font-bold mb-6 leading-tight text-balance">
            Cut Code Review Time & Bugs in Half. <span className="block">Instantly.</span>
          </h1>

          <p className="text-lg text-gray-400 leading-relaxed">
            Superchange your team to ship faster with the most advanced AI code reviews.
          </p>
        </div>
      </div>

      { /* Right Section - Login Form */}
      <div className="flex-1 flex flex-col justify-center px-12 py-16">
        <div className="mb-12">
          <h2 className="text-3xl font-bold mb-2">Welcome Back</h2>
          <p className="text-zinc-400">
            Login using one of the following providers:
          </p>
          { /* GitHub Login Buttons */}
          <button
            onClick={handleGithubLogin}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-white text-black rounded-lg font-semibold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed mt-6 transition-colors flex items-center justify-center gap-4 mb-8"
          >
            {/* <GitHubIcon size={20} /> */}
            {isLoading ? "Signing in..." : "Sign in with GitHub"}
          </button>

          { /* Footer Links */}
          <div className="space-y-4 text-center text-sm text-gray-400">
            <div>
              New to CodeRoad ? { " "}
              <a href="#" className="text-primary hover:text-primary-foreground font-semibold">Sign Up</a>
            </div>
            <div>
              <a href="#" className="text-primary hover:text-primary-foreground font-semibold">Self-Hosted Services</a>
            </div>
          </div>

          { /* Bottom Links */}
          <div className="mt-12 pt-8 border-t border-gray-700 flex justify-center gap-4 text-xs text-gray-500">
            <a href="#" className="hover:text-gray-400">Term of Use</a>
            <span>and</span>
            <a href="#" className="hover:text-gray-400">Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginUI;