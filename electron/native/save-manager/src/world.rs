use crate::{Result, nbt, region, safety};
use rayon::prelude::*;
use serde_json::{Value, json};
use std::{fs, path::Path};
pub fn level(root: &Path) -> Result<fastnbt::Value> {
    let p = safety::join(root, "level.dat")?;
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > nbt::LIMIT {
        return Err("level.dat 过大".into());
    }
    nbt::parse(&nbt::inflate(&fs::read(p).map_err(|e| e.to_string())?, 1)?)
}
pub fn metadata(root: &Path) -> Result<Value> {
    let root_nbt = level(root)?;
    let d = nbt::get(&root_nbt, "Data").ok_or("不支持的 level.dat 结构")?;
    let version = nbt::get(d, "Version");
    let spawn = json!({"x":nbt::num(nbt::get(d,"SpawnX")),"y":nbt::num(nbt::get(d,"SpawnY")),"z":nbt::num(nbt::get(d,"SpawnZ"))});
    let mut rules = serde_json::Map::new();
    if let Some(m) = nbt::get(d, "GameRules").and_then(nbt::map) {
        for (k, v) in m {
            if let Some(s) = nbt::string(Some(v)) {
                rules.insert(k.clone(), json!(s));
            }
        }
    }
    Ok(
        json!({"folder":root.file_name().unwrap_or_default().to_string_lossy(),"name":nbt::string(nbt::get(d,"LevelName")),"version":version.and_then(|v|nbt::string(nbt::get(v,"Name"))),"dataVersion":nbt::num(nbt::get(d,"DataVersion")),"seed":nbt::num(nbt::get(d,"WorldGenSettings").and_then(|g|nbt::get(g,"seed")).or_else(||nbt::get(d,"RandomSeed"))).map(|n|n.to_string()),"gameType":nbt::num(nbt::get(d,"GameType")),"difficulty":nbt::num(nbt::get(d,"Difficulty")),"hardcore":nbt::num(nbt::get(d,"hardcore")).map(|v|v!=0),"commands":nbt::num(nbt::get(d,"allowCommands")).map(|v|v!=0),"lastPlayed":nbt::num(nbt::get(d,"LastPlayed")),"spawn":spawn,"rules":rules}),
    )
}
pub fn list(root: &Path) -> Result<Value> {
    if !root.exists() {
        return Ok(json!([]));
    }
    let entries: Vec<_> = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
        .collect();
    if entries.len() > 10000 {
        return Err("存档数量超过 10000".into());
    }
    let out: Vec<_> = entries
        .par_iter()
        .filter(|e| e.path().join("level.dat").exists())
        .map(|e| {
            metadata(&e.path())
                .unwrap_or_else(|err| json!({"folder":e.file_name().to_string_lossy(),"error":err}))
        })
        .collect();
    Ok(json!(out))
}
fn custom_dims(
    root: &Path,
    base: &Path,
    prefix: &str,
    out: &mut Vec<(String, std::path::PathBuf)>,
    depth: usize,
) -> Result<()> {
    if depth > 8 {
        return Err("自定义维度目录过深".into());
    }
    if !base.exists() {
        return Ok(());
    }
    safety::check_absolute(base)?;
    if base.join("region").is_dir() {
        out.push((prefix.to_string(), base.to_owned()));
    }
    for e in fs::read_dir(base).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if ["region", "entities", "poi"].contains(&name.as_str()) {
            continue;
        }
        if e.file_type().map_err(|e| e.to_string())?.is_dir() {
            let next = safety::join(root, &format!("{prefix}/{name}"))?;
            custom_dims(root, &next, &format!("{prefix}/{name}"), out, depth + 1)?;
        }
    }
    Ok(())
}
pub fn scan(root: &Path) -> Result<Value> {
    let metadata = metadata(root)?;
    let mut dims = vec![("overworld".into(), root.to_owned())];
    for (label, dir) in [("the_nether", "DIM-1"), ("the_end", "DIM1")] {
        let p = safety::join(root, dir)?;
        if p.exists() {
            dims.push((label.into(), p));
        }
    }
    custom_dims(
        root,
        &safety::join(root, "dimensions")?,
        "dimensions",
        &mut dims,
        0,
    )?;
    let mut results = Vec::new();
    for (name, dir) in dims {
        let folder = safety::join(&dir, "region")?;
        if !folder.exists() {
            continue;
        }
        let files: Vec<_> = fs::read_dir(&folder)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                region::coords(&e.file_name().to_string_lossy()).map(|pos| (pos, e.path()))
            })
            .collect();
        if files.len() > 50000 {
            return Err("单维度超过 50000 个区域，请拆分管理".into());
        }
        let regions:Vec<_>=files.par_iter().map(|((x,z),p)|{
            match region::header(p,*x,*z){Ok(chunks)=>{let mut occupancy=vec![0u8;128];for c in &chunks{occupancy[c.index/8]|=1<<(c.index%8);}
                json!({"x":x,"z":z,"chunks":chunks.len(),"bytes":fs::metadata(p).map(|m|m.len()).unwrap_or(0),"modified":chunks.iter().map(|c|c.timestamp).max().unwrap_or(0),"occupancy":occupancy.iter().map(|b|format!("{b:02x}")).collect::<String>()})},Err(error)=>json!({"x":x,"z":z,"chunks":0,"bytes":fs::metadata(p).map(|m|m.len()).unwrap_or(0),"error":error})}
        }).collect();
        results.push(json!({"id":name,"regions":regions}));
    }
    Ok(json!({"metadata":metadata,"dimensions":results,"history":safety::history(root)?}))
}
