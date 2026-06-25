"use client";

import { useEffect, useState } from "react";

/** Receives Google's OAuth redirect, exchanges the code for a refresh token,
 *  stores it, and returns to the app. */
export default function GoogleCallback() {
  const [msg, setMsg] = useState("Finishing Google sign-in…");
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const err = params.get("error");
    if (err) {
      setOk(false);
      setMsg(`Sign-in was cancelled or failed (${err}).`);
      return;
    }
    if (!code) {
      setOk(false);
      setMsg("No authorization code returned by Google.");
      return;
    }
    const clientId = localStorage.getItem("gmailClientId");
    const clientSecret = localStorage.getItem("gmailClientSecret");
    if (!clientId || !clientSecret) {
      setOk(false);
      setMsg("Missing client credentials — start again from the Daily Parkers tab.");
      return;
    }
    const redirectUri = `${window.location.origin}/google-callback`;
    fetch("/api/google/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, clientId, clientSecret, redirectUri }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.refresh_token) {
          localStorage.setItem("gmailRefreshToken", d.refresh_token);
          setOk(true);
          setMsg("Connected to Gmail! Redirecting…");
          setTimeout(() => {
            window.location.href = "/";
          }, 900);
        } else {
          setOk(false);
          setMsg(d.error || "Could not obtain a refresh token.");
        }
      })
      .catch((e) => {
        setOk(false);
        setMsg(e instanceof Error ? e.message : "Token exchange failed.");
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Daily Parkers — Google Sign-in
        </h1>
        <p
          className={`mt-3 text-sm ${
            ok === false
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-600 dark:text-slate-300"
          }`}
        >
          {msg}
        </p>
        {ok === false && (
          <a
            href="/"
            className="mt-5 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Back to app
          </a>
        )}
      </div>
    </div>
  );
}
