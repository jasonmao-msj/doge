import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

test("Cargo and platform builds only produce current doge binaries and artifacts", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const build = read("scripts/build-platform.mjs");

  assert.match(cargo, /default-run = "doge"/);
  assert.match(cargo, /name = "doge_daemon"/);
  assert.doesNotMatch(cargo, /name = "cc_gui_daemon"/);

  for (const expected of [
    "doge.app",
    "doge_daemon",
    "doge_${version}_aarch64.dmg",
    "doge_${version}_x86_64.dmg",
    "doge_${version}_universal.dmg",
    "doge_${version}_x64-setup.exe",
    "doge_${version}_${arch === \"arm64\" ? \"aarch64\" : \"amd64\"}.AppImage",
  ]) {
    assert.ok(build.includes(expected), `missing current build identity: ${expected}`);
  }

  assert.doesNotMatch(build, /cc-gui|cc_gui_daemon|ccgui|moss[_-]?x/i);
});

test("daemon engine bridge registers every shared Kimi launch module", () => {
  const engine = read("src-tauri/src/engine/mod.rs");
  const daemonBridge = read("src-tauri/src/bin/doge_daemon/engine_bridge.rs");

  assert.match(engine, /pub\(crate\) mod kimi_launch;/);
  assert.match(
    daemonBridge,
    /#\[path = "\.\.\/\.\.\/engine\/kimi_launch\.rs"\]\s*pub\(crate\) mod kimi_launch;/,
  );
});

test("macOS and Linux daemon discovery is current-first with legacy read fallback", () => {
  const bootstrap = read("src-tauri/src/web_service/daemon_bootstrap.rs");
  const names = sourceSection(
    bootstrap,
    "fn daemon_binary_names()",
    "/// Open a log file",
  );

  assert.match(
    names,
    /"doge_daemon\.exe",\s*"cc_gui_daemon\.exe",\s*"moss_x_daemon\.exe",\s*"moss-x-daemon\.exe"/,
  );
  assert.match(
    names,
    /"doge_daemon",\s*"cc_gui_daemon",\s*"moss_x_daemon",\s*"moss-x-daemon"/,
  );
  assert.match(bootstrap, /\.arg\("--bin"\)\s*\.arg\("doge_daemon"\)/);
  assert.doesNotMatch(bootstrap, /\.arg\("cc_gui_daemon"\)/);
});

test("daemon writes current identity while legacy environment names remain read-only", () => {
  const daemon = read("src-tauri/src/bin/doge_daemon.rs");
  const tokenSelection = sourceSection(
    daemon,
    "let mut token = select_daemon_token(",
    ");\n    let mut insecure_no_auth",
  );

  const dogeToken = tokenSelection.indexOf('env::var("DOGE_DAEMON_TOKEN")');
  const legacyCcToken = tokenSelection.indexOf('env::var("CC_GUI_DAEMON_TOKEN")');
  const legacyMossToken = tokenSelection.indexOf('env::var("MOSS_X_DAEMON_TOKEN")');
  assert.ok(dogeToken >= 0 && dogeToken < legacyCcToken);
  assert.ok(legacyCcToken < legacyMossToken);

  assert.match(daemon, /join\("doge_daemon"\)/);
  assert.doesNotMatch(daemon, /join\("cc_gui_daemon"\)|join\("moss[_-]?x_daemon"\)/i);
  assert.match(daemon, /USAGE:\\n  doge_daemon/);
});

test("build failures are propagated unless a caller explicitly requests best-effort cleanup", () => {
  const build = read("scripts/build-platform.mjs");
  const execImplementation = sourceSection(
    build,
    "function exec(cmd, options = {})",
    "function pruneLinuxAppImageWaylandLibraries",
  );

  assert.match(
    execImplementation,
    /catch \(error\) \{\s*if \(ignoreError\) \{\s*return false;\s*\}\s*throw error;\s*\}/,
  );
  assert.doesNotMatch(execImplementation, /TAURI_SIGNING_PRIVATE_KEY|error\.status/);
});

test("platform builds fail closed when expected doge artifacts are missing", () => {
  const build = read("scripts/build-platform.mjs");
  const fixOpenSsl = read("scripts/macos-fix-openssl.sh");

  assert.match(build, /function assertBuildArtifact\(artifactPath, label\)/);
  assert.match(build, /assertMacAppBundle\(bundlePath\)/);
  assert.match(build, /assertBuildArtifact\(installerPath, "Windows NSIS bundle"\)/);
  assert.match(build, /assertBuildArtifact\(appImagePath, "Linux AppImage bundle"\)/);
  assert.match(fixOpenSsl, /no doge binaries found under/);
  assert.match(fixOpenSsl, /incomplete app bundle/);
});

test(
  "macOS OpenSSL fixup executes with the canonical app MacOS directory",
  { skip: process.platform === "win32" },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "doge-macos-openssl-"));
    const appPath = join(fixtureRoot, "doge.app");
    const macosDir = join(appPath, "Contents", "MacOS");
    const opensslDir = join(fixtureRoot, "openssl");
    const stubsDir = join(fixtureRoot, "bin");

    try {
      mkdirSync(macosDir, { recursive: true });
      mkdirSync(join(opensslDir, "lib"), { recursive: true });
      mkdirSync(stubsDir, { recursive: true });
      writeFileSync(join(macosDir, "doge"), "doge");
      writeFileSync(join(macosDir, "doge_daemon"), "doge-daemon");
      writeFileSync(join(opensslDir, "lib", "libssl.3.dylib"), "ssl");
      writeFileSync(join(opensslDir, "lib", "libcrypto.3.dylib"), "crypto");

      writeExecutable(join(stubsDir, "install_name_tool"), "#!/bin/sh\nexit 0\n");
      writeExecutable(join(stubsDir, "codesign"), "#!/bin/sh\nexit 0\n");
      writeExecutable(join(stubsDir, "bash"), "#!/bin/sh\nexit 0\n");
      writeExecutable(
        join(stubsDir, "otool"),
        '#!/bin/sh\nif [ "$1" = "-L" ]; then\n  printf "%s:\\n\\t@rpath/libcrypto.3.dylib (compatibility version 3.0.0, current version 3.0.0)\\n" "$2"\nfi\n',
      );

      const result = spawnSync(
        "/bin/bash",
        ["scripts/macos-fix-openssl.sh", appPath],
        {
          cwd: new URL("..", import.meta.url),
          encoding: "utf8",
          env: {
            ...process.env,
            OPENSSL_DIR: opensslDir,
            PATH: `${stubsDir}:${process.env.PATH ?? ""}`,
            SKIP_CODESIGN: "1",
          },
        },
      );

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /applied a verified ad-hoc signature/);
      assert.doesNotMatch(result.stderr, /unbound variable/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test("DMG Finder automation is bounded and keeps headless fallbacks", () => {
  const dmg = read("scripts/create-dmg.sh");

  assert.match(dmg, /run_osascript_with_timeout\(\)/);
  assert.match(dmg, /run_osascript_with_timeout 8 <<APPLESCRIPT/);
  assert.match(dmg, /run_osascript_with_timeout 15 <<APPLESCRIPT/);
  assert.match(dmg, /run_osascript_with_timeout 5 -e/);
  assert.match(dmg, /falling back to symlink/);
  assert.match(dmg, /ln -s \/Applications/);
});

test("artifact-only macOS builds bundle OpenSSL and apply verified ad-hoc signing", () => {
  const build = read("scripts/build-platform.mjs");
  const fixOpenSsl = read("scripts/macos-fix-openssl.sh");

  assert.match(build, /SKIP_CODESIGN=1/);
  assert.match(build, /Bundling OpenSSL with ad-hoc signing/);
  assert.match(fixOpenSsl, /skip_codesign="\$\{SKIP_CODESIGN:-0\}"/);
  assert.match(fixOpenSsl, /codesign --force --sign -/);
  assert.match(fixOpenSsl, /codesign --verify --deep --strict/);
  assert.match(fixOpenSsl, /OPENSSL_DIR/);
  assert.match(fixOpenSsl, /applied a verified ad-hoc signature/);
  assert.match(fixOpenSsl, /install_name_tool -change/);

  const adHocSigning = sourceSection(
    fixOpenSsl,
    'if [[ "${skip_codesign}" == "1" ]]',
    "codesign --force --options runtime --timestamp",
  );
  const developerIdSigning = fixOpenSsl.slice(
    fixOpenSsl.indexOf("codesign --force --options runtime --timestamp"),
  );
  for (const section of [adHocSigning, developerIdSigning]) {
    assert.ok(
      section.indexOf('"${daemon_path}"') < section.indexOf('"${bin_path}"'),
      "nested daemon must be signed before the main executable",
    );
  }
});
