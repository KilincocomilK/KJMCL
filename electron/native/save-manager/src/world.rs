use crate::{Result, nbt, region, safety};
use rayon::prelude::*;
use serde_json::{Value, json};
use std::{fs, path::Path};
pub fn level(root: &Path) -> Result<fastnbt::Value> {
    read_nbt(root, "level.dat")
}
pub fn read_nbt(root: &Path, name: &str) -> Result<fastnbt::Value> {
    let p = safety::join(root, name)?;
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > nbt::LIMIT {
        return Err(format!("{name} 过大"));
    }
    nbt::parse(&nbt::inflate(&fs::read(p).map_err(|e| e.to_string())?, 1)?)
}
pub fn metadata(root: &Path) -> Result<Value> {
    let root_nbt = level(root)?;
    let d = nbt::get(&root_nbt, "Data").ok_or("不支持的 level.dat 结构")?;
    let version = nbt::get(d, "Version");
    let sidecar = if nbt::get(d, "WorldGenSettings").is_none()
        && safety::join(root, "data/minecraft/world_gen_settings.dat")?.is_file()
    {
        read_nbt(root, "data/minecraft/world_gen_settings.dat").ok()
    } else {
        None
    };
    let worldgen = nbt::get(d, "WorldGenSettings")
        .or_else(|| sidecar.as_ref().and_then(|s| nbt::get(s, "data")));
    let generator = worldgen
        .and_then(|g| nbt::get(g, "dimensions"))
        .and_then(|dims| nbt::get(dims, "minecraft:overworld"))
        .and_then(|overworld| nbt::get(overworld, "generator"));
    let preset = generator
        .and_then(|g| nbt::string(nbt::get(g, "settings")))
        .or_else(|| generator.and_then(|g| nbt::string(nbt::get(g, "type"))))
        .or_else(|| nbt::string(nbt::get(d, "generatorName")));
    let large_biomes = preset
        .as_deref()
        .is_some_and(|p| p == "minecraft:large_biomes" || p.eq_ignore_ascii_case("largeBiomes"));
    let position = nbt::get(d, "spawn").and_then(|s| nbt::get(s, "pos"));
    let coord = |key: &str, i: usize| match position {
        Some(fastnbt::Value::IntArray(a)) => a.get(i).map(|v| *v as i64),
        Some(fastnbt::Value::List(a)) => nbt::num(a.get(i)),
        _ => nbt::num(nbt::get(d, key)),
    };
    let spawn = json!({"x":coord("SpawnX",0),"y":coord("SpawnY",1),"z":coord("SpawnZ",2),"dimension":nbt::get(d,"spawn").and_then(|v|nbt::string(nbt::get(v,"dimension"))).unwrap_or("minecraft:overworld")});
    let (rules, rule_error) = match crate::rules::values(root, &root_nbt) {
        Ok(v) => (v, None),
        Err(e) => (json!({}), Some(e)),
    };
    let difficulty = nbt::get(d, "difficulty_settings")
        .and_then(|s| nbt::string(nbt::get(s, "difficulty")))
        .and_then(|s| {
            ["peaceful", "easy", "normal", "hard"]
                .iter()
                .position(|v| *v == s)
        })
        .map(|i| i as i64)
        .or_else(|| nbt::num(nbt::get(d, "Difficulty")));

    Ok(
        json!({"folder":root.file_name().unwrap_or_default().to_string_lossy(),"name":nbt::string(nbt::get(d,"LevelName")),"version":version.and_then(|v|nbt::string(nbt::get(v,"Name"))),"dataVersion":nbt::num(nbt::get(d,"DataVersion")),"seed":nbt::num(worldgen.and_then(|g|nbt::get(g,"seed")).or_else(||nbt::get(d,"RandomSeed"))).map(|n|n.to_string()),"generation":{"preset":preset,"largeBiomes":large_biomes},"gameType":nbt::num(nbt::get(d,"GameType")),"difficulty":difficulty,"hardcore":nbt::num(nbt::get(d,"hardcore")).map(|v|v!=0),"commands":nbt::num(nbt::get(d,"allowCommands")).map(|v|v!=0),"lastPlayed":nbt::num(nbt::get(d,"LastPlayed")),"spawn":spawn,"rules":rules,"ruleError":rule_error}),
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
    for name in ["overworld", "the_nether", "the_end"] {
        let path = format!("dimensions/minecraft/{name}");
        if dims.iter().any(|(id, _)| id == &path) {
            dims.retain(|(id, _)| id != name);
            if let Some((id, _)) = dims.iter_mut().find(|(id, _)| id == &path) {
                *id = name.into();
            }
        }
    }
    dims.sort_by_key(|(name, _)| match name.as_str() {
        "overworld" => 0,
        "the_nether" => 1,
        "the_end" => 2,
        _ => 3,
    });
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
