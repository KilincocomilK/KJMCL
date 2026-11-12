mod nbt;
mod region;
mod safety;
#[cfg(test)]
mod tests;
mod world;

use serde_json::{Value, json};
use std::{
    io::{self, Read},
    path::PathBuf,
    time::Instant,
};
type Result<T> = std::result::Result<T, String>;
fn run(v: Value) -> Result<Value> {
    if v["protocol"] != 1 {
        return Err("不支持的存档管理协议".into());
    }
    let root = PathBuf::from(v["root"].as_str().ok_or("缺少存档目录")?);
    safety::check_absolute(&root)?;
    let started = Instant::now();
    let result = match v["command"].as_str().ok_or("缺少操作")? {
        "list" => world::list(&root),
        "scan" => world::scan(&root),
        "region" => region::inspect(&root, &v),
        "plan" => safety::plan(&root, &v),
        "apply" => safety::apply(&root, &v),
        "edit" => safety::edit(&root, &v),
        "history" => safety::history(&root),
        "undo" => safety::undo(&root, &v),
        _ => Err("未知存档操作".into()),
    }?;
    Ok(
        json!({"data":result,"elapsedMs":started.elapsed().as_secs_f64()*1000.0,"engine":"Rust","protocol":1}),
    )
}
fn main() {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 8);
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build_global()
        .ok();
    let mut input = String::new();
    let result = io::stdin()
        .take(2 * 1024 * 1024)
        .read_to_string(&mut input)
        .map_err(|e| e.to_string())
        .and_then(|_| serde_json::from_str::<Value>(&input).map_err(|e| e.to_string()))
        .and_then(run);
    match result {
        Ok(value) => println!("{}", json!({"ok":true,"result":value})),
        Err(error) => {
            println!("{}", json!({"ok":false,"error":error}));
            std::process::exit(1);
        }
    }
}
