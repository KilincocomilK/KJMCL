mod formats;
mod model;
#[cfg(test)]
mod tests;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Instant,
};
type Result<T> = std::result::Result<T, String>;
const LIMIT: usize = 64 * 1024 * 1024;
fn check_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err("需要绝对路径".into());
    }
    let mut p = PathBuf::new();
    for part in path.components() {
        if matches!(part, Component::ParentDir) {
            return Err("路径越界".into());
        }
        p.push(part);
        match fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() => return Err("投影路径不能是链接".into()),
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}
fn read(path: &Path) -> Result<Vec<u8>> {
    read_limit(path, LIMIT)
}
fn read_limit(path: &Path, limit: usize) -> Result<Vec<u8>> {
    check_path(path)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit as u64 {
        return Err("投影文件过大".into());
    }
    let mut bytes = vec![];
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("投影文件过大".into());
    }
    Ok(bytes)
}
fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    check_path(path)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("投影文件过大".into());
    }
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())
}
fn load(path: &Path) -> Result<model::Project> {
    let p: model::Project = serde_json::from_slice(&read_limit(path, 128 * 1024 * 1024)?)
        .map_err(|e| format!("投影工程无效：{e}"))?;
    p.validate()?;
    Ok(p)
}
fn run(v: Value) -> Result<Value> {
    if v["protocol"] != 1 {
        return Err("不支持的投影协议".into());
    }
    let started = Instant::now();
    let input = Path::new(v["input"].as_str().ok_or("缺少输入路径")?);
    let output = || {
        v["output"]
            .as_str()
            .map(Path::new)
            .ok_or("缺少输出路径".to_string())
    };
    let data = match v["command"].as_str().ok_or("缺少操作")? {
        "import" => {
            let bytes = read(input)?;
            let name = input.file_stem().unwrap_or_default().to_string_lossy();
            let mut p = formats::import(&bytes, &name)?;
            p.original = STANDARD.encode(bytes);
            p.validate()?;
            write(
                output()?,
                &serde_json::to_vec(&p).map_err(|e| e.to_string())?,
            )?;
            p.view()
        }
        "read" => load(input)?.view(),
        "edit" => {
            let mut p = load(input)?;
            p.edit(&v["op"])?;
            p.validate()?;
            write(
                output()?,
                &serde_json::to_vec(&p).map_err(|e| e.to_string())?,
            )?;
            p.view()
        }
        "select" => {
            let p = load(input)?;
            json!({"indices":p.select(&v)?})
        }
        "export" => {
            let p = load(input)?;
            let format = v["format"].as_str().ok_or("缺少格式")?;
            let bytes = if !p.dirty && format == p.format {
                STANDARD.decode(&p.original).map_err(|_| "源投影数据无效")?
            } else {
                formats::export(&p, format)?
            };
            write(output()?, &bytes)?;
            json!({"bytes":bytes.len()})
        }
        _ => return Err("未知投影操作".into()),
    };
    Ok(json!({"protocol":1,"data":data,"elapsedMs":started.elapsed().as_secs_f64()*1000.0}))
}
fn main() {
    let mut input = Vec::new();
    let result = std::io::stdin()
        .take((8 * 1024 * 1024 + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            if input.len() > 8 * 1024 * 1024 {
                Err("请求过大".into())
            } else {
                serde_json::from_slice(&input).map_err(|e| e.to_string())
            }
        })
        .and_then(run);
    match result {
        Ok(result) => println!("{}", json!({"ok":true,"result":result})),
        Err(error) => {
            println!("{}", json!({"ok":false,"error":error}));
            std::process::exit(1)
        }
    }
}
