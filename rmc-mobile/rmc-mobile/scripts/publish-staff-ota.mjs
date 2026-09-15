#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

const readArg = (names, fallback) => {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!names.includes(arg)) continue;
    const next = args[i + 1];
    if (next && !next.startsWith('--')) return next;
  }
  return fallback;
};

const hasFlag = (names) => args.some((arg) => names.includes(arg));

const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
const workspaceRootCandidates = [
  path.resolve(process.cwd(), '..'),
  process.cwd()
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot() {
  for (const candidate of workspaceRootCandidates) {
    const payloadManifest = path.join(candidate, 'payload', 'public', 'mobile_manifest.json');
    const portableManifest = path.join(candidate, 'portable_suite', 'public', 'mobile_manifest.json');
    if (await exists(payloadManifest) || await exists(portableManifest)) {
      return candidate;
    }
  }
  return process.cwd();
}

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, content, 'utf8');
}

const channel = readArg(['--channel', '-c'], 'staff');
const branch = readArg(['--branch', '-b'], '');
const platform = readArg(['--platform', '-p'], 'android');
const message = readArg(['--message', '-m'], `Staff OTA update ${new Date().toISOString()}`);

const cliArgs = [
  'eas-cli@latest',
  'update',
  '--platform',
  platform,
  '--message',
  message
];

if (branch) {
  cliArgs.splice(2, 0, '--branch', branch);
} else {
  cliArgs.splice(2, 0, '--channel', channel);
}

const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const commandArgs = process.platform === 'win32'
  ? ['/c', 'npx', '--yes', ...cliArgs]
  : ['--yes', ...cliArgs];

const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_NO_TELEMETRY: '1',
    EAS_NO_VCS: '1',
    EAS_PROJECT_ROOT: process.cwd()
  }
});

child.on('exit', async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if ((code ?? 0) !== 0) {
    process.exit(code ?? 0);
    return;
  }

  try {
    const pkg = await readJson(pkgJsonPath);
    const appVersion = String(pkg.version || '1.0.17').trim() || '1.0.17';
    const apkUrl = `https://pub-45176c50a4064b7ca3a691ba71c61e97.r2.dev/rmc-mobile.apk?v=${appVersion}-20260522`;
    const workspaceRoot = await findWorkspaceRoot();
    const manifestPaths = [
      path.join(workspaceRoot, 'payload', 'public', 'mobile_manifest.json'),
      path.join(workspaceRoot, 'portable_suite', 'public', 'mobile_manifest.json')
    ];
    const broadcastPaths = [
      path.join(workspaceRoot, 'payload', 'public', 'mobile_update_broadcast.json'),
      path.join(workspaceRoot, 'portable_suite', 'public', 'mobile_update_broadcast.json')
    ];

    let nextConfigVersion = 13;
    let templateManifest = null;
    for (const manifestPath of manifestPaths) {
      if (!await exists(manifestPath)) continue;
      templateManifest = await readJson(manifestPath);
      const currentConfigVersion = Number(templateManifest?.app?.config_version || 0) || 0;
      nextConfigVersion = Math.max(nextConfigVersion, currentConfigVersion + 1);
      break;
    }

    if (!templateManifest) {
      templateManifest = {
        app: {
          version: appVersion,
          min_version: appVersion,
          apk_version: appVersion,
          apk_min_version: appVersion,
          update_mode: 'ota',
          force_update: true,
          apk_url: apkUrl,
          config_version: nextConfigVersion,
          release_notes: []
        }
      };
    }

    const nextManifest = {
      ...templateManifest,
      app: {
        ...templateManifest.app,
        version: appVersion,
        min_version: appVersion,
        apk_version: appVersion,
        apk_min_version: appVersion,
        update_mode: 'ota',
        force_update: true,
        apk_url: templateManifest?.app?.apk_url || apkUrl,
        config_version: nextConfigVersion,
        release_notes: [
          'Staff OTA is the default update path and stays published on the channel.',
          ...(Array.isArray(templateManifest?.app?.release_notes)
            ? templateManifest.app.release_notes.map((note) => String(note ?? '').trim()).filter(Boolean)
            : [])
        ]
      }
    };

    const nextBroadcast = {
      signature: `${appVersion}|${appVersion}|ota|1|${nextConfigVersion}`,
      title: 'Staff update available',
      body: `Version ${appVersion} is ready. Open the app to apply the staff OTA update.`,
      data: {
        type: 'app_update',
        version: appVersion,
        min_version: appVersion,
        apk_version: appVersion,
        update_mode: 'ota',
        force_update: true,
        config_version: nextConfigVersion,
        apk_url: nextManifest.app.apk_url
      },
      sent_at: new Date().toISOString(),
      delivered_to: 0
    };

    for (const manifestPath of manifestPaths) {
      if (await exists(manifestPath)) {
        await writeJson(manifestPath, nextManifest);
      }
    }
    for (const broadcastPath of broadcastPaths) {
      if (await exists(broadcastPath)) {
        await writeJson(broadcastPath, nextBroadcast);
      }
    }
    process.stdout.write(`[publish-staff-ota] Updated OTA manifest to config_version=${nextConfigVersion}\n`);
  } catch (error) {
    console.error('[publish-staff-ota] Failed to stamp OTA metadata:', error);
    process.exitCode = 1;
  }
});
