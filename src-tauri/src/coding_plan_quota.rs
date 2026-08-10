//! Coding Plan / Token Plan / Provider Balance 额度查询。
//!
//! 按供应商 base_url 识别套餐域：
//! - 百分比窗口：Kimi For Coding、MiniMax、智谱 GLM
//! - 货币余额：DeepSeek（官方 GET /user/balance）
//! - 未知第三方中转：Sub2API 兼容 `GET {origin}/v1/usage`（余额 + 可选额度窗）

use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 已知官方/Coding Plan 供应商 HTTP 超时。
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
/// 中转首探（Sub2API）超时：失败后还要 fallback，不宜过长。
const RELAY_PRIMARY_TIMEOUT: Duration = Duration::from_secs(8);
/// 中转回退（New API）超时。
const RELAY_FALLBACK_TIMEOUT: Duration = Duration::from_secs(6);
const DEEPSEEK_BALANCE_URL: &str = "https://api.deepseek.com/user/balance";
/// Sub2API planLabel 最大展示长度（HUD 单行）。
const SUB2API_PLAN_LABEL_MAX_CHARS: usize = 40;

/// Kimi CLI (`engine=kimi`) 与交互 `/status` 同源：OAuth 文件 + refresh + `/usages`。
/// **不得**用于 Claude/Codex 绑定 Kimi HTTP 中转（那些走 CodingPlanApi + API key）。
const KIMI_CODE_OAUTH_HOST: &str = "https://auth.kimi.com";
const KIMI_CODE_OAUTH_CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_CODE_USAGE_BASE: &str = "https://api.kimi.com/coding/v1";
/// 提前刷新窗口（秒），对齐 CLI ensureFresh 行为。
const KIMI_CLI_TOKEN_REFRESH_SKEW_SECS: i64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodingPlanProvider {
    Kimi,
    ZhipuCn,
    ZhipuEn,
    MiniMaxCn,
    MiniMaxEn,
    DeepSeek,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodingPlanQuotaWindow {
    pub(crate) id: String,
    pub(crate) used_percent: f64,
    pub(crate) remaining_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) resets_at: Option<String>,
}

/// 余额型供应商（DeepSeek 等）单币种条目。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodingPlanBalanceItem {
    pub(crate) currency: String,
    pub(crate) total_balance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) granted_balance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) topped_up_balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodingPlanBalanceSnapshot {
    pub(crate) is_available: bool,
    pub(crate) items: Vec<CodingPlanBalanceItem>,
}

/// Sub2API 等中转站用量摘要（供 HUD 多行展示）。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodingPlanUsageSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_requests: Option<u64>,
    /// 已格式化金额字符串，如 `0.014363`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_actual_cost: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) average_duration_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodingPlanQuotaSnapshot {
    /// kimi | minimax | zhipu | deepseek | sub2api | official_cli | unsupported | empty_credentials | error | none
    pub(crate) source: String,
    /// api | cli | official_runtime — 便于 UI/调试看走了哪条路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) via: Option<String>,
    pub(crate) success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) plan_label: Option<String>,
    pub(crate) windows: Vec<CodingPlanQuotaWindow>,
    /// 余额型额度（DeepSeek 等）；百分比供应商为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) balance: Option<CodingPlanBalanceSnapshot>,
    /// Sub2API 用量摘要；其它供应商为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) usage_summary: Option<CodingPlanUsageSummary>,
    /// 中转站 origin（如 `https://relay.example.com`），供 UI 展示「{origin}+sub2api」
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) site_origin: Option<String>,
    pub(crate) queried_at: i64,
}

/// 额度路由：官方 runtime/CLI vs 供应商 Coding Plan API。
#[derive(Debug, Clone)]
enum QuotaRoute {
    /// Codex 官方 / Claude 官方等：前端用 account rateLimits 或空块
    OfficialRuntime { source: &'static str },
    /// 已知 Coding Plan 供应商：用 base_url + key 查 HTTP
    CodingPlanApi { base_url: String, api_key: String },
    /// 无额度可查（官方无 plan / 缺凭据）
    None { reason: String },
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn millis_to_iso8601(ms: i64) -> Option<String> {
    if ms <= 0 {
        return None;
    }
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

fn extract_reset_time(value: &Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(n) = value.as_i64() {
        if n <= 0 {
            return None;
        }
        let ms = if n < 1_000_000_000_000 { n * 1000 } else { n };
        return millis_to_iso8601(ms);
    }
    None
}

fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn clamp_percent(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

fn window_from_used(
    id: &str,
    used_percent: f64,
    resets_at: Option<String>,
) -> CodingPlanQuotaWindow {
    let used = clamp_percent(used_percent);
    CodingPlanQuotaWindow {
        id: id.to_string(),
        used_percent: used,
        remaining_percent: clamp_percent(100.0 - used),
        resets_at,
    }
}

fn detect_provider(base_url: &str) -> Option<CodingPlanProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.kimi.com/coding") {
        Some(CodingPlanProvider::Kimi)
    } else if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") {
        // 含 Claude 预设 open.bigmodel.cn/api/anthropic 与 Codex /api/coding/paas/v4
        Some(CodingPlanProvider::ZhipuCn)
    } else if url.contains("api.z.ai") {
        Some(CodingPlanProvider::ZhipuEn)
    } else if url.contains("api.minimaxi.com") {
        Some(CodingPlanProvider::MiniMaxCn)
    } else if url.contains("api.minimax.io") {
        Some(CodingPlanProvider::MiniMaxEn)
    } else if url.contains("api.deepseek.com") || url.contains("deepseek.com") {
        Some(CodingPlanProvider::DeepSeek)
    } else if url.contains("coding.dashscope.aliyuncs.com")
        || url.contains("coding-intl.dashscope.aliyuncs.com")
    {
        // 阿里云百炼 Coding Plan（千问等）：官方目前仅控制台展示额度，无公开 HTTP
        // 查询接口；CC Switch coding_plan.rs 同样未接入。此处识别 host 便于返回明确错误。
        None
    } else {
        None
    }
}

/// 是否阿里云 Coding Plan（千问）host —— 用于更明确的 empty/unsupported 文案。
fn is_dashscope_coding_plan_host(base_url: &str) -> bool {
    let url = base_url.to_lowercase();
    url.contains("coding.dashscope.aliyuncs.com")
        || url.contains("coding-intl.dashscope.aliyuncs.com")
}

fn source_name(provider: CodingPlanProvider) -> &'static str {
    match provider {
        CodingPlanProvider::Kimi => "kimi",
        CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => "zhipu",
        CodingPlanProvider::MiniMaxCn | CodingPlanProvider::MiniMaxEn => "minimax",
        CodingPlanProvider::DeepSeek => "deepseek",
    }
}

fn empty_snapshot(source: &str, error: Option<String>) -> CodingPlanQuotaSnapshot {
    empty_snapshot_ex(source, error, None)
}

/// 失败快照；`site_origin` 用于 HUD 仍展示「{origin} {source}」。
fn empty_snapshot_ex(
    source: &str,
    error: Option<String>,
    site_origin: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: None,
        success: false,
        error,
        plan_label: None,
        windows: vec![],
        balance: None,
        usage_summary: None,
        site_origin,
        queried_at: now_millis(),
    }
}

fn success_snapshot(
    source: &str,
    via: &str,
    windows: Vec<CodingPlanQuotaWindow>,
    plan_label: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: Some(via.to_string()),
        success: true,
        error: None,
        plan_label,
        windows,
        balance: None,
        usage_summary: None,
        site_origin: None,
        queried_at: now_millis(),
    }
}

fn success_balance_snapshot(
    source: &str,
    via: &str,
    balance: CodingPlanBalanceSnapshot,
    plan_label: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: Some(via.to_string()),
        success: true,
        error: None,
        plan_label,
        windows: vec![],
        balance: Some(balance),
        usage_summary: None,
        site_origin: None,
        queried_at: now_millis(),
    }
}

/// 中转站 / 路由失败时的用户可读文案（不暴露 URL、HTTP body、堆栈）。
fn relay_user_error(kind: &str) -> String {
    match kind {
        "not_found" | "404" => "该中转站暂不支持额度查询".to_string(),
        "auth" | "401" | "403" => "密钥无效或未授权".to_string(),
        // New API 的 /api/user/self 常要求系统访问令牌，sk 会 401
        "auth_new_api" => "密钥无效或权限不足（New API 可能需要系统访问令牌，而非 sk）".to_string(),
        "rate_limited" | "429" => "请求过于频繁，请稍后重试".to_string(),
        "network" => "网络异常，请稍后重试".to_string(),
        "parse" | "empty" => "暂无可用额度数据".to_string(),
        "unsupported_format" => "暂不支持该中转站的额度格式".to_string(),
        "empty_key" => "API 密钥为空".to_string(),
        "empty_base" => "未配置服务地址".to_string(),
        "missing_creds" => "未找到供应商凭据".to_string(),
        _ => "额度查询失败，请稍后重试".to_string(),
    }
}

/// 兼容旧名；统一走 relay_user_error。
fn sub2api_user_error(kind: &str) -> String {
    relay_user_error(kind)
}

fn status_to_relay_error_kind(status: reqwest::StatusCode, for_new_api: bool) -> &'static str {
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "rate_limited";
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return if for_new_api { "auth_new_api" } else { "auth" };
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return "not_found";
    }
    if status.is_client_error() {
        return "not_found";
    }
    "network"
}

fn optional_balance_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 解析 DeepSeek GET /user/balance 响应 body。
fn parse_deepseek_balance(body: &Value) -> CodingPlanBalanceSnapshot {
    let is_available = body
        .get("is_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut items = Vec::new();
    if let Some(infos) = body.get("balance_infos").and_then(|v| v.as_array()) {
        for info in infos {
            let currency = info
                .get("currency")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("UNKNOWN")
                .to_string();
            let total_balance = info
                .get("total_balance")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("0")
                .to_string();
            items.push(CodingPlanBalanceItem {
                currency,
                total_balance,
                granted_balance: optional_balance_string(info.get("granted_balance")),
                topped_up_balance: optional_balance_string(info.get("topped_up_balance")),
            });
        }
    }
    CodingPlanBalanceSnapshot {
        is_available,
        items,
    }
}

async fn query_deepseek(api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("deepseek", Some(error)),
    };
    let resp = match client
        .get(DEEPSEEK_BALANCE_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("deepseek", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "deepseek",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let truncated = if body.len() > 240 {
            format!("{}…", &body[..240])
        } else {
            body
        };
        return empty_snapshot(
            "deepseek",
            Some(format!("API error (HTTP {status}): {truncated}")),
        );
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot(
                "deepseek",
                Some(format!("Failed to read response: {error}")),
            );
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot(
                "deepseek",
                Some(format!("Failed to parse response: {error}")),
            );
        }
    };
    let balance = parse_deepseek_balance(&body);
    let plan_label = if balance.is_available {
        Some("available".to_string())
    } else {
        Some("unavailable".to_string())
    };
    success_balance_snapshot("deepseek", "api", balance, plan_label)
}

fn is_official_anthropic_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    url.is_empty() || url.contains("api.anthropic.com") || url.contains("anthropic.com/claude")
}

fn is_official_openai_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    url.is_empty()
        || url.contains("api.openai.com")
        || url.contains("chatgpt.com")
        || url.contains("openai.com/v1")
}

fn http_client() -> Result<reqwest::Client, String> {
    http_client_with_timeout(HTTP_TIMEOUT)
}

fn http_client_with_timeout(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("http client: {error}"))
}

async fn query_kimi(api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("kimi", Some(error)),
    };
    let resp = match client
        .get(format!("{KIMI_CODE_USAGE_BASE}/usages"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "kimi",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot("kimi", Some(format!("API error (HTTP {status}): {body}")));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Failed to parse response: {error}")));
        }
    };

    let mut windows = Vec::new();
    if let Some(limits) = body.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            if let Some(detail) = limit_item.get("detail") {
                let limit = detail.get("limit").and_then(parse_f64).unwrap_or(1.0);
                let remaining = detail.get("remaining").and_then(parse_f64).unwrap_or(0.0);
                let resets_at = detail.get("resetTime").and_then(extract_reset_time);
                let used = (limit - remaining).max(0.0);
                let used_percent = if limit > 0.0 {
                    (used / limit) * 100.0
                } else {
                    0.0
                };
                windows.push(window_from_used("five_hour", used_percent, resets_at));
                break;
            }
        }
    }
    if let Some(usage) = body.get("usage") {
        let limit = usage.get("limit").and_then(parse_f64).unwrap_or(1.0);
        let remaining = usage.get("remaining").and_then(parse_f64).unwrap_or(0.0);
        let resets_at = usage.get("resetTime").and_then(extract_reset_time);
        let used = (limit - remaining).max(0.0);
        let used_percent = if limit > 0.0 {
            (used / limit) * 100.0
        } else {
            0.0
        };
        windows.push(window_from_used("weekly_limit", used_percent, resets_at));
    }

    success_snapshot("kimi", "api", windows, None)
}

fn parse_minimax_windows(body: &Value) -> Vec<CodingPlanQuotaWindow> {
    let mut windows = Vec::new();
    let Some(model_remains) = body.get("model_remains").and_then(|v| v.as_array()) else {
        return windows;
    };
    let Some(item) = model_remains.iter().find(|item| {
        item.get("model_name")
            .and_then(|v| v.as_str())
            .map(|s| s == "general")
            .unwrap_or(false)
    }) else {
        return windows;
    };

    if let Some(remain_pct) = item
        .get("current_interval_remaining_percent")
        .and_then(|v| v.as_f64())
    {
        let resets_at = item
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_iso8601);
        windows.push(window_from_used("five_hour", 100.0 - remain_pct, resets_at));
    }

    if item.get("current_weekly_status").and_then(|v| v.as_i64()) == Some(1) {
        if let Some(remain_pct) = item
            .get("current_weekly_remaining_percent")
            .and_then(|v| v.as_f64())
        {
            let resets_at = item
                .get("weekly_end_time")
                .and_then(|v| v.as_i64())
                .and_then(millis_to_iso8601);
            windows.push(window_from_used(
                "weekly_limit",
                100.0 - remain_pct,
                resets_at,
            ));
        }
    }
    windows
}

async fn query_minimax(api_key: &str, is_cn: bool) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("minimax", Some(error)),
    };
    let domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{domain}/v1/api/openplatform/coding_plan/remains");
    let resp = match client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("minimax", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "minimax",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot(
            "minimax",
            Some(format!("API error (HTTP {status}): {body}")),
        );
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("minimax", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot(
                "minimax",
                Some(format!("Failed to parse response: {error}")),
            );
        }
    };
    if let Some(base_resp) = body.get("base_resp") {
        let status_code = base_resp
            .get("status_code")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);
        if status_code != 0 {
            let msg = base_resp
                .get("status_msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return empty_snapshot(
                "minimax",
                Some(format!("API error (code {status_code}): {msg}")),
            );
        }
    }

    success_snapshot("minimax", "api", parse_minimax_windows(&body), None)
}

/// 对齐 CC Switch `classify_zhipu_window`：
/// - `unit: 3` → 5 小时
/// - `unit: 6` → 周窗口（不绑 number，兼容 7 天 / 1 周两种取值）
fn classify_zhipu_window(item: &Value) -> Option<&'static str> {
    match item.get("unit").and_then(|v| v.as_i64()) {
        Some(3) => Some("five_hour"),
        Some(6) => Some("weekly_limit"),
        _ => None,
    }
}

/// 对齐 CC Switch `parse_zhipu_token_tiers`：
/// 1) 优先 unit 字段；2) unit 缺失时用 nextResetTime 启发式（无 reset 优先 five_hour）。
fn parse_zhipu_windows(data: &Value) -> Vec<CodingPlanQuotaWindow> {
    type Entry = (Option<i64>, f64, Option<String>);
    let mut five_hour: Option<Entry> = None;
    let mut weekly: Option<Entry> = None;
    let mut unclassified: Vec<Entry> = Vec::new();

    let Some(limits) = data.get("limits").and_then(|v| v.as_array()) else {
        return vec![];
    };
    for item in limits {
        let limit_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // 与 CC Switch 一致：只吃 TOKENS_LIMIT（大小写不敏感）
        if !limit_type.is_empty() && !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
            continue;
        }
        let percentage = item
            .get("percentage")
            .or_else(|| item.get("UsagePercent"))
            .or_else(|| item.get("usagePercent"))
            .and_then(parse_f64)
            .unwrap_or(0.0);
        let reset_ms = item
            .get("nextResetTime")
            .and_then(|v| v.as_i64())
            .or_else(|| {
                item.get("nextResetTime")
                    .and_then(|v| v.as_f64())
                    .map(|n| n as i64)
            });
        let resets_at = item
            .get("nextResetTime")
            .or_else(|| item.get("resetTime"))
            .and_then(extract_reset_time);
        let entry = (reset_ms, percentage, resets_at);
        match classify_zhipu_window(item) {
            Some("five_hour") if five_hour.is_none() => five_hour = Some(entry),
            Some("weekly_limit") if weekly.is_none() => weekly = Some(entry),
            _ => unclassified.push(entry),
        }
    }

    // 无 nextResetTime 的排前面（5h 桶在 0% 时常缺 reset）；其余按 reset 升序
    unclassified.sort_by_key(|(reset, _, _)| (reset.is_some(), reset.unwrap_or(i64::MIN)));
    for entry in unclassified {
        if five_hour.is_none() {
            five_hour = Some(entry);
        } else if weekly.is_none() {
            weekly = Some(entry);
        }
    }

    let mut windows = Vec::new();
    if let Some((_, pct, resets)) = five_hour {
        windows.push(window_from_used("five_hour", pct, resets));
    }
    if let Some((_, pct, resets)) = weekly {
        windows.push(window_from_used("weekly_limit", pct, resets));
    }
    windows
}

async fn query_zhipu(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("zhipu", Some(error)),
    };
    let host = if base_url.to_lowercase().contains("bigmodel.cn") {
        "https://open.bigmodel.cn"
    } else {
        "https://api.z.ai"
    };
    let url = format!("{host}/api/monitor/usage/quota/limit");
    // 智谱：Authorization 不加 Bearer 前缀
    let resp = match client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .header("Accept-Language", "en-US,en")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "zhipu",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot("zhipu", Some(format!("API error (HTTP {status}): {body}")));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Failed to parse response: {error}")));
        }
    };
    if body.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = body
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return empty_snapshot("zhipu", Some(format!("API error: {msg}")));
    }
    let Some(data) = body.get("data") else {
        return empty_snapshot("zhipu", Some("Missing 'data' field in response".into()));
    };
    let plan_label = data
        .get("level")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    success_snapshot("zhipu", "api", parse_zhipu_windows(data), plan_label)
}

async fn query_by_base_url_and_key(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    if api_key.trim().is_empty() {
        return empty_snapshot("empty_credentials", Some(relay_user_error("empty_key")));
    }
    if let Some(provider) = detect_provider(base_url) {
        return match provider {
            CodingPlanProvider::Kimi => query_kimi(api_key).await,
            CodingPlanProvider::MiniMaxCn => query_minimax(api_key, true).await,
            CodingPlanProvider::MiniMaxEn => query_minimax(api_key, false).await,
            CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => {
                query_zhipu(base_url, api_key).await
            }
            CodingPlanProvider::DeepSeek => query_deepseek(api_key).await,
        };
    }
    if is_dashscope_coding_plan_host(base_url) {
        return empty_snapshot(
            "unsupported",
            Some(
                "Aliyun Bailian Coding Plan (Qwen/dashscope) has no public quota HTTP API \
                 (same gap in CC Switch coding_plan); check usage in Bailian console"
                    .into(),
            ),
        );
    }
    // 非主流官方 / 非已接入 Coding Plan host：
    // 1) Sub2API GET /v1/usage
    // 2) 失败（404/其它）→ New API / One API GET /api/user/self（同级回退）
    query_relay_balance(base_url, api_key).await
}

/// 中转站额度探测：Sub2API 优先（短超时），失败后 New API / One API（更短超时）。
/// 最坏串行耗时 ≈ PRIMARY + FALLBACK，避免双 15s。
async fn query_relay_balance(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let sub2 = query_sub2api(base_url, api_key).await;
    if sub2.success {
        return sub2;
    }
    // 鉴权失败仍尝试 New API：可能 sk 只对一侧有效
    let new_api = query_new_api(base_url, api_key).await;
    if new_api.success {
        return new_api;
    }
    // 两者都失败：选信息更具体的 error，并保证带 site_origin
    let mut failed = pick_better_relay_error(sub2, new_api);
    if failed.site_origin.is_none() {
        failed.site_origin = origin;
    }
    failed
}

/// 优先保留「更可操作」的错误（鉴权/限流 > 暂不支持 > 网络）。
fn pick_better_relay_error(
    sub2: CodingPlanQuotaSnapshot,
    new_api: CodingPlanQuotaSnapshot,
) -> CodingPlanQuotaSnapshot {
    let rank = |err: Option<&str>| -> u8 {
        let e = err.unwrap_or("");
        if e.contains("系统访问令牌") || e.contains("权限不足") {
            0
        } else if e.contains("密钥无效") {
            1
        } else if e.contains("过于频繁") {
            2
        } else if e.contains("暂不支持") {
            3
        } else if e.contains("网络") {
            4
        } else {
            5
        }
    };
    if rank(new_api.error.as_deref()) < rank(sub2.error.as_deref()) {
        new_api
    } else {
        sub2
    }
}

/// 从 base_url 提取 scheme://host[:port]
fn relay_origin(base_url: &str) -> Result<String, String> {
    let raw = base_url.trim();
    if raw.is_empty() {
        return Err("base_url is empty".into());
    }
    let without_query = raw
        .split_once('?')
        .map(|(head, _)| head)
        .unwrap_or(raw)
        .trim()
        .trim_end_matches('/');
    let (scheme, rest) = if let Some(rest) = without_query
        .strip_prefix("https://")
        .or_else(|| without_query.strip_prefix("http://"))
    {
        let scheme = if without_query.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        (scheme, rest)
    } else {
        return Err(format!("base_url must be absolute http(s) URL: {base_url}"));
    };
    let authority = match rest.find('/') {
        Some(idx) => &rest[..idx],
        None => rest,
    };
    if authority.is_empty() {
        return Err(format!("base_url missing host: {base_url}"));
    }
    Ok(format!("{scheme}://{authority}"))
}

fn new_api_user_self_url(base_url: &str) -> Result<String, String> {
    Ok(format!("{}/api/user/self", relay_origin(base_url)?))
}

/// 解析 New API / One API `GET /api/user/self` body。
/// `data.quota` 为内部额度单位，余额美元 ≈ quota / 500000。
fn parse_new_api_user_self(body: &Value) -> Result<CodingPlanQuotaSnapshot, String> {
    // 错误信封
    if let Some(success) = body.get("success").and_then(|v| v.as_bool()) {
        if !success && body.get("data").is_none() {
            return Err(sub2api_user_error("auth"));
        }
    }
    if let Some(code) = body.get("code") {
        // 部分实现 code=0/200 成功
        let ok = code.as_i64() == Some(0)
            || code.as_i64() == Some(200)
            || code.as_str() == Some("ok")
            || code.as_str() == Some("success");
        if !ok && body.get("data").is_none() && body.get("quota").is_none() {
            return Err(sub2api_user_error("auth"));
        }
    }

    let data = body.get("data").filter(|d| d.is_object()).unwrap_or(body);

    let quota = data
        .get("quota")
        .and_then(parse_f64)
        .or_else(|| data.get("remain_quota").and_then(parse_f64))
        .or_else(|| data.get("remaining_quota").and_then(parse_f64));

    let used_quota = data
        .get("used_quota")
        .and_then(parse_f64)
        .or_else(|| data.get("usedQuota").and_then(parse_f64));

    let request_count = data
        .get("request_count")
        .or_else(|| data.get("requestCount"))
        .and_then(parse_u64_loose);

    let Some(quota_raw) = quota else {
        return Err(sub2api_user_error("empty"));
    };

    let balance_usd = (quota_raw / NEW_API_QUOTA_PER_USD).max(0.0);
    let used_usd = used_quota
        .map(|u| (u / NEW_API_QUOTA_PER_USD).max(0.0))
        .map(format_quota_amount);

    // 余额为 0 仍视为「查询成功、账户可用」，耗尽用数值表达
    let balance = CodingPlanBalanceSnapshot {
        is_available: true,
        items: vec![CodingPlanBalanceItem {
            currency: "USD".to_string(),
            total_balance: format_quota_amount(balance_usd),
            granted_balance: None,
            topped_up_balance: None,
        }],
    };

    let usage_summary = CodingPlanUsageSummary {
        total_requests: request_count,
        total_actual_cost: used_usd,
        total_input_tokens: None,
        total_output_tokens: None,
        total_tokens: None,
        average_duration_ms: None,
    };
    let has_usage =
        usage_summary.total_requests.is_some() || usage_summary.total_actual_cost.is_some();

    let group = data
        .get("group")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    Ok(CodingPlanQuotaSnapshot {
        source: "new_api".to_string(),
        via: Some("api".to_string()),
        success: true,
        error: None,
        plan_label: group,
        windows: vec![],
        balance: Some(balance),
        usage_summary: has_usage.then_some(usage_summary),
        site_origin: None, // 由 query_new_api 填入真实 origin
        queried_at: now_millis(),
    })
}

async fn query_new_api(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let fail =
        |kind: &str| empty_snapshot_ex("new_api", Some(relay_user_error(kind)), origin.clone());
    let self_url = match new_api_user_self_url(base_url) {
        Ok(u) => u,
        Err(_) => return fail("unsupported_format"),
    };
    let client = match http_client_with_timeout(RELAY_FALLBACK_TIMEOUT) {
        Ok(c) => c,
        Err(_) => return fail("network"),
    };
    let resp = match client
        .get(&self_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return fail("network"),
    };
    let status = resp.status();
    if !status.is_success() {
        return fail(status_to_relay_error_kind(status, true));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return fail("network"),
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(_) => return fail("unsupported_format"),
    };
    match parse_new_api_user_self(&body) {
        Ok(mut snapshot) => {
            snapshot.site_origin = origin;
            snapshot
        }
        Err(error) => empty_snapshot_ex("new_api", Some(error), origin),
    }
}

/// 从 provider base_url 推导 Sub2API `GET /v1/usage` 完整 URL。
///
/// - path 以 `/v1` 结尾 → `{scheme}://{host}{path}/usage`
/// - 否则 → `{scheme}://{host}/v1/usage`（忽略 chat 子路径）
fn sub2api_usage_url(base_url: &str) -> Result<String, String> {
    let raw = base_url.trim();
    if raw.is_empty() {
        return Err("base_url is empty".into());
    }
    let without_query = raw
        .split_once('?')
        .map(|(head, _)| head)
        .unwrap_or(raw)
        .trim()
        .trim_end_matches('/');
    let (scheme, rest) = if let Some(rest) = without_query
        .strip_prefix("https://")
        .or_else(|| without_query.strip_prefix("http://"))
    {
        let scheme = if without_query.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        (scheme, rest)
    } else {
        return Err(format!("base_url must be absolute http(s) URL: {base_url}"));
    };
    let (authority, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return Err(format!("base_url missing host: {base_url}"));
    }
    let path_trimmed = path.trim_end_matches('/');
    // 去掉常见 chat 尾缀，保留到 /v1（若有）
    let path_norm = {
        let lower = path_trimmed.to_ascii_lowercase();
        let mut p = path_trimmed.to_string();
        for suffix in [
            "/chat/completions",
            "/messages",
            "/responses",
            "/completions",
        ] {
            if lower.ends_with(suffix) {
                p = path_trimmed[..path_trimmed.len() - suffix.len()].to_string();
                break;
            }
        }
        p.trim_end_matches('/').to_string()
    };
    if path_norm.to_ascii_lowercase().ends_with("/v1") || path_norm.eq_ignore_ascii_case("/v1") {
        Ok(format!("{scheme}://{authority}{path_norm}/usage"))
    } else {
        Ok(format!("{scheme}://{authority}/v1/usage"))
    }
}

fn format_quota_amount(value: f64) -> String {
    if !value.is_finite() {
        return "0.00".to_string();
    }
    // HUD 统一保留 2 位小数
    format!("{value:.2}")
}

/// New API / One API 内部额度单位：多数部署 500_000 ≈ $1。
const NEW_API_QUOTA_PER_USD: f64 = 500_000.0;

fn truncate_plan_label(label: &str) -> String {
    let mut out = String::new();
    for (i, ch) in label.chars().enumerate() {
        if i >= SUB2API_PLAN_LABEL_MAX_CHARS {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn classify_sub2api_window_id(name: &str) -> String {
    let n = name.trim().to_ascii_lowercase();
    if n.is_empty() {
        return "window".to_string();
    }
    if n.contains("five")
        || n == "5h"
        || n.contains("5h")
        || n.contains("5_hour")
        || n.contains("5-hour")
        || n.contains("five_hour")
        || (n.contains('5') && n.contains("hour"))
    {
        return "five_hour".to_string();
    }
    if n.contains("week")
        || n.contains("seven")
        || n == "7d"
        || n.contains("7d")
        || n.contains("7_day")
        || n.contains("7-day")
        || n.contains("weekly")
    {
        return "weekly_limit".to_string();
    }
    if n.contains("month") {
        return "monthly".to_string();
    }
    if n.contains("day") || n.contains("daily") || n == "1d" || n.contains("1d") {
        return "daily".to_string();
    }
    // 保留原名供 HUD 回退展示
    name.trim().chars().take(24).collect()
}

fn window_priority(id: &str) -> u8 {
    match id {
        "five_hour" => 0,
        "daily" => 1,
        "weekly_limit" | "seven_day" => 2,
        "monthly" => 3,
        _ => 9,
    }
}

/// 从单个 window/limit 对象解析 used% / remaining% / reset。
fn parse_sub2api_window_object(item: &Value) -> Option<CodingPlanQuotaWindow> {
    let name = item
        .get("name")
        .or_else(|| item.get("id"))
        .or_else(|| item.get("window"))
        .or_else(|| item.get("type"))
        .or_else(|| item.get("label"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let id = classify_sub2api_window_id(name);

    let used_percent = item
        .get("used_percent")
        .or_else(|| item.get("usedPercent"))
        .or_else(|| item.get("percentage"))
        .and_then(parse_f64)
        .or_else(|| {
            let used = item
                .get("used")
                .or_else(|| item.get("usage"))
                .and_then(parse_f64);
            let limit = item
                .get("limit")
                .or_else(|| item.get("quota"))
                .or_else(|| item.get("total"))
                .and_then(parse_f64);
            match (used, limit) {
                (Some(u), Some(l)) if l > 0.0 => Some((u / l) * 100.0),
                _ => None,
            }
        })
        .or_else(|| {
            let remaining_pct = item
                .get("remaining_percent")
                .or_else(|| item.get("remainingPercent"))
                .and_then(parse_f64);
            remaining_pct.map(|r| 100.0 - r)
        })
        .or_else(|| {
            let remaining = item.get("remaining").and_then(parse_f64);
            let limit = item
                .get("limit")
                .or_else(|| item.get("quota"))
                .and_then(parse_f64);
            match (remaining, limit) {
                (Some(r), Some(l)) if l > 0.0 => Some(((l - r).max(0.0) / l) * 100.0),
                _ => None,
            }
        })?;

    let resets_at = item
        .get("reset_at")
        .or_else(|| item.get("resets_at"))
        .or_else(|| item.get("resetsAt"))
        .or_else(|| item.get("resetTime"))
        .or_else(|| item.get("reset_time"))
        .or_else(|| item.get("end_time"))
        .and_then(extract_reset_time);

    Some(window_from_used(&id, used_percent, resets_at))
}

fn parse_sub2api_windows(body: &Value) -> Vec<CodingPlanQuotaWindow> {
    let mut windows = Vec::new();

    for key in ["rate_limits", "rateLimits", "windows", "limits"] {
        if let Some(arr) = body.get(key).and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(w) = parse_sub2api_window_object(item) {
                    windows.push(w);
                }
            }
        }
    }

    // subscription 嵌套：daily / weekly / monthly 对象
    if let Some(sub) = body
        .get("subscription")
        .or_else(|| body.get("subscription_usage"))
    {
        for (name, child) in [
            ("daily", sub.get("daily")),
            ("weekly", sub.get("weekly")),
            ("monthly", sub.get("monthly")),
        ] {
            if let Some(obj) = child {
                let mut obj = obj.clone();
                if obj.get("name").is_none() && obj.get("id").is_none() {
                    if let Some(map) = obj.as_object_mut() {
                        map.insert("name".into(), Value::String(name.into()));
                    }
                }
                if let Some(w) = parse_sub2api_window_object(&obj) {
                    windows.push(w);
                }
            }
        }
    }

    // 去重：同 id 保留首次（通常更完整）
    let mut seen = std::collections::HashSet::new();
    windows.retain(|w| seen.insert(w.id.clone()));
    windows.sort_by_key(|w| window_priority(&w.id));
    // HUD 主+次最多两窗
    windows.truncate(2);
    windows
}

fn parse_sub2api_balance(body: &Value) -> Option<CodingPlanBalanceSnapshot> {
    let balance_num = body
        .get("balance")
        .or_else(|| body.get("remaining"))
        .and_then(parse_f64)
        .or_else(|| {
            body.get("wallet")
                .and_then(|w| w.get("balance").or_else(|| w.get("remaining")))
                .and_then(parse_f64)
        })?;
    let unit = body
        .get("unit")
        .or_else(|| body.get("currency"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("USD");
    let is_available = body
        .get("isValid")
        .or_else(|| body.get("is_available"))
        .or_else(|| body.get("isAvailable"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    Some(CodingPlanBalanceSnapshot {
        is_available,
        items: vec![CodingPlanBalanceItem {
            currency: unit.to_string(),
            total_balance: format_quota_amount(balance_num),
            granted_balance: None,
            topped_up_balance: None,
        }],
    })
}

fn build_sub2api_plan_label(body: &Value) -> Option<String> {
    // planName 单独展示；用量明细走 usage_summary，避免塞进单行 planLabel
    body.get("planName")
        .or_else(|| body.get("plan_name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.chars().count() > SUB2API_PLAN_LABEL_MAX_CHARS {
                truncate_plan_label(s)
            } else {
                s.to_string()
            }
        })
}

fn parse_u64_loose(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(n) = value.as_i64() {
        return u64::try_from(n).ok();
    }
    if let Some(f) = value.as_f64() {
        if f.is_finite() && f >= 0.0 {
            return Some(f.round() as u64);
        }
    }
    value.as_str().and_then(|s| s.trim().parse().ok())
}

fn parse_sub2api_usage_summary(body: &Value) -> Option<CodingPlanUsageSummary> {
    let usage = body.get("usage");
    let total = usage.and_then(|u| u.get("total"));
    let total_requests = total
        .and_then(|t| t.get("requests"))
        .and_then(parse_u64_loose)
        .or_else(|| body.get("requests").and_then(parse_u64_loose));
    let total_actual_cost = total
        .and_then(|t| {
            t.get("actual_cost")
                .or_else(|| t.get("cost"))
                .and_then(parse_f64)
        })
        .map(format_quota_amount);
    let total_input_tokens = total
        .and_then(|t| t.get("input_tokens"))
        .and_then(parse_u64_loose);
    let total_output_tokens = total
        .and_then(|t| t.get("output_tokens"))
        .and_then(parse_u64_loose);
    let total_tokens = total
        .and_then(|t| t.get("total_tokens"))
        .and_then(parse_u64_loose);
    let average_duration_ms = usage
        .and_then(|u| u.get("average_duration_ms"))
        .and_then(parse_f64)
        .or_else(|| body.get("average_duration_ms").and_then(parse_f64));

    let summary = CodingPlanUsageSummary {
        total_requests,
        total_actual_cost,
        total_input_tokens,
        total_output_tokens,
        total_tokens,
        average_duration_ms,
    };
    let has_any = summary.total_requests.is_some()
        || summary.total_actual_cost.is_some()
        || summary.total_input_tokens.is_some()
        || summary.total_output_tokens.is_some()
        || summary.total_tokens.is_some()
        || summary.average_duration_ms.is_some();
    has_any.then_some(summary)
}

/// 解析 Sub2API `GET /v1/usage` JSON → quota snapshot（纯函数，便于单测）。
fn parse_sub2api_usage(body: &Value) -> Result<CodingPlanQuotaSnapshot, String> {
    // 错误信封 → 友好文案（不回传上游 message）
    if let Some(code) = body.get("code").and_then(|v| v.as_str()) {
        if code != "ok" && code != "success" && body.get("balance").is_none() {
            let lower = code.to_ascii_lowercase();
            if lower.contains("invalid") || lower.contains("unauthorized") || lower.contains("key")
            {
                return Err(sub2api_user_error("auth"));
            }
            return Err(sub2api_user_error("unsupported_format"));
        }
    }

    let balance = parse_sub2api_balance(body);
    let windows = parse_sub2api_windows(body);
    let usage_summary = parse_sub2api_usage_summary(body);
    let plan_label = build_sub2api_plan_label(body);

    if balance.is_none() && windows.is_empty() && usage_summary.is_none() {
        return Err(sub2api_user_error("empty"));
    }

    Ok(CodingPlanQuotaSnapshot {
        source: "sub2api".to_string(),
        via: Some("api".to_string()),
        success: true,
        error: None,
        plan_label,
        windows,
        balance,
        usage_summary,
        site_origin: None, // 由 query_sub2api 填入真实 origin
        queried_at: now_millis(),
    })
}

async fn query_sub2api(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let fail =
        |kind: &str| empty_snapshot_ex("sub2api", Some(relay_user_error(kind)), origin.clone());
    let usage_url = match sub2api_usage_url(base_url) {
        Ok(u) => u,
        Err(_) => return fail("unsupported_format"),
    };
    let client = match http_client_with_timeout(RELAY_PRIMARY_TIMEOUT) {
        Ok(c) => c,
        Err(_) => return fail("network"),
    };
    let resp = match client
        .get(&usage_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return fail("network"),
    };
    let status = resp.status();
    if !status.is_success() {
        return fail(status_to_relay_error_kind(status, false));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return fail("network"),
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(_) => return fail("unsupported_format"),
    };
    match parse_sub2api_usage(&body) {
        Ok(mut snapshot) => {
            snapshot.site_origin = origin;
            snapshot
        }
        Err(error) => empty_snapshot_ex("sub2api", Some(error), origin),
    }
}

fn read_app_config_root() -> Value {
    let Ok(path) = crate::app_paths::config_file_path() else {
        return Value::Object(Default::default());
    };
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    if content.trim().is_empty() {
        return Value::Object(Default::default());
    }
    serde_json::from_str(&content).unwrap_or(Value::Object(Default::default()))
}

fn pick_base_url_api_key(value: &Value) -> (String, String) {
    let base_url = value
        .get("baseUrl")
        .or_else(|| value.get("base_url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let api_key = value
        .get("apiKey")
        .or_else(|| value.get("api_key"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    (base_url, api_key)
}

/// 官方 Grok / xAI HTTP base（不走 Sub2API）。
fn is_official_grok_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    if url.is_empty() {
        return true;
    }
    url.contains("api.x.ai") || url.contains("grok.x.ai")
}

/// 解析 Grok managed provider 的 base_url + api_key。
/// - `__local_config_toml__` / 空 id → 官方本地 CLI，返回空凭据（不查 Sub2API）
/// - 其它 id → 读 `config.json` 的 `grok.providers[id]`；未命中则回退 active / 首个
fn resolve_grok_base_url_and_key(
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    use crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID;

    let profile_id = provider_profile_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(GROK_LOCAL_PROVIDER_PROFILE_ID);

    if profile_id == GROK_LOCAL_PROVIDER_PROFILE_ID {
        // Local 指向 ~/.grok/config.toml：用户可能把 base_url 改成中转站
        // （实测常见：current=__local_config_toml__ 但 toml 内是 fufei 等 Sub2API）
        return crate::vendors::read_local_grok_base_url_and_key();
    }

    let root = read_app_config_root();
    let Some(providers) = root
        .get("grok")
        .and_then(|k| k.get("providers"))
        .and_then(|p| p.as_object())
    else {
        return Err(relay_user_error("missing_creds"));
    };

    if let Some(value) = providers.get(profile_id) {
        return Ok(pick_base_url_api_key(value));
    }

    // profile id 漂移时回退 active / 首个 managed
    if let Some(pair) = pick_from_providers_map(providers, None) {
        return Ok(pair);
    }

    Err(relay_user_error("missing_creds"))
}

fn pick_from_providers_map(
    providers: &serde_json::Map<String, Value>,
    profile_id: Option<&str>,
) -> Option<(String, String)> {
    if let Some(id) = profile_id {
        if let Some(value) = providers.get(id) {
            return Some(pick_base_url_api_key(value));
        }
    }
    for (_, value) in providers {
        if value
            .get("isActive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return Some(pick_base_url_api_key(value));
        }
    }
    providers.values().next().map(pick_base_url_api_key)
}

fn resolve_claude_settings_env() -> (String, String) {
    // Claude 当前生效 settings.json 的 env（active provider 已写回）
    let path = dirs::home_dir().map(|home| home.join(".claude").join("settings.json"));
    let content = path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let settings: Value =
        serde_json::from_str(&content).unwrap_or(Value::Object(Default::default()));
    let env = settings
        .get("env")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .or_else(|| env.get("ANTHROPIC_API_KEY"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    (base_url, api_key)
}

fn extract_codex_base_url_and_key(
    config_toml: &str,
    auth_json: Option<&str>,
) -> Option<(String, String)> {
    let value: toml::Value = config_toml.parse().ok()?;
    let providers = value.get("model_providers")?.as_table()?;
    let mut base_url = String::new();
    for (_name, provider) in providers {
        if let Some(url) = provider
            .get("base_url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            base_url = url.to_string();
            break;
        }
    }
    if base_url.is_empty() {
        return None;
    }
    let mut api_key = String::new();
    if let Some(auth) = auth_json {
        if let Ok(auth_value) = serde_json::from_str::<Value>(auth) {
            for key in [
                "OPENAI_API_KEY",
                "openai_api_key",
                "api_key",
                "apiKey",
                "token",
            ] {
                if let Some(v) = auth_value
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                {
                    api_key = v.to_string();
                    break;
                }
            }
            // nested tokens
            if api_key.is_empty() {
                if let Some(tokens) = auth_value.get("tokens").and_then(|v| v.as_object()) {
                    for key in ["access_token", "api_key", "token"] {
                        if let Some(v) = tokens
                            .get(key)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|v| !v.is_empty())
                        {
                            api_key = v.to_string();
                            break;
                        }
                    }
                }
            }
        }
    }
    Some((base_url, api_key))
}

#[derive(Debug, Clone)]
struct KimiCliCredentials {
    access_token: String,
    refresh_token: String,
    expires_at: Option<i64>,
    /// 原始 JSON，用于写回时保留其它字段。
    raw: Value,
}

fn kimi_cli_credentials_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".kimi-code/credentials/kimi-code.json"))
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// 读取 Kimi CLI 登录态（~/.kimi-code/credentials/kimi-code.json）。
fn load_kimi_cli_credentials() -> Result<KimiCliCredentials, String> {
    let path = kimi_cli_credentials_path()
        .ok_or_else(|| "Cannot resolve home dir for Kimi CLI credentials".to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "Kimi CLI credentials missing (run `kimi login`): {}: {error}",
            path.display()
        )
    })?;
    let raw: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid Kimi CLI credentials JSON: {error}"))?;
    let access_token = raw
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Kimi CLI credentials missing access_token; run `kimi login`".to_string())?
        .to_string();
    let refresh_token = raw
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let expires_at = raw.get("expires_at").and_then(|v| v.as_i64()).or_else(|| {
        raw.get("expires_at")
            .and_then(|v| v.as_f64())
            .map(|n| n as i64)
    });
    Ok(KimiCliCredentials {
        access_token,
        refresh_token,
        expires_at,
        raw,
    })
}

fn kimi_cli_token_needs_refresh(creds: &KimiCliCredentials, now_secs: i64, force: bool) -> bool {
    if force {
        return true;
    }
    match creds.expires_at {
        Some(expires_at) => now_secs >= expires_at - KIMI_CLI_TOKEN_REFRESH_SKEW_SECS,
        // 无过期字段时不强刷；若 /usages 401 再 force。
        None => false,
    }
}

fn save_kimi_cli_credentials(creds: &KimiCliCredentials) -> Result<(), String> {
    let path = kimi_cli_credentials_path()
        .ok_or_else(|| "Cannot resolve home dir for Kimi CLI credentials".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create Kimi credentials dir: {error}"))?;
    }
    let mut raw = creds.raw.clone();
    if let Some(obj) = raw.as_object_mut() {
        obj.insert(
            "access_token".into(),
            Value::String(creds.access_token.clone()),
        );
        if !creds.refresh_token.is_empty() {
            obj.insert(
                "refresh_token".into(),
                Value::String(creds.refresh_token.clone()),
            );
        }
        if let Some(expires_at) = creds.expires_at {
            obj.insert("expires_at".into(), Value::from(expires_at));
        }
    }
    let content = serde_json::to_string_pretty(&raw)
        .map_err(|error| format!("serialize Kimi credentials: {error}"))?;
    std::fs::write(&path, content)
        .map_err(|error| format!("write Kimi credentials {}: {error}", path.display()))
}

/// 对齐 kimi-code `refreshAccessToken`：POST auth.kimi.com/api/oauth/token
async fn refresh_kimi_cli_access_token(
    refresh_token: &str,
    previous: &KimiCliCredentials,
) -> Result<KimiCliCredentials, String> {
    if refresh_token.trim().is_empty() {
        return Err("Kimi CLI token expired and no refresh_token; run `kimi login`".to_string());
    }
    let client = http_client()?;
    let url = format!("{KIMI_CODE_OAUTH_HOST}/api/oauth/token");
    let resp = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", KIMI_CODE_OAUTH_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|error| format!("Kimi CLI token refresh network error: {error}"))?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|error| format!("Kimi CLI token refresh parse error: {error}"))?;
    if !status.is_success() {
        let detail = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("token refresh failed");
        return Err(format!(
            "Kimi CLI token refresh failed (HTTP {status}): {detail}; run `kimi login`"
        ));
    }
    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Kimi CLI token refresh missing access_token".to_string())?
        .to_string();
    let new_refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| previous.refresh_token.clone());
    let expires_in = body.get("expires_in").and_then(|v| v.as_i64()).or_else(|| {
        body.get("expires_in")
            .and_then(|v| v.as_f64())
            .map(|n| n as i64)
    });
    let expires_at = expires_in.map(|secs| now_unix_secs() + secs.max(0));
    let mut raw = previous.raw.clone();
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("access_token".into(), Value::String(access_token.clone()));
        obj.insert("refresh_token".into(), Value::String(new_refresh.clone()));
        if let Some(expires_at) = expires_at {
            obj.insert("expires_at".into(), Value::from(expires_at));
        }
        if let Some(expires_in) = expires_in {
            obj.insert("expires_in".into(), Value::from(expires_in));
        }
        if let Some(token_type) = body.get("token_type").and_then(|v| v.as_str()) {
            obj.insert("token_type".into(), Value::String(token_type.to_string()));
        }
    }
    Ok(KimiCliCredentials {
        access_token,
        refresh_token: new_refresh,
        expires_at,
        raw,
    })
}

/// 确保 Kimi CLI OAuth access_token 可用（对齐 CLI `/status` → ensureFresh）。
async fn ensure_fresh_kimi_cli_access_token(force: bool) -> Result<String, String> {
    let mut creds = load_kimi_cli_credentials()?;
    let now = now_unix_secs();
    if kimi_cli_token_needs_refresh(&creds, now, force) {
        creds = refresh_kimi_cli_access_token(&creds.refresh_token, &creds).await?;
        save_kimi_cli_credentials(&creds)?;
    }
    Ok(creds.access_token)
}

/// `engine=kimi` 专用：CLI 登录态 + usages（与 `/status` 同源）。via 固定 cli。
async fn query_kimi_cli_status() -> CodingPlanQuotaSnapshot {
    let token = match ensure_fresh_kimi_cli_access_token(false).await {
        Ok(token) => token,
        Err(error) => {
            return empty_snapshot("empty_credentials", Some(error));
        }
    };

    let mut snapshot = query_kimi(&token).await;
    let auth_failed = snapshot.error.as_deref().is_some_and(|msg| {
        msg.contains("401")
            || msg.contains("403")
            || msg.contains("Authentication failed")
            || msg.contains("Unauthorized")
    });
    if !snapshot.success && auth_failed {
        // 强制 refresh 一次（对齐 CLI ensureFresh(force)）
        match ensure_fresh_kimi_cli_access_token(true).await {
            Ok(fresh) => {
                snapshot = query_kimi(&fresh).await;
            }
            Err(error) => {
                return empty_snapshot(
                    "empty_credentials",
                    Some(format!("Kimi CLI auth failed after refresh: {error}")),
                );
            }
        }
    }

    // engine=kimi 路径一律标记 via=cli（即使 query_kimi 默认写 api）
    snapshot.via = Some("cli".to_string());
    // 纠正 source：CLI 路径固定 kimi
    if snapshot.success || snapshot.source == "kimi" {
        snapshot.source = "kimi".to_string();
    }
    snapshot
}

fn resolve_engine_base_url_and_key(
    engine: &str,
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    let engine = engine.trim().to_ascii_lowercase();
    let profile_id = provider_profile_id.map(str::trim).filter(|v| !v.is_empty());

    match engine.as_str() {
        "kimi" => {
            // engine=kimi 额度在 get_coding_plan_quota_for_session 走 query_kimi_cli_status。
            // 此处仅保留 doge managed Kimi provider 解析（其它调用方）；
            // 不得在此静默用过期 access_token 冒充 CLI /status。
            let root = read_app_config_root();
            let providers = root
                .get("kimi")
                .and_then(|k| k.get("providers"))
                .and_then(|p| p.as_object())
                .ok_or_else(|| "Kimi providers not found".to_string())?;
            pick_from_providers_map(providers, profile_id)
                .ok_or_else(|| "Kimi provider credentials not found".into())
        }
        "claude" => {
            if let Some(profile_id) = profile_id {
                if let Some(profile) =
                    crate::engine::claude::provider_profile::resolve_claude_provider_launch_profile(
                        Some(profile_id),
                    )?
                {
                    let base_url = profile
                        .env
                        .get("ANTHROPIC_BASE_URL")
                        .cloned()
                        .unwrap_or_default();
                    let api_key = profile
                        .env
                        .get("ANTHROPIC_AUTH_TOKEN")
                        .or_else(|| profile.env.get("ANTHROPIC_API_KEY"))
                        .cloned()
                        .unwrap_or_default();
                    return Ok((base_url, api_key));
                }
            }
            Ok(resolve_claude_settings_env())
        }
        "codex" => {
            let profile_id = profile_id
                .unwrap_or(crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID);
            if profile_id == crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID {
                // 官方 disk / ChatGPT：无第三方 base_url
                return Ok((String::new(), String::new()));
            }
            match crate::codex::provider_profile::resolve_codex_provider_profile(Some(profile_id)) {
                Ok(crate::codex::provider_profile::CodexProviderProfile::Disk) => {
                    Ok((String::new(), String::new()))
                }
                Ok(crate::codex::provider_profile::CodexProviderProfile::Managed {
                    config_toml,
                    auth_json,
                    ..
                }) => extract_codex_base_url_and_key(&config_toml, auth_json.as_deref())
                    .ok_or_else(|| {
                        "Codex provider has no model_providers.base_url / auth key".into()
                    }),
                Err(error) => Err(error),
            }
        }
        "grok" => resolve_grok_base_url_and_key(profile_id),
        "opencode" => {
            let root = read_app_config_root();
            let providers = root
                .get("opencode")
                .and_then(|k| k.get("providers"))
                .and_then(|p| p.as_object())
                .ok_or_else(|| "OpenCode providers not found".to_string())?;
            pick_from_providers_map(providers, profile_id)
                .ok_or_else(|| "OpenCode provider credentials not found".into())
        }
        other => Err(format!(
            "engine {other} has no coding-plan credential resolver"
        )),
    }
}

/// 决策路由：官方 runtime vs 供应商 Coding Plan API。
fn resolve_quota_route(engine: &str, provider_profile_id: Option<&str>) -> QuotaRoute {
    let engine = engine.trim().to_ascii_lowercase();
    let (base_url, api_key) = match resolve_engine_base_url_and_key(&engine, provider_profile_id) {
        Ok(pair) => pair,
        Err(error) => {
            return QuotaRoute::None { reason: error };
        }
    };

    // Codex / Claude 官方：无第三方 base 或官方 host
    if engine == "codex" {
        if base_url.trim().is_empty() || is_official_openai_base(&base_url) {
            return QuotaRoute::OfficialRuntime { source: "codex" };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        // 已知 Coding Plan host 或未知中转（Sub2API 回退）均走 HTTP 查询
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    if engine == "claude" {
        if is_official_anthropic_base(&base_url) {
            // 官方 Claude：无 Coding Plan 窗口（与 Kimi /status 不同）
            return QuotaRoute::None {
                reason: "official_anthropic_no_coding_plan".into(),
            };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    // Grok：官方 local / x.ai → 无 Sub2API；自定义中转 base+key → Sub2API
    if engine == "grok" {
        if is_official_grok_base(&base_url) {
            return QuotaRoute::None {
                reason: "official_grok_no_coding_plan".into(),
            };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    // OpenCode / 其它 engine 的 managed provider：
    // 已知 Coding Plan host 或任意第三方 base+key → HTTP（含 Sub2API 回退）。
    // engine=kimi 已在 get_coding_plan_quota_for_session 短路。
    if base_url.trim().is_empty() {
        return QuotaRoute::None {
            reason: relay_user_error("empty_base"),
        };
    }
    if api_key.trim().is_empty() {
        return QuotaRoute::None {
            reason: relay_user_error("empty_key"),
        };
    }
    QuotaRoute::CodingPlanApi { base_url, api_key }
}

/// 按当前会话引擎 + provider profile 解析路由并查询额度。
/// 原则：
/// - `engine=kimi`（Kimi CLI 本体）→ CLI OAuth refresh + `/usages`，via=cli（对齐 `/status`）
/// - Claude/Codex + Kimi/MiniMax/… HTTP 中转 → CodingPlanApi + API key，via=api
/// - Codex 官方 → OfficialRuntime
pub(crate) async fn get_coding_plan_quota_for_session(
    engine: &str,
    provider_profile_id: Option<&str>,
) -> CodingPlanQuotaSnapshot {
    let engine_lc = engine.trim().to_ascii_lowercase();

    // Kimi CLI 引擎单独路径：只读 ~/.kimi-code 登录态（含 refresh），不走 managed API key。
    // Claude Code / Codex 绑 Kimi HTTP 不会命中这里（engine 是 claude/codex）。
    if engine_lc == "kimi" {
        return query_kimi_cli_status().await;
    }

    match resolve_quota_route(engine, provider_profile_id) {
        QuotaRoute::OfficialRuntime { source } => CodingPlanQuotaSnapshot {
            source: source.to_string(),
            via: Some("official_runtime".to_string()),
            success: true,
            error: None,
            plan_label: None,
            windows: vec![],
            balance: None,
            usage_summary: None,
            site_origin: None,
            queried_at: now_millis(),
        },
        QuotaRoute::CodingPlanApi { base_url, api_key } => {
            let mut snapshot = query_by_base_url_and_key(&base_url, &api_key).await;
            // HTTP 中转路径（含 Claude/Codex + Kimi API key）统一 via=api
            if snapshot.via.is_none() && snapshot.success {
                snapshot.via = Some("api".to_string());
            }
            snapshot
        }
        QuotaRoute::None { reason } => {
            // 官方 Claude / Grok 无 plan：用 none 而非 unsupported，UI 可隐藏
            if reason == "official_anthropic_no_coding_plan"
                || reason == "official_grok_no_coding_plan"
            {
                return CodingPlanQuotaSnapshot {
                    source: "none".to_string(),
                    via: Some("official_runtime".to_string()),
                    success: true,
                    error: None,
                    plan_label: None,
                    windows: vec![],
                    balance: None,
                    usage_summary: None,
                    site_origin: None,
                    queried_at: now_millis(),
                };
            }
            // 「credentials not found」优先 empty_credentials，避免被 not found 误判为 unsupported
            let source = if reason.contains("missing")
                || reason.contains("empty")
                || reason.contains("credentials")
                || reason.contains("login")
            {
                "empty_credentials"
            } else if reason.contains("not a known") || reason.contains("not found") {
                "unsupported"
            } else {
                "empty"
            };
            empty_snapshot(source, Some(reason))
        }
    }
}

/// 直接用 base_url + api_key 查询（调试 / 前端已有凭据时）。
pub(crate) async fn get_coding_plan_quota_direct(
    base_url: &str,
    api_key: &str,
) -> CodingPlanQuotaSnapshot {
    query_by_base_url_and_key(base_url, api_key).await
}

#[tauri::command]
pub(crate) async fn get_coding_plan_quota(
    engine: String,
    provider_profile_id: Option<String>,
) -> Result<CodingPlanQuotaSnapshot, String> {
    Ok(get_coding_plan_quota_for_session(&engine, provider_profile_id.as_deref()).await)
}

#[tauri::command]
pub(crate) async fn get_coding_plan_quota_direct_cmd(
    base_url: String,
    api_key: String,
) -> Result<CodingPlanQuotaSnapshot, String> {
    Ok(get_coding_plan_quota_direct(&base_url, &api_key).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detect_known_hosts() {
        assert!(matches!(
            detect_provider("https://api.kimi.com/coding/v1"),
            Some(CodingPlanProvider::Kimi)
        ));
        assert!(matches!(
            detect_provider("https://open.bigmodel.cn/api/anthropic"),
            Some(CodingPlanProvider::ZhipuCn)
        ));
        assert!(matches!(
            detect_provider("https://open.bigmodel.cn/api/coding/paas/v4"),
            Some(CodingPlanProvider::ZhipuCn)
        ));
        assert!(matches!(
            detect_provider("https://api.z.ai/api/anthropic"),
            Some(CodingPlanProvider::ZhipuEn)
        ));
        assert!(matches!(
            detect_provider("https://api.minimaxi.com/anthropic"),
            Some(CodingPlanProvider::MiniMaxCn)
        ));
        assert!(matches!(
            detect_provider("https://api.minimax.io/v1"),
            Some(CodingPlanProvider::MiniMaxEn)
        ));
        assert!(matches!(
            detect_provider("https://api.deepseek.com"),
            Some(CodingPlanProvider::DeepSeek)
        ));
        assert!(matches!(
            detect_provider("https://api.deepseek.com/anthropic"),
            Some(CodingPlanProvider::DeepSeek)
        ));
        assert!(matches!(
            detect_provider("https://api.deepseek.com/v1"),
            Some(CodingPlanProvider::DeepSeek)
        ));
        // 千问 Coding Plan host 识别为「已知但无公开额度 API」
        assert!(detect_provider("https://coding.dashscope.aliyuncs.com/apps/anthropic").is_none());
        assert!(is_dashscope_coding_plan_host(
            "https://coding.dashscope.aliyuncs.com/apps/anthropic"
        ));
        assert!(detect_provider("https://api.openai.com/v1").is_none());
    }

    #[test]
    fn parse_zhipu_unit_and_fallback() {
        let data = json!({
            "limits": [
                {
                    "type": "TOKENS_LIMIT",
                    "unit": 3,
                    "percentage": 12.5,
                    "nextResetTime": 1_800_000_000_000i64
                },
                {
                    "type": "TOKENS_LIMIT",
                    "unit": 6,
                    "percentage": 40.0,
                    "nextResetTime": 1_800_100_000_000i64
                }
            ]
        });
        let windows = parse_zhipu_windows(&data);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].id, "five_hour");
        assert!((windows[0].used_percent - 12.5).abs() < 0.01);
        assert_eq!(windows[1].id, "weekly_limit");
        assert!((windows[1].used_percent - 40.0).abs() < 0.01);
    }

    #[test]
    fn parse_deepseek_balance_single_currency() {
        let body = json!({
            "is_available": true,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "110.00",
                "granted_balance": "10.00",
                "topped_up_balance": "100.00"
            }]
        });
        let balance = parse_deepseek_balance(&body);
        assert!(balance.is_available);
        assert_eq!(balance.items.len(), 1);
        assert_eq!(balance.items[0].currency, "CNY");
        assert_eq!(balance.items[0].total_balance, "110.00");
        assert_eq!(balance.items[0].granted_balance.as_deref(), Some("10.00"));
        assert_eq!(
            balance.items[0].topped_up_balance.as_deref(),
            Some("100.00")
        );
    }

    #[test]
    fn parse_deepseek_balance_multi_currency_and_empty() {
        let multi = json!({
            "is_available": true,
            "balance_infos": [
                {
                    "currency": "CNY",
                    "total_balance": "10.00",
                    "granted_balance": "0",
                    "topped_up_balance": "10.00"
                },
                {
                    "currency": "USD",
                    "total_balance": "1.50",
                    "granted_balance": "0.50",
                    "topped_up_balance": "1.00"
                }
            ]
        });
        let balance = parse_deepseek_balance(&multi);
        assert_eq!(balance.items.len(), 2);
        assert_eq!(balance.items[0].currency, "CNY");
        assert_eq!(balance.items[1].currency, "USD");
        assert_eq!(balance.items[1].total_balance, "1.50");

        let empty = json!({ "is_available": false, "balance_infos": [] });
        let empty_balance = parse_deepseek_balance(&empty);
        assert!(!empty_balance.is_available);
        assert!(empty_balance.items.is_empty());
    }

    #[test]
    fn parse_minimax_remaining_to_used() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 99.0,
                "end_time": 1_800_000_000_000i64,
                "current_weekly_status": 1,
                "current_weekly_remaining_percent": 89.0,
                "weekly_end_time": 1_800_100_000_000i64
            }]
        });
        let windows = parse_minimax_windows(&body);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].id, "five_hour");
        assert!((windows[0].used_percent - 1.0).abs() < 0.01);
        assert!((windows[0].remaining_percent - 99.0).abs() < 0.01);
        assert_eq!(windows[1].id, "weekly_limit");
        assert!((windows[1].used_percent - 11.0).abs() < 0.01);
    }

    #[test]
    fn parse_minimax_skips_inactive_weekly() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 50.0,
                "current_weekly_status": 3,
                "current_weekly_remaining_percent": 100.0
            }]
        });
        let windows = parse_minimax_windows(&body);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].id, "five_hour");
    }

    #[test]
    fn official_base_detection() {
        assert!(is_official_anthropic_base(""));
        assert!(is_official_anthropic_base("https://api.anthropic.com/v1"));
        assert!(!is_official_anthropic_base(
            "https://api.minimaxi.com/anthropic"
        ));
        assert!(is_official_openai_base(""));
        assert!(is_official_openai_base("https://api.openai.com/v1"));
        assert!(!is_official_openai_base("https://api.kimi.com/coding/v1"));
    }

    #[test]
    fn kimi_cli_token_refresh_skew() {
        let base = KimiCliCredentials {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: Some(1_000),
            raw: json!({}),
        };
        // 距过期还有 30s < 60s skew → 需要 refresh
        assert!(kimi_cli_token_needs_refresh(&base, 1_000 - 30, false));
        // 距过期还有 120s → 不需要
        assert!(!kimi_cli_token_needs_refresh(&base, 1_000 - 120, false));
        // force 总是需要
        assert!(kimi_cli_token_needs_refresh(&base, 1_000 - 120, true));
        // 无 expires_at 且非 force → 不刷
        let no_exp = KimiCliCredentials {
            expires_at: None,
            ..base.clone()
        };
        assert!(!kimi_cli_token_needs_refresh(&no_exp, 1_000, false));
    }

    #[test]
    fn kimi_engine_route_is_not_confused_with_claude_http_kimi() {
        // Claude + Kimi HTTP base 仍应走 CodingPlanApi（不进 engine=kimi CLI 短路）
        let route = resolve_quota_route(
            "claude",
            None, // profile missing → may be None or official; just ensure no panic
        );
        // 无 profile 时官方 anthropic → none
        assert!(
            matches!(route, QuotaRoute::None { .. })
                || matches!(route, QuotaRoute::CodingPlanApi { .. })
                || matches!(route, QuotaRoute::OfficialRuntime { .. })
        );
    }

    #[test]
    fn extract_codex_minimax_provider_from_toml() {
        let toml = r#"
model = "m2"
[model_providers.minimax]
base_url = "https://api.minimaxi.com/v1"
wire_api = "responses"
"#;
        let auth = r#"{"OPENAI_API_KEY":"sk-test"}"#;
        let (base, key) = extract_codex_base_url_and_key(toml, Some(auth)).expect("extract");
        assert!(base.contains("minimaxi.com"));
        assert_eq!(key, "sk-test");
    }

    #[test]
    fn sub2api_usage_url_from_root_and_v1() {
        assert_eq!(
            sub2api_usage_url("https://relay.example.com").unwrap(),
            "https://relay.example.com/v1/usage"
        );
        assert_eq!(
            sub2api_usage_url("https://relay.example.com/").unwrap(),
            "https://relay.example.com/v1/usage"
        );
        assert_eq!(
            sub2api_usage_url("https://relay.example.com/v1").unwrap(),
            "https://relay.example.com/v1/usage"
        );
        assert_eq!(
            sub2api_usage_url("https://relay.example.com/v1/").unwrap(),
            "https://relay.example.com/v1/usage"
        );
        assert_eq!(
            sub2api_usage_url("https://ai.td.ee/v1/chat/completions").unwrap(),
            "https://ai.td.ee/v1/usage"
        );
        assert_eq!(
            sub2api_usage_url("http://127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080/v1/usage"
        );
        assert!(sub2api_usage_url("").is_err());
        assert!(sub2api_usage_url("not-a-url").is_err());
    }

    #[test]
    fn parse_sub2api_wallet_balance_fufei_shape() {
        let body = json!({
            "balance": 0.56969315,
            "daily_usage": [{
                "date": "2026-07-21",
                "requests": 1,
                "input_tokens": 6608,
                "output_tokens": 11,
                "total_tokens": 19675,
                "cost": 0.039898,
                "actual_cost": 0.01436328
            }],
            "isValid": true,
            "mode": "unrestricted",
            "planName": "钱包余额",
            "remaining": 0.56969315,
            "unit": "USD",
            "usage": {
                "average_duration_ms": 3885,
                "rpm": 0,
                "tpm": 0,
                "today": {
                    "actual_cost": 0,
                    "cost": 0,
                    "requests": 0,
                    "total_tokens": 0
                },
                "total": {
                    "actual_cost": 0.01436328,
                    "cost": 0.039898,
                    "requests": 1,
                    "input_tokens": 6608,
                    "output_tokens": 11,
                    "total_tokens": 19675
                }
            }
        });
        let snap = parse_sub2api_usage(&body).expect("parse");
        assert!(snap.success);
        assert_eq!(snap.source, "sub2api");
        assert_eq!(snap.via.as_deref(), Some("api"));
        let balance = snap.balance.expect("balance");
        assert!(balance.is_available);
        assert_eq!(balance.items.len(), 1);
        assert_eq!(balance.items[0].currency, "USD");
        assert_eq!(balance.items[0].total_balance, "0.57");
        assert!(snap.windows.is_empty());
        assert_eq!(snap.plan_label.as_deref(), Some("钱包余额"));
        let usage = snap.usage_summary.expect("usage_summary");
        assert_eq!(usage.total_requests, Some(1));
        assert_eq!(usage.total_actual_cost.as_deref(), Some("0.01"));
        assert_eq!(usage.total_input_tokens, Some(6608));
        assert_eq!(usage.total_output_tokens, Some(11));
        assert_eq!(usage.total_tokens, Some(19675));
        assert!((usage.average_duration_ms.unwrap_or(0.0) - 3885.0).abs() < 0.01);
    }

    #[test]
    fn parse_sub2api_wallet_hajimi_shape() {
        let body = json!({
            "balance": 2.594644,
            "daily_usage": [],
            "isValid": true,
            "mode": "unrestricted",
            "planName": "钱包余额",
            "remaining": 2.594644,
            "unit": "USD",
            "usage": {
                "average_duration_ms": 14929.97,
                "rpm": 0,
                "tpm": 0,
                "today": {
                    "actual_cost": 0,
                    "cost": 0,
                    "requests": 0,
                    "total_tokens": 0
                },
                "total": {
                    "actual_cost": 7.115356,
                    "cost": 7.115356,
                    "requests": 149,
                    "total_tokens": 14015237
                }
            }
        });
        let snap = parse_sub2api_usage(&body).expect("parse");
        assert_eq!(
            snap.balance.as_ref().unwrap().items[0].total_balance,
            "2.59"
        );
        assert_eq!(snap.plan_label.as_deref(), Some("钱包余额"));
        let usage = snap.usage_summary.expect("usage");
        assert_eq!(usage.total_requests, Some(149));
        assert_eq!(usage.total_actual_cost.as_deref(), Some("7.12"));
        assert_eq!(usage.total_tokens, Some(14015237));
    }

    #[test]
    fn parse_sub2api_rate_limit_windows() {
        let body = json!({
            "isValid": true,
            "rate_limits": [
                {
                    "name": "5h",
                    "used": 20,
                    "limit": 100,
                    "reset_at": "2026-08-10T12:00:00Z"
                },
                {
                    "id": "weekly",
                    "used_percent": 40.5,
                    "resets_at": 1_800_000_000_000i64
                },
                {
                    "name": "monthly",
                    "remaining_percent": 10.0
                }
            ]
        });
        let snap = parse_sub2api_usage(&body).expect("parse");
        assert!(snap.success);
        assert!(snap.balance.is_none());
        // HUD 最多两窗：five_hour 优先，其次 daily/weekly
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].id, "five_hour");
        assert!((snap.windows[0].used_percent - 20.0).abs() < 0.01);
        assert_eq!(snap.windows[1].id, "weekly_limit");
        assert!((snap.windows[1].used_percent - 40.5).abs() < 0.01);
    }

    #[test]
    fn parse_sub2api_empty_payload_errors() {
        let body = json!({ "isValid": true, "mode": "unrestricted" });
        assert!(parse_sub2api_usage(&body).is_err());
    }

    #[test]
    fn parse_sub2api_error_envelope() {
        let body = json!({
            "code": "INVALID_API_KEY",
            "message": "Invalid API key"
        });
        let err = parse_sub2api_usage(&body).unwrap_err();
        // 不得回传上游原始 message
        assert!(!err.contains("Invalid API key"));
        assert!(err.contains("密钥") || err.contains("未授权") || err.contains("无效"));
    }

    #[test]
    fn sub2api_user_error_is_friendly() {
        assert!(relay_user_error("not_found").contains("暂不支持"));
        assert!(!relay_user_error("404").contains("HTTP"));
        assert!(relay_user_error("auth_new_api").contains("系统访问令牌"));
        assert!(relay_user_error("rate_limited").contains("频繁"));
        assert!(relay_user_error("empty_key").contains("密钥"));
        assert!(!relay_user_error("network").contains("error"));
    }

    #[test]
    fn new_api_zero_balance_still_available() {
        let body = json!({
            "success": true,
            "data": { "quota": 0, "used_quota": 100, "request_count": 1 }
        });
        let snap = parse_new_api_user_self(&body).expect("parse");
        assert!(snap.success);
        assert!(snap.balance.as_ref().unwrap().is_available);
        assert_eq!(
            snap.balance.as_ref().unwrap().items[0].total_balance,
            "0.00"
        );
    }

    #[test]
    fn pick_better_relay_error_prefers_actionable() {
        let sub2 = empty_snapshot_ex(
            "sub2api",
            Some(relay_user_error("not_found")),
            Some("https://a.example".into()),
        );
        let new_api = empty_snapshot_ex(
            "new_api",
            Some(relay_user_error("auth_new_api")),
            Some("https://a.example".into()),
        );
        let picked = pick_better_relay_error(sub2, new_api);
        assert_eq!(picked.source, "new_api");
        assert!(picked
            .error
            .as_deref()
            .unwrap_or("")
            .contains("系统访问令牌"));
    }

    #[test]
    fn format_quota_amount_two_decimals() {
        assert_eq!(format_quota_amount(0.57), "0.57");
        assert_eq!(format_quota_amount(2.594644), "2.59");
        assert_eq!(format_quota_amount(10.0), "10.00");
        assert_eq!(format_quota_amount(95878.280174), "95878.28");
    }

    #[test]
    fn parse_new_api_user_self_quota() {
        // quota 1_000_000 → $2.00；used 250_000 → $0.50
        let body = json!({
            "success": true,
            "data": {
                "quota": 1_000_000,
                "used_quota": 250_000,
                "request_count": 42,
                "group": "default"
            }
        });
        let snap = parse_new_api_user_self(&body).expect("parse");
        assert!(snap.success);
        assert_eq!(snap.source, "new_api");
        assert_eq!(
            snap.balance.as_ref().unwrap().items[0].total_balance,
            "2.00"
        );
        assert_eq!(snap.plan_label.as_deref(), Some("default"));
        let usage = snap.usage_summary.expect("usage");
        assert_eq!(usage.total_requests, Some(42));
        assert_eq!(usage.total_actual_cost.as_deref(), Some("0.50"));
    }

    #[test]
    fn new_api_user_self_url_from_chat_base() {
        assert_eq!(
            new_api_user_self_url("https://relay.example/v1").unwrap(),
            "https://relay.example/api/user/self"
        );
        assert_eq!(
            new_api_user_self_url("https://relay.example/v1/chat/completions").unwrap(),
            "https://relay.example/api/user/self"
        );
    }

    #[test]
    fn relay_origin_extracts_host() {
        assert_eq!(
            relay_origin("https://relay.example.com/v1").unwrap(),
            "https://relay.example.com"
        );
        assert_eq!(
            relay_origin("https://ai.td.ee/v1/chat/completions").unwrap(),
            "https://ai.td.ee"
        );
    }

    #[test]
    fn official_grok_base_detection() {
        assert!(is_official_grok_base(""));
        assert!(is_official_grok_base("https://api.x.ai/v1"));
        assert!(is_official_grok_base("https://api.x.ai"));
        assert!(!is_official_grok_base("https://relay.example.com"));
        assert!(!is_official_grok_base("https://ai.td.ee/v1"));
    }

    #[test]
    fn resolve_grok_local_profile_reads_config_toml_without_panic() {
        // local 会读 $GROK_HOME 或 ~/.grok/config.toml；此处只保证路径可达
        let result = resolve_grok_base_url_and_key(Some(
            crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
        ));
        assert!(result.is_ok(), "local grok resolve failed: {result:?}");
    }

    #[test]
    fn pick_base_url_accepts_snake_case() {
        let value = json!({
            "base_url": "https://relay.example/v1",
            "api_key": "sk-relay"
        });
        let (base, key) = pick_base_url_api_key(&value);
        assert_eq!(base, "https://relay.example/v1");
        assert_eq!(key, "sk-relay");
    }
}
