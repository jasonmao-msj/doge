import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const LEGACY_TOKENS = [
  {
    id: "upstream-repository",
    pattern: /zhukunpenglinyutong\/desktop-cc-gui/i,
  },
  {
    id: "upstream-service",
    pattern: /hm\.baidu\.com|baiduTongji|fufei\.mossx\.ai/i,
  },
  {
    id: "legacy-brand",
    pattern: /desktop-cc-gui|cc[-_ ]?gui|CodeMoss|moss[-_ ]?x|codemoss/i,
  },
];

const compatibility = (path, line, reason, tokens = ["legacy-brand"]) => ({
  path,
  line,
  tokens,
  category: "compatibility-reader",
  reason,
  removalCondition: "Remove only in a dedicated migration-removal change with fixture evidence.",
});

const compatibilityWriter = (path, line, reason, tokens = ["legacy-brand"]) => ({
  path,
  line,
  tokens,
  category: "compatibility-writer",
  reason,
  removalCondition: "Remove only after the corresponding legacy client/schema/protocol can no longer interoperate.",
});

export const DEFAULT_ALLOWLIST = [
  compatibility(/^src\/services\/migrateLocalStorage\.ts$/, /ccgui|moss[-_ ]?x|codemoss/i, "Copies legacy WebView keys into the doge namespace."),
  compatibility(/^src\/features\/workspaces\/utils\/defaultWorkspace\.ts$/, /ccgui|moss[-_ ]?x|codemoss|zhukunpenglinyutong/i, "Recognizes workspace roots created by older clients."),
  compatibility(/^src\/features\/models\/constants\.ts$/, /mossx|codemoss/, "Reads historical model-mapping keys."),
  compatibility(/^src\/features\/vendors\/hooks\/usePluginModels\.ts$/, /mossx|codemoss/, "Reads historical plugin-model keys."),
  compatibility(/^src\/features\/vendors\/components\/VendorSettingsPanel\.tsx$/, /codemoss/, "Recognizes the one-time historical plugin migration flag."),
  compatibility(/^src\/features\/messages\/presentation\/sharedProjection\/dataSource\.ts$/, /mossx/i, "Reads the previous shared projection key and environment override."),
  compatibility(/^src\/features\/shared-session\/runtime\/(?:sharedRecoveryExitFlag|sharedV2SendFlag)\.ts$/, /mossx/i, "Reads previous shared-session feature flags and environment overrides."),
  compatibility(/^src\/features\/files\/utils\/fileMarkdownFeatureFlags\.ts$/, /ccgui|mossx/i, "Reads previous file-rendering flags and environment overrides."),
  compatibility(/^src\/features\/prompts\/promptUsage\.ts$/, /ccgui|mossx/, "Reads previous prompt-usage records."),
  compatibility(/^src\/features\/runtime-log\/(?:hooks\/useRuntimeLogSession|components\/RuntimeLogPanel)\.tsx?$/, /ccgui|CodeMoss/, "Parses logs emitted by older runtime launchers."),
  compatibility(/^src\/features\/composer\/components\/ChatInputBox\/hooks\/usePasteAndDrop\.ts$/, /ccgui|codemoss/, "Accepts drag payloads from an older running window."),
  compatibility(/^src\/features\/multi-agent\/utils\/(?:collabPrompt|canvasItems)\.ts$/, /mossx/, "Hides persisted collaboration control markers from older sessions."),
  compatibility(/^src\/features\/threads\/(?:contracts\/conversationFactContract|assembly\/conversationNormalization)\.ts$/, /ccgui/, "Reads the historical approval-resume envelope."),
  compatibility(/^src\/utils\/threadItemsAssistantText\.ts$/, /ccgui/, "Strips the historical approval-resume envelope."),
  compatibility(/^src\/features\/threads\/loaders\/claudeHistoryLoader\.ts$/, /ccgui/, "Recognizes historical clientInfo records."),
  compatibility(/^src\/features\/threads\/hooks\/sessionLifecycleController\.ts$/, /ccgui/, "Reads the historical hook fallback metadata key."),
  compatibility(/^src\/features\/threads\/utils\/streamLatencyDiagnostics\.ts$/, /ccgui/, "Reads the historical app-server timing field."),
  compatibility(/^src\/features\/extensions\/utils\/mcpInventory\.ts$/, /ccgui/, "Accepts the historical MCP config source discriminator."),
  compatibility(/^src\/services\/tauri\/session\.ts$/, /ccgui/, "Types the historical MCP config source discriminator."),
  compatibility(/^src\/features\/multi-agent\/runtime\/featureFlag\.ts$/, /CCGUI/, "Reads emergency feature flags used by older launch scripts."),
  compatibility(/^src\/services\/tauri\/runtimeMode\.ts$/, /MOSSX/, "Recognizes the historical Web-service window flag."),
  compatibility(/^src\/vite-env\.d\.ts$/, /MOSSX/, "Types the historical Web-service window flag."),
  compatibility(/^src\/utils\/contextProtocol\.ts$/, /MOSSX/, "Reads historical context-package protocol markers and titles."),
  compatibility(/^src\/features\/threads\/(?:hooks\/useThreadActions(?:\.helpers)?|utils\/sessionDisplayProjection)\.ts$/, /MOSSX|Mossx/, "Recognizes historical context control-plane titles."),
  compatibility(/^src\/features\/threads\/utils\/realtimePerfFlags\.ts$/, /CCGUI/, "Documents the historical backend event-batch environment flag."),
  compatibility(/^src-tauri\/src\/app_paths\.rs$/, /ccgui|moss[-_ ]?x|codemoss|zhukunpenglinyutong|dimillian/i, "Copies historical app-home and bundle data into doge destinations."),
  compatibility(/^src-tauri\/src\/storage\.rs$/, /ccgui|moss[-_ ]?x|codemoss|zhukunpenglinyutong/i, "Recognizes historical default workspace roots."),
  compatibility(/^src-tauri\/src\/project_map_relations\/file_classification\.rs$/, /ccgui|mossx|codemoss/, "Excludes historical product metadata directories from project maps."),
  compatibility(/^src-tauri\/src\/engine\/claude\/native_skill_mirror\.rs$/, /ccgui/, "Upgrades historical managed-skill markers."),
  compatibility(/^src-tauri\/src\/web_service\/assets_package\.rs$/, /ccgui|MOSSX/, "Reads historical Web asset markers and environment override."),
  compatibility(/^src-tauri\/src\/code_intel_lsp\.rs$/, /MOSSX/, "Reads previous executable override variables."),
  compatibilityWriter(/^src-tauri\/src\/code_intel_lsp\.rs$/, /\.ccgui-owner\.lock/, "Writes the historical owner lock alongside the doge lock so old and new clients cannot corrupt one language-server cache."),
  compatibility(/^src-tauri\/src\/codex\/mcp_config\.rs$/, /ccgui/, "Accepts the historical MCP config source discriminator."),
  compatibility(/^src-tauri\/src\/codex\/mod\.rs$/, /ccgui-plan-/, "Accepts in-flight local plan request identifiers from older renderers."),
  compatibility(/^src-tauri\/src\/codex\/home\.rs$/, /codemoss/, "Recognizes historical project-local Codex homes."),
  compatibility(/^src-tauri\/src\/codex\/collaboration_policy\.rs$/, /MOSSX/, "Reads the historical collaboration profile environment variable."),
  compatibility(/^src-tauri\/src\/codex\/session_runtime\.rs$/, /ccgui/, "Keeps historical session fallback fixtures readable."),
  compatibility(/^src-tauri\/src\/event_sink\.rs$/, /CCGUI/, "Reads the historical event batching environment variable."),
  compatibility(/^src-tauri\/src\/agent_orchestration\/support\.rs$/, /CCGUI/, "Reads historical orchestration kill-switch variables."),
  compatibility(/^src-tauri\/src\/backend\/app_server\.rs$/, /MOSSX/, "Reads historical timeout override variables."),
  compatibility(/^src-tauri\/src\/backend\/app_server_cli\.rs$/, /CODEMOSS/, "Reads the historical Windows console override."),
  compatibility(/^src-tauri\/src\/utils\.rs$/, /CODEMOSS/, "Reads the historical Windows console override."),
  compatibility(/^src-tauri\/src\/curated_skills\.rs$/, /CCGUI/, "Reads the historical curated-skills kill switch."),
  compatibility(/^src-tauri\/src\/skills_hub\.rs$/, /CCGUI/, "Reads the historical skills-home override."),
  compatibility(/^src-tauri\/src\/engine\/claude\.rs$/, /MOSSX/, "Recognizes historical context package prompts."),
  compatibility(/^src-tauri\/src\/engine\/claude_history_entries\.rs$/, /ccgui/, "Recognizes historical clientInfo records."),
  compatibility(/^src-tauri\/src\/engine\/cli_image_input\.rs$/, /mossx/, "Strips the historical Kimi image attachment marker."),
  compatibility(/^src-tauri\/src\/engine\/agent_event_bus\.rs$/, /MOSSX/, "Reads the historical event-bus override."),
  compatibility(/^src-tauri\/src\/computer_use\/mod\.rs$/, /MOSSX/, "Reads the historical Computer Use kill switch."),
  compatibility(/^src-tauri\/src\/native_continuation\/commands\.rs$/, /MOSSX_NATIVE_CONTEXT_V1/, "Reads historical native context envelopes."),
  compatibilityWriter(/^src-tauri\/src\/native_continuation\/commands\.rs$/, /MOSSX_CONTEXT_PACKAGE|"MOSSX"/, "Preserves the namespace only when continuing an already-legacy context package; fresh packages write DOGE."),
  compatibility(/^src-tauri\/src\/shared_context\/compiler\.rs$/, /mossx/i, "Filters historical collaboration control markers."),
  compatibility(/^src-tauri\/src\/shared_runtime_coordinator\.rs$/, /MOSSX/, "Accepts historical context package echoes."),
  compatibility(/^src-tauri\/src\/shared_session_v2\.rs$/, /mossx|MOSSX/, "Reads historical dispatch receipts and fixtures."),
  compatibility(/^src-tauri\/src\/shared\/workspaces_core\.rs$/, /ccgui|mossx|codemoss/, "Normalizes historical default workspace names."),
  compatibility(/^src-tauri\/src\/local_usage\.rs$/, /ccgui|mossx|codemoss/, "Normalizes historical originator labels to doge."),
  compatibility(/^src-tauri\/src\/vendors\/(?:kimi_providers|grok_providers)\.rs$/, /ccgui/, "Removes historical managed-provider aliases during cleanup."),
  compatibility(/^src-tauri\/src\/engine\/opencode_provider_profile\.rs$/, /ccgui/, "Upgrades historical managed OpenCode model references."),
  compatibility(/^src-tauri\/src\/vendors\/commands\.rs$/, /ccgui|desktop-cc-gui/, "Reads historical vendor config locations and schema documentation."),
  compatibilityWriter(/^src-tauri\/src\/vendors\/commands\.rs$/, /codemossProviderId/, "Preserves the external Claude settings schema field used by older provider integrations."),
  compatibility(/^src-tauri\/src\/project_canvas\.rs$/, /mossx/, "Copies the historical project-local canvas directory."),
  compatibility(/^src-tauri\/src\/web_service\/daemon_bootstrap\.rs$/, /cc_gui|moss_x|moss-x/, "Discovers historical daemon filenames."),
  compatibility(/^src-tauri\/src\/workspaces\/commands\.rs$/, /\.ccgui/, "Allows image previews from the historical project-map root."),
  compatibility(/^src-tauri\/src\/bin\/doge_daemon(?:\/.*)?\.rs$/, /ccgui|cc_gui|mossx|moss_x|moss-x/i, "Discovers historical daemon names and data written by older releases."),
  {
    path: /^src-tauri\/Cargo\.toml$/,
    line: /src\/bin\/doge_daemon\.rs/,
    tokens: ["legacy-brand"],
    category: "source-topology",
    reason: "Keeps the inherited source filename stable while the shipped binary is doge_daemon.",
    removalCondition: "Remove after a dedicated source-layout rename with upstream-sync conflict review.",
  },
  {
    path: /^src\/features\/subagent-ui\/constants\/(?:personaAuthorPool|personaAvatarAssets)\.ts$/,
    line: /ccgui|desktop-cc-gui|zhukunpenglinyutong/,
    tokens: ["legacy-brand", "upstream-repository"],
    category: "developer-provenance",
    reason: "Developer-only attribution for inherited contributor avatar data; never rendered as product branding.",
    removalCondition: "Remove when the inherited contributor asset pool is replaced.",
  },
  {
    path: /^scripts\/upstream-sync-audit\.mjs$/,
    line: /^\s*"https:\/\/github\.com\/zhukunpenglinyutong\/desktop-cc-gui\.git";$/,
    tokens: ["legacy-brand", "upstream-repository"],
    category: "developer-provenance",
    reason: "Audits the one canonical fetch-only upstream remote without exposing it to App runtime.",
    removalCondition: "Remove if doge permanently stops synchronizing inherited upstream code.",
  },
  {
    path: /^docs\/guides\/workflow\/upstream-sync\.md$/,
    line: /https:\/\/github\.com\/zhukunpenglinyutong\/desktop-cc-gui\.git/,
    tokens: ["legacy-brand", "upstream-repository"],
    category: "developer-provenance",
    reason: "Documents the exact developer-only upstream fetch URL and disabled push topology.",
    removalCondition: "Remove if doge permanently stops synchronizing inherited upstream code.",
  },
];

export function validateAllowlist(allowlist) {
  for (const [index, entry] of allowlist.entries()) {
    for (const field of ["path", "line", "tokens", "category", "reason", "removalCondition"]) {
      if (!entry[field] || (Array.isArray(entry[field]) && entry[field].length === 0)) {
        throw new Error(`branding allowlist entry ${index} is missing ${field}`);
      }
    }
    if (entry.line.source === ".*" || entry.line.source === "[\\s\\S]*") {
      throw new Error(`branding allowlist entry ${index} uses a catch-all line pattern`);
    }
  }
}

function matchesAllowlist(relativePath, line, tokenId, allowlist) {
  return allowlist.some(
    (entry) =>
      entry.tokens.includes(tokenId) &&
      entry.path.test(relativePath) &&
      entry.line.test(line),
  );
}

export function scanText(relativePath, content, allowlist = DEFAULT_ALLOWLIST) {
  validateAllowlist(allowlist);
  const offenders = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const token of LEGACY_TOKENS) {
      if (token.pattern.test(line) && !matchesAllowlist(relativePath, line, token.id, allowlist)) {
        offenders.push({
          path: relativePath,
          line: index + 1,
          token: token.id,
          source: line.trim(),
        });
      }
    }
  }
  return offenders;
}

function stripRustTestModules(content) {
  const lines = content.split(/\r?\n/);
  const kept = [];
  let pendingTestModule = false;
  let skipping = false;
  let depth = 0;
  for (const line of lines) {
    if (!skipping && /^\s*#\[cfg\(test\)\]\s*$/.test(line)) {
      pendingTestModule = true;
      continue;
    }
    if (pendingTestModule) {
      if (/^\s*mod\s+\w+\s*\{/.test(line)) {
        skipping = true;
        depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        pendingTestModule = false;
        continue;
      }
      kept.push("#[cfg(test)]");
      pendingTestModule = false;
    }
    if (skipping) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth <= 0) {
        skipping = false;
      }
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function collectFiles(path, skippedDirectoryNames) {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectoryNames.has(entry.name)) continue;
    files.push(...collectFiles(join(path, entry.name), skippedDirectoryNames));
  }
  return files;
}

function shouldSkipSource(relativePath) {
  return (
    relativePath.startsWith("src/test/") ||
    /(?:^|\/)[^/]*test-utils\.(?:ts|tsx)$/.test(relativePath) ||
    /(?:^|\/)tests(?:_[^/]*)?\.rs$/.test(relativePath) ||
    /(?:^|\/)[^/]+_tests(?:_[^/]*)?\.rs$/.test(relativePath) ||
    /(?:^|\/)__snapshots__\//.test(relativePath) ||
    /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs)$/.test(relativePath) ||
    /(?:^|\/)(?:tests|.*_tests)\.rs$/.test(relativePath) ||
    relativePath === "scripts/check-branding.mjs" ||
    relativePath.startsWith("scripts/lib/brandingChecker")
  );
}

export function scanRepository(root, includePaths, allowlist = DEFAULT_ALLOWLIST) {
  const offenders = [];
  const skippedDirectoryNames = new Set([".git", "node_modules", "dist", "target"]);
  for (const includePath of includePaths) {
    const absolute = join(root, includePath);
    for (const file of collectFiles(absolute, skippedDirectoryNames)) {
      const relativePath = relative(root, file).split(/[\\/]+/).join("/");
      if (shouldSkipSource(relativePath)) continue;
      let content = readFileSync(file, "utf8");
      if (relativePath.endsWith(".rs")) content = stripRustTestModules(content);
      offenders.push(...scanText(relativePath, content, allowlist));
    }
  }
  return offenders;
}

function expectEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

export function verifyCanonicalIdentity(root) {
  const failures = [];
  const brand = JSON.parse(readFileSync(join(root, "config/brand.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const tauriDev = JSON.parse(readFileSync(join(root, "src-tauri/tauri.dev.conf.json"), "utf8"));
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");

  expectEqual(packageJson.name, brand.runtime.npmPackage, "package.json name", failures);
  expectEqual(packageJson.version, brand.version, "package.json version", failures);
  expectEqual(packageLock.packages?.[""]?.name, brand.runtime.npmPackage, "package-lock root name", failures);
  expectEqual(packageLock.packages?.[""]?.version, brand.version, "package-lock root version", failures);
  expectEqual(tauri.productName, brand.name, "Tauri productName", failures);
  expectEqual(tauri.version, brand.version, "Tauri version", failures);
  expectEqual(tauri.identifier, brand.bundle.productionIdentifier, "Tauri identifier", failures);
  expectEqual(tauriDev.productName, brand.developmentName, "Tauri dev productName", failures);
  expectEqual(tauriDev.identifier, brand.bundle.developmentIdentifier, "Tauri dev identifier", failures);
  expectEqual(tauri.bundle?.createUpdaterArtifacts, brand.updater.enabled, "Tauri updater artifact state", failures);
  if (brand.updater.enabled === false) {
    expectEqual(tauri.plugins?.updater?.pubkey, "", "Disabled Tauri updater public key", failures);
    expectEqual(tauri.plugins?.updater?.endpoints?.length, 0, "Disabled Tauri updater endpoints", failures);
    expectEqual(tauri.plugins?.updater?.active === true, false, "Disabled Tauri updater activation", failures);
  }

  const cargoExpectations = [
    [`name = "${brand.runtime.cargoPackage}"`, "Cargo package name"],
    [`version = "${brand.version}"`, "Cargo version"],
    [`default-run = "${brand.runtime.mainBinary}"`, "Cargo default binary"],
    [`name = "${brand.runtime.cargoLibrary}"`, "Cargo library"],
    [`name = "${brand.runtime.daemonBinary}"`, "Cargo daemon binary"],
  ];
  for (const [needle, label] of cargoExpectations) {
    if (!cargo.includes(needle)) failures.push(`${label}: missing ${needle}`);
  }

  return { brand, failures };
}
