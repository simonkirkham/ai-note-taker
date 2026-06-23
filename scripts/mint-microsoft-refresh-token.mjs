// Mint the Microsoft 365 (Outlook) calendar refresh token stored in SSM.
//
// The long-lived refresh token in SSM (MICROSOFT_REFRESH_TOKEN_SSM_PATH) is what the
// Lambda uses to talk to Microsoft Graph. When it dies you get an Entra
//   invalid_grant ("AADSTS... token expired or revoked")
// and the API returns calendar_unavailable. Run this to mint a fresh one.
//
// Uses the OAuth 2.0 device-authorization flow against a PUBLIC client (no client secret),
// exactly the path the Phase 32 spike proved. Zero dependencies — pure Node 18+ (global fetch).
//
// PREREQUISITES (one-time, in the Microsoft Entra admin center for THIS app registration):
//   1. App registration is a PUBLIC client. Authentication → "Allow public client flows" = Yes
//      (device code requires it). No client secret is needed.
//   2. Supported account types includes personal Microsoft accounts (for an @outlook.com /
//      MSA mailbox use tenant "consumers"; for a work/school tenant use its GUID or "organizations").
//   3. API permissions → delegated → Microsoft Graph → Calendars.Read (+ offline_access).
//
// USAGE (from the repo root) — just print the token + store command:
//   MS_CLIENT_ID=xxx node scripts/mint-microsoft-refresh-token.mjs
//
// USAGE — mint AND write straight to SSM (recommended; avoids the hand-typed put-parameter,
// which is the step people get wrong — wrong account, wrong region, or missing --overwrite):
//   MS_CLIENT_ID=xxx \
//   MICROSOFT_REFRESH_TOKEN_SSM_PATH=/notetaker/microsoft-refresh-token \
//   AWS_PROFILE=prod AWS_REGION=eu-west-2 WRITE_SSM=1 \
//   node scripts/mint-microsoft-refresh-token.mjs
//
// Optional env:
//   MS_TENANT_ID   Entra tenant (default "consumers" for a personal MSA; "organizations" or a
//                  tenant GUID for work/school). MUST match CALENDAR_PROVIDER=microsoft's MS_TENANT_ID.
//   SCOPE          OAuth scope (default "offline_access https://graph.microsoft.com/Calendars.Read";
//                  offline_access is REQUIRED to receive a refresh token)
//   WRITE_SSM      "1" to run `aws ssm put-parameter ... --overwrite` for you
//   AWS_PROFILE / AWS_REGION  passed through to the AWS CLI when WRITE_SSM=1
//                  (NOTE: the prod app runs in eu-west-2, but the prod/test CLI profiles
//                   default to eu-west-1, so AWS_REGION=eu-west-2 is required)
//
// The refresh token is printed to stdout; when WRITE_SSM=1 it is passed to the AWS CLI via a
// 0600 temp file (deleted immediately) so it never lands in the process list or shell history.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLIENT_ID = process.env.MS_CLIENT_ID;
const TENANT_ID = process.env.MS_TENANT_ID || "consumers";
const SCOPE = process.env.SCOPE ?? "offline_access https://graph.microsoft.com/Calendars.Read";
const SSM_PATH = process.env.MICROSOFT_REFRESH_TOKEN_SSM_PATH; // used to print/run the store command
const WRITE_SSM = process.env.WRITE_SSM === "1";
const AWS_PROFILE = process.env.AWS_PROFILE;
const AWS_REGION = process.env.AWS_REGION;

const DEVICECODE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

if (!CLIENT_ID) {
  console.error("ERROR: set MS_CLIENT_ID (the Entra app registration's Application (client) ID).");
  process.exit(1);
}

if (WRITE_SSM && !SSM_PATH) {
  console.error("ERROR: WRITE_SSM=1 requires MICROSOFT_REFRESH_TOKEN_SSM_PATH to be set.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Step 1: request a device + user code.
async function requestDeviceCode() {
  const res = await fetch(DEVICECODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Device code request failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

// Step 2: poll the token endpoint until the user finishes signing in.
async function pollForToken(deviceCode, intervalSeconds, expiresInSeconds) {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let interval = intervalSeconds;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: deviceCode,
      }),
    });
    const body = await res.json();
    if (res.ok) return body;

    switch (body.error) {
      case "authorization_pending":
        continue; // user hasn't finished yet
      case "slow_down":
        interval += 5; // back off as instructed
        continue;
      case "authorization_declined":
        throw new Error("You declined the authorization request.");
      case "expired_token":
        throw new Error("The device code expired before sign-in completed. Re-run the script.");
      default:
        throw new Error(`Token poll failed: ${JSON.stringify(body)}`);
    }
  }
  throw new Error("Timed out waiting for sign-in. Re-run the script.");
}

// Writes the token to SSM via the AWS CLI, passing the value through a 0600 temp file so it
// never appears in the process list. Returns true on success. Honours AWS_PROFILE / AWS_REGION.
function storeInSsm(token) {
  const tmp = path.join(os.tmpdir(), `mscal-refresh-${process.pid}.txt`);
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

async function main() {
  const device = await requestDeviceCode();

  console.log("\n=== SIGN IN TO MINT A MICROSOFT REFRESH TOKEN ===\n");
  // `message` is a ready-made human instruction with the URL + code; print it verbatim.
  console.log(device.message ?? `Go to ${device.verification_uri} and enter code ${device.user_code}`);
  console.log("\n(Waiting for you to finish signing in...)\n");

  const tokens = await pollForToken(device.device_code, device.interval ?? 5, device.expires_in ?? 900);

  if (!tokens.refresh_token) {
    console.error(
      "\nERROR: no refresh_token returned. Ensure 'offline_access' is in SCOPE and the app " +
        "registration grants Calendars.Read. Then re-run.",
    );
    process.exit(1);
  }

  console.log("=== NEW MICROSOFT CALENDAR REFRESH TOKEN ===\n");
  console.log(tokens.refresh_token);
  console.log("\n============================================\n");

  if (WRITE_SSM) {
    const ok = storeInSsm(tokens.refresh_token);
    process.exit(ok ? 0 : 1);
  }

  console.log("Store it in SSM (SecureString). Re-run with WRITE_SSM=1 to do this automatically:\n");
  console.log(
    `  aws ssm put-parameter \\\n` +
      `    --name "${SSM_PATH ?? "<MICROSOFT_REFRESH_TOKEN_SSM_PATH>"}" \\\n` +
      `    --type SecureString \\\n` +
      `    --value "${tokens.refresh_token}" \\\n` +
      `    --overwrite${AWS_PROFILE ? ` \\\n    --profile ${AWS_PROFILE}` : ""}` +
      `${AWS_REGION ? ` \\\n    --region ${AWS_REGION}` : ""}\n`,
  );
  console.log(
    "You do NOT need to redeploy — the Lambda reloads the token from SSM on its next calendar\n" +
      "call. (The first call after the update may still fail once before the reload kicks in; retry.)\n",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
