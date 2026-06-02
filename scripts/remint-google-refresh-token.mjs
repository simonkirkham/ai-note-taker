// Re-mint the Google Calendar refresh token stored in SSM.
//
// The long-lived refresh token in SSM (GOOGLE_REFRESH_TOKEN_SSM_PATH) is what the
// Lambda uses to talk to Google Calendar. When it dies you get
//   TokenResponseException: invalid_grant ("Token has been expired or revoked")
// and the API returns calendar_unavailable. Run this to mint a fresh one.
//
// Zero dependencies — pure Node 18+ (uses global fetch + built-in http/crypto).
//
// PREREQUISITES (one-time, in Google Cloud Console for THIS OAuth client):
//   1. OAuth consent screen publishing status = "In production" (not Testing),
//      otherwise the new token expires again after 7 days.
//   2. Under the OAuth client's "Authorized redirect URIs", add exactly:
//          http://localhost:4180/oauth2callback
//      (or whatever PORT you pass below). You can remove it again afterwards.
//
// USAGE (from the repo root) — just print the token + store command:
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/remint-google-refresh-token.mjs
//
// USAGE — mint AND write straight to SSM (recommended; avoids the hand-typed put-parameter,
// which is the step people get wrong — wrong account, wrong region, or missing --overwrite):
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy \
//   GOOGLE_REFRESH_TOKEN_SSM_PATH=/notetaker/google-refresh-token \
//   AWS_PROFILE=prod AWS_REGION=eu-west-2 WRITE_SSM=1 \
//   node scripts/remint-google-refresh-token.mjs
//
// Optional env:
//   PORT        loopback port (default 4180) — must match the registered redirect URI
//   SCOPE       OAuth scope (default https://www.googleapis.com/auth/calendar.readonly)
//   WRITE_SSM   "1" to run `aws ssm put-parameter ... --overwrite` for you
//   AWS_PROFILE / AWS_REGION  passed through to the AWS CLI when WRITE_SSM=1
//               (NOTE: prod is account 642653037268 in eu-west-2; the prod/test CLI
//                profiles default to eu-west-1, so AWS_REGION=eu-west-2 is required)
//
// The client secret is never logged. The refresh token is printed to stdout; when WRITE_SSM=1
// it is passed to the AWS CLI via a 0600 temp file (deleted immediately) so it never lands in
// the process list or your shell history.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.PORT ?? 4180);
const SCOPE = process.env.SCOPE ?? "https://www.googleapis.com/auth/calendar.readonly";
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SSM_PATH = process.env.GOOGLE_REFRESH_TOKEN_SSM_PATH; // used to print/run the store command
const WRITE_SSM = process.env.WRITE_SSM === "1";
const AWS_PROFILE = process.env.AWS_PROFILE;
const AWS_REGION = process.env.AWS_REGION;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "ERROR: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (the same values used by the deploy workflow).",
  );
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`ERROR: PORT must be an integer 1-65535 (got "${process.env.PORT}").`);
  process.exit(1);
}

if (WRITE_SSM && !SSM_PATH) {
  console.error("ERROR: WRITE_SSM=1 requires GOOGLE_REFRESH_TOKEN_SSM_PATH to be set.");
  process.exit(1);
}

// PKCE — matches the pattern already used in web/src/auth/pkce.ts.
const base64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const codeVerifier = base64url(crypto.randomBytes(32));
const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // required to receive a refresh token
    prompt: "consent", // required to force a NEW refresh token even if one was granted before
    include_granted_scopes: "true",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

function tryOpenBrowser(url) {
  // Best-effort across macOS / Linux / WSL. Falls back to printing the URL.
  const candidates =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [
            ["wslview", [url]], // WSL
            ["xdg-open", [url]], // native Linux desktop
          ];
  for (const [cmd, cmdArgs] of candidates) {
    try {
      const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
      return;
    } catch {
      // try next
    }
  }
}

async function exchangeCodeForTokens(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

// Writes the token to SSM via the AWS CLI, passing the value through a 0600 temp file so it
// never appears in the process list. Returns true on success. Honours AWS_PROFILE / AWS_REGION.
function storeInSsm(token) {
  const tmp = path.join(os.tmpdir(), `gcal-refresh-${process.pid}.txt`);
  fs.writeFileSync(tmp, token, { mode: 0o600 });
  try {
    const args = [
      "ssm", "put-parameter",
      "--name", SSM_PATH,
      "--type", "SecureString",
      "--value", `file://${tmp}`,
      "--overwrite",
    ];
    if (AWS_PROFILE) args.push("--profile", AWS_PROFILE);
    if (AWS_REGION) args.push("--region", AWS_REGION);

    const where =
      `${SSM_PATH}` +
      (AWS_PROFILE ? ` [profile ${AWS_PROFILE}]` : "") +
      (AWS_REGION ? ` [region ${AWS_REGION}]` : "");
    console.log(`\nWriting refresh token to SSM: ${where} ...`);

    const r = spawnSync("aws", args, { stdio: ["ignore", "inherit", "inherit"] });
    if (r.error) {
      console.error(`Failed to run the AWS CLI (${r.error.message}). Store it manually (command above).`);
      return false;
    }
    if (r.status !== 0) {
      console.error(`aws ssm put-parameter exited ${r.status}. Store it manually (command above).`);
      return false;
    }
    console.log(
      "✅ Stored. The deployed Lambda self-heals on its next calendar call — no redeploy needed.",
    );
    return true;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  const finish = (statusCode, message) => {
    res.writeHead(statusCode, { "Content-Type": "text/html" });
    res.end(`<html><body style="font-family:system-ui;padding:2rem">${message}</body></html>`);
  };

  if (error) {
    finish(400, `Authorization failed: <b>${error}</b>. You can close this tab.`);
    console.error(`\nAuthorization denied: ${error}`);
    server.close();
    process.exit(1);
  }
  if (returnedState !== state) {
    finish(400, "State mismatch — aborting. You can close this tab.");
    console.error("\nERROR: state mismatch (possible CSRF). Aborting.");
    server.close();
    process.exit(1);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    server.close();

    if (!tokens.refresh_token) {
      finish(
        200,
        "Got an access token but <b>no refresh token</b>. Revoke the app at " +
          "myaccount.google.com/permissions and re-run (prompt=consent forces a new one).",
      );
      console.error(
        "\nERROR: Google returned no refresh_token. This happens when a refresh token was " +
          "already granted to this client. Revoke access at https://myaccount.google.com/permissions " +
          "then re-run this script.",
      );
      process.exit(1);
    }

    finish(200, "✅ Refresh token minted. Return to your terminal — you can close this tab.");

    console.log("\n=== NEW GOOGLE CALENDAR REFRESH TOKEN ===\n");
    console.log(tokens.refresh_token);
    console.log("\n=========================================\n");

    if (WRITE_SSM) {
      const ok = storeInSsm(tokens.refresh_token);
      process.exit(ok ? 0 : 1);
    }

    console.log("Store it in SSM (SecureString). Re-run with WRITE_SSM=1 to do this automatically:\n");
    console.log(
      `  aws ssm put-parameter \\\n` +
        `    --name "${SSM_PATH ?? "<GOOGLE_REFRESH_TOKEN_SSM_PATH>"}" \\\n` +
        `    --type SecureString \\\n` +
        `    --value "${tokens.refresh_token}" \\\n` +
        `    --overwrite${AWS_PROFILE ? ` \\\n    --profile ${AWS_PROFILE}` : ""}` +
        `${AWS_REGION ? ` \\\n    --region ${AWS_REGION}` : ""}\n`,
    );
    console.log(
      "Since the self-heal change, you do NOT need to redeploy — the Lambda reloads the token\n" +
        "from SSM on its next calendar call. (The first call after the update may still fail once\n" +
        "before the reload kicks in; just retry.)\n",
    );
    process.exit(0);
  } catch (e) {
    finish(500, `Token exchange failed: ${e.message}. Check the terminal.`);
    console.error(`\n${e.message}`);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\nListening on ${REDIRECT_URI}`);
  console.log("\nOpen this URL in a browser and grant access:\n");
  console.log(authUrl + "\n");
  console.log(
    `(If "${REDIRECT_URI}" isn't registered under the OAuth client's Authorized redirect URIs,\n` +
      ` add it in the Cloud Console first, then re-open the URL above.)\n`,
  );
  tryOpenBrowser(authUrl);
});
