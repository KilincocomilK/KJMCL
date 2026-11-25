use crate::{Result, nbt, safety, world};
use fastnbt::Value as Tag;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::OnceLock,
};

pub const SIDE: &str = "data/minecraft/game_rules.dat";

struct Storage {
    file: &'static str,
    path: Vec<&'static str>,
    modern: bool,
    document: Tag,
}
fn catalog() -> &'static Vec<Value> {
    static RULES: OnceLock<Vec<Value>> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../shared/game-rules.json"))
            .expect("game rule catalog")
    })
}
fn storage(root: &Path, level: &Tag) -> Result<Option<Storage>> {
    let data = nbt::get(level, "Data").ok_or("无法读取存档属性")?;
    let version = nbt::num(nbt::get(data, "DataVersion")).unwrap_or(0);
    let side = safety::join(root, SIDE)?;
    if version >= 4774 || side.is_file() {
        let document = if side.try_exists().map_err(|e| e.to_string())? {
            world::read_nbt(root, SIDE)?
        } else {
            Tag::Compound(HashMap::from([
                ("DataVersion".into(), Tag::Int(version as i32)),
                ("data".into(), Tag::Compound(HashMap::new())),
            ]))
        };
        let payload = nbt::get(&document, "data")
            .and_then(nbt::map)
            .ok_or("无法读取游戏规则文件")?;
        let mut path = vec!["data"];
        if let Some(key) = ["game_rules", "rules"]
            .into_iter()
            .find(|k| payload.get(*k).and_then(nbt::map).is_some())
        {
            path.push(key);
        }
        return Ok(Some(Storage {
            file: SIDE,
            path,
            modern: true,
            document,
        }));
    }
    for (field, modern) in [("game_rules", true), ("GameRules", false)] {
        if nbt::get(data, field).is_some() {
            return Ok(Some(Storage {
                file: "level.dat",
                path: vec!["Data", field],
                modern,
                document: level.clone(),
            }));
        }
    }
    // Typed rules omit their compound entirely when every rule uses its default.
    if version >= 4671 {
        let mut document = level.clone();
        child_map(&mut document, &["Data"])?
            .insert("game_rules".into(), Tag::Compound(HashMap::new()));
        return Ok(Some(Storage {
            file: "level.dat",
            path: vec!["Data", "game_rules"],
            modern: true,
            document,
        }));
    }
    Ok(None)
}
fn child_map<'a>(document: &'a mut Tag, path: &[&str]) -> Result<&'a mut HashMap<String, Tag>> {
    let mut current = document;
    for key in path {
        let Tag::Compound(fields) = current else {
            return Err("游戏规则结构无效".into());
        };
        current = fields.get_mut(*key).ok_or("游戏规则结构无效")?;
    }
    if let Tag::Compound(fields) = current {
        Ok(fields)
    } else {
        Err("游戏规则结构无效".into())
    }
}
fn display(tag: &Tag) -> Option<String> {
    match tag {
        Tag::Byte(value) if *value == 0 || *value == 1 => Some((value == &1).to_string()),
        Tag::Int(value) => Some(value.to_string()),
        Tag::String(value) if value.len() <= 128 => Some(value.clone()),
        _ => None,
    }
}
fn effective(
    fields: &HashMap<String, Tag>,
    modern: bool,
    level: &Tag,
) -> serde_json::Map<String, Value> {
    let mut result = serde_json::Map::new();
    if modern {
        let enabled = nbt::get(level, "Data")
            .and_then(|data| nbt::list(nbt::get(data, "enabled_features")))
            .unwrap_or(&[]);
        for spec in catalog() {
            if spec["feature"].as_str().is_some_and(|flag| {
                !enabled
                    .iter()
                    .any(|tag| nbt::string(Some(tag)) == Some(flag))
            }) {
                continue;
            }
            if let Some(key) = spec["modern"].as_str() {
                if !fields.contains_key(key) {
                    result.insert(key.into(), json!(spec["default"].to_string()));
                }
            }
        }
    }
    for (key, tag) in fields {
        if let Some(value) = display(tag) {
            result.insert(key.clone(), json!(value));
        }
    }
    result
}
pub fn values(root: &Path, level: &Tag) -> Result<Value> {
    let Some(mut store) = storage(root, level)? else {
        return Ok(json!({}));
    };
    Ok(Value::Object(effective(
        child_map(&mut store.document, &store.path)?,
        store.modern,
        level,
    )))
}
pub fn update(root: &Path, changes: &Value) -> Result<(&'static str, Tag)> {
    let level = world::level(root)?;
    let mut store = storage(root, &level)?.ok_or("此世界没有可编辑的游戏规则")?;
    let fields = child_map(&mut store.document, &store.path)?;
    let old = effective(fields, store.modern, &level);
    let mut seen = HashSet::new();
    for change in changes
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 128)
        .ok_or("请选择要修改的规则")?
    {
        let key = change["key"].as_str().ok_or("缺少游戏规则名称")?;
        let before = change["before"].as_str().ok_or("缺少原值")?;
        if !seen.insert(key) || old.get(key).and_then(Value::as_str) != Some(before) {
            return Err(format!("{key} 已变化，请重新打开游戏规则"));
        }
        let input = change["value"]
            .as_str()
            .filter(|s| s.len() <= 128)
            .ok_or("游戏规则值无效")?;
        let spec = catalog()
            .iter()
            .find(|s| s["legacy"] == key || s["modern"] == key);
        let boolean = spec.map(|s| s["default"].is_boolean()).unwrap_or(
            matches!(fields.get(key), Some(Tag::Byte(_))) || matches!(before, "true" | "false"),
        );
        let integer = spec.is_some_and(|s| s["default"].is_number())
            || matches!(fields.get(key), Some(Tag::Int(_)))
            || before.parse::<i32>().is_ok();
        let typed = if boolean {
            Tag::Byte(match input {
                "true" => 1,
                "false" => 0,
                _ => return Err(format!("{key} 需要布尔值")),
            })
        } else if integer {
            let n = input
                .parse::<i32>()
                .map_err(|_| format!("{key} 需要整数"))?;
            if let Some(spec) = spec {
                let min = spec["min"].as_i64().unwrap_or(0);
                let max = spec["max"].as_i64().unwrap_or(i32::MAX as i64);
                if !(min..=max).contains(&(n as i64)) {
                    return Err(format!("{key} 需要 {min} 至 {max} 之间的整数"));
                }
            }
            Tag::Int(n)
        } else {
            Tag::String(input.to_owned())
        };
        let value = if matches!(fields.get(key), Some(Tag::String(_))) {
            Tag::String(input.to_owned())
        } else {
            typed
        };
        fields.insert(key.to_owned(), value);
    }
    Ok((store.file, store.document))
}
