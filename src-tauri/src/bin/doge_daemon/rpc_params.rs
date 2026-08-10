use serde_json::Value;

pub(super) fn parse_string(value: &Value, key: &str) -> Result<String, String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .ok_or_else(|| format!("missing or invalid `{key}`")),
        _ => Err(format!("missing `{key}`")),
    }
}

pub(super) fn parse_bool(value: &Value, key: &str) -> Result<bool, String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_bool())
            .ok_or_else(|| format!("missing or invalid `{key}`")),
        _ => Err(format!("missing `{key}`")),
    }
}

pub(super) fn parse_optional_string(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        _ => None,
    }
}

pub(super) fn parse_optional_u32(value: &Value, key: &str) -> Option<u32> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_u64())
            .and_then(|raw| {
                if raw > u32::MAX as u64 {
                    None
                } else {
                    Some(raw as u32)
                }
            }),
        _ => None,
    }
}

pub(super) fn parse_optional_u64(value: &Value, key: &str) -> Option<u64> {
    match value {
        Value::Object(map) => map.get(key).and_then(|value| value.as_u64()),
        _ => None,
    }
}

pub(super) fn parse_optional_usize(value: &Value, key: &str) -> Option<usize> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_u64())
            .and_then(|raw| {
                if raw > usize::MAX as u64 {
                    None
                } else {
                    Some(raw as usize)
                }
            }),
        _ => None,
    }
}

pub(super) fn parse_optional_i64(value: &Value, key: &str) -> Option<i64> {
    match value {
        Value::Object(map) => map.get(key).and_then(|entry| match entry {
            Value::Number(number) => {
                if let Some(signed) = number.as_i64() {
                    return Some(signed);
                }
                number.as_u64().and_then(|unsigned| {
                    if unsigned > i64::MAX as u64 {
                        None
                    } else {
                        Some(unsigned as i64)
                    }
                })
            }
            _ => None,
        }),
        _ => None,
    }
}

pub(super) fn parse_optional_port(value: &Value, key: &str) -> Result<Option<u16>, String> {
    let Some(raw) = parse_optional_u32(value, key) else {
        return Ok(None);
    };
    if raw > u16::MAX as u32 {
        return Err(format!("invalid `{key}`"));
    }
    Ok(Some(raw as u16))
}

pub(super) fn parse_optional_bool(value: &Value, key: &str) -> Option<bool> {
    match value {
        Value::Object(map) => map.get(key).and_then(Value::as_bool),
        _ => None,
    }
}

pub(super) fn parse_optional_string_array(value: &Value, key: &str) -> Option<Vec<String>> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.to_string()))
                    .collect::<Vec<_>>()
            }),
        _ => None,
    }
}

pub(super) fn parse_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    parse_optional_string_array(value, key).ok_or_else(|| format!("missing `{key}`"))
}

pub(super) fn parse_optional_value(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned(),
        _ => None,
    }
}
