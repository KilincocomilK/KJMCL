use crate::{Result, nbt, region, world};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
pub fn check_absolute(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err("路径必须为绝对路径".into());
    }
    let mut current = PathBuf::new();
    for p in path.components() {
        if matches!(p, Component::ParentDir) {
            return Err("禁止路径越界".into());
        }
        current.push(p);
        match fs::symlink_metadata(&current) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("拒绝存档中的符号链接或 junction".into());
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}
pub fn join(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || relative.contains('\0')
        || Path::new(relative).is_absolute()
        || relative
            .split('/')
            .any(|p| p == ".." || p == "." || p.is_empty())
    {
        return Err("不安全的相对路径".into());
    }
    let p = root.join(relative);
    check_absolute(&p)?;
    Ok(p)
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn hash_file(p: &Path) -> Result<String> {
    let mut file = File::open(p).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub fn atomic(p: &Path, bytes: &[u8]) -> Result<()> {
    check_absolute(p)?;
    let parent = p.parent().ok_or("路径缺少父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = parent.join(format!(".kjmcl-{}-{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&tmp, p).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub struct WorldLock(File);
impl Drop for WorldLock {
    fn drop(&mut self) {
        let _ = self.0.sync_all();
    }
}
pub fn lock(root: &Path) -> Result<WorldLock> {
    let p = join(root, "session.lock")?;
    let f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(p)
        .map_err(|e| format!("无法打开世界锁：{e}"))?;
    #[cfg(windows)]
    fs2::FileExt::try_lock_exclusive(&f)
        .map_err(|_| "世界正在被 Minecraft 或其他编辑器使用，请关闭后再操作")?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        // Java FileChannel uses POSIX record locks. flock alone does not conflict with it.
        let mut record: libc::flock = unsafe { std::mem::zeroed() };
        record.l_type = libc::F_WRLCK as _;
        record.l_whence = libc::SEEK_SET as _;
        record.l_start = 0;
        record.l_len = 0;
        if unsafe { libc::fcntl(f.as_raw_fd(), libc::F_SETLK, &record) } == -1 {
            return Err("世界正在被 Minecraft 或其他编辑器使用".into());
        }
        fs2::FileExt::try_lock_exclusive(&f).map_err(|_| "世界正在被其他编辑器使用")?;
    }
    Ok(WorldLock(f))
}
fn history_root(root: &Path) -> Result<PathBuf> {
    join(root, ".kjmcl-history")
}
pub fn history(root: &Path) -> Result<Value> {
    let base = history_root(root)?;
    if !base.exists() {
        return Ok(json!([]));
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(base).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;
        if !e.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let p = join(&e.path(), "journal.json")?;
        if !p.exists() {
            continue;
        }
        let b = fs::read(&p).map_err(|e| e.to_string())?;
        if b.len() > 1024 * 1024 {
            return Err("历史记录过大".into());
        }
        let v: Value = serde_json::from_slice(&b).map_err(|_| "历史记录损坏，请保留备份并检查")?;
        if v["schemaVersion"] != 1 {
            return Err("不支持的编辑历史版本".into());
        }
        out.push(json!({"id":e.file_name().to_string_lossy(),"state":v["state"],"title":v["title"],"createdAt":v["createdAt"],"files":v["files"].as_array().map(|x|x.len()).unwrap_or(0)}));
        if out.len() > 1000 {
            return Err("编辑历史超过 1000 条，请先归档".into());
        }
    }
    out.sort_by(|a, b| b["createdAt"].as_u64().cmp(&a["createdAt"].as_u64()));
    Ok(json!(out))
}
fn ensure_clean(root: &Path) -> Result<()> {
    if history(root)?
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["state"] == "prepared")
    {
        return Err("存在未完成的编辑，请先从历史记录恢复".into());
    }
    Ok(())
}
fn rel(root: &Path, p: &Path) -> Result<String> {
    Ok(p.strip_prefix(root)
        .map_err(|_| "路径越界")?
        .to_string_lossy()
        .replace('\\', "/"))
}
pub fn plan(root: &Path, v: &Value) -> Result<Value> {
    let _lock = lock(root)?;
    ensure_clean(root)?;
    let file = region::file_from_request(root, v, "region")?;
    let rx = v["rx"].as_i64().unwrap() as i32;
    let rz = v["rz"].as_i64().unwrap() as i32;
    let chunks = region::header(&file, rx, rz)?;
    let indices: HashSet<usize> = v["indices"]
        .as_array()
        .ok_or("请选择区块")?
        .iter()
        .map(|n| {
            n.as_u64()
                .filter(|n| *n < 1024)
                .map(|n| n as usize)
                .ok_or_else(|| "无效区块索引".to_string())
        })
        .collect::<Result<_>>()?;
    if indices.is_empty() {
        return Err("请选择区块".into());
    }
    let meta = world::metadata(root)?;
    let sx = meta["spawn"]["x"].as_i64().unwrap_or(0).div_euclid(16);
    let sz = meta["spawn"]["z"].as_i64().unwrap_or(0).div_euclid(16);
    let radius = v["protectSpawn"].as_i64().unwrap_or(8).clamp(0, 128);
    let mut selected = Vec::new();
    let mut skipped = Vec::new();
    for c in chunks.iter().filter(|c| indices.contains(&c.index)) {
        let reason = if v["dimension"] == "overworld"
            && radius > 0
            && (c.x as i64 - sx).abs() <= radius
            && (c.z as i64 - sz).abs() <= radius
        {
            Some("出生点保护范围".to_string())
        } else {
            match region::decode(&file, c) {
                Err(e) => Some(format!("无法验证区块：{e}")),
                Ok(n) => {
                    let d = nbt::data(&n);
                    let inhabited = nbt::num(nbt::get(d, "InhabitedTime"));
                    let entities = nbt::list(
                        nbt::get(d, "block_entities").or_else(|| nbt::get(d, "TileEntities")),
                    )
                    .unwrap_or(&[]);
                    if entities.iter().any(|e| {
                        nbt::string(nbt::get(e, "id"))
                            .is_some_and(|s| s.ends_with(":end_gateway") || s == "EndGateway")
                    }) {
                        Some("末地折跃门保护".into())
                    } else if v["maxInhabitedTicks"]
                        .as_i64()
                        .is_some_and(|limit| inhabited.is_none_or(|n| n > limit))
                    {
                        Some("停留时间不满足条件或未知".into())
                    } else if v["beforeTimestamp"]
                        .as_u64()
                        .is_some_and(|t| c.timestamp == 0 || c.timestamp as u64 >= t)
                    {
                        Some("修改时间不满足条件或未知".into())
                    } else {
                        None
                    }
                }
            }
        };
        if let Some(reason) = reason {
            skipped.push(json!({"x":c.x,"z":c.z,"reason":reason}));
        } else {
            selected.push(c.index);
        }
    }
    let remove: HashSet<_> = selected.iter().copied().collect();
    let mut files = Vec::new();
    let mut reclaimed = 0u64;
    for kind in ["region", "entities", "poi"] {
        let p = region::file_from_request(root, v, kind)?;
        if !p.exists() {
            continue;
        }
        let original = hash_file(&p)?;
        let kept = 8192
            + region::header(&p, rx, rz)?
                .iter()
                .filter(|c| !remove.contains(&c.index))
                .map(|c| c.bytes)
                .sum::<u64>();
        let size = fs::metadata(&p).map_err(|e| e.to_string())?.len();
        reclaimed += size.saturating_sub(kept);
        files.push(json!({"relative":rel(root,&p)?,"before":original}));
    }
    Ok(
        json!({"dimension":v["dimension"],"rx":rx,"rz":rz,"selected":selected,"skipped":skipped,"files":files,"reclaimedBytes":reclaimed,"levelHash":hash_file(&join(root,"level.dat")?)?}),
    )
}
enum Change {
    Bytes(Vec<u8>),
    Region(HashSet<usize>),
}
fn transaction(
    root: &Path,
    id: &str,
    title: &str,
    outputs: Vec<(String, Change)>,
) -> Result<Value> {
    if id.len() > 80 || id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("无效事务 ID".into());
    }
    let dir = join(&history_root(root)?, id)?;
    fs::create_dir_all(dir.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for (i, (name, change)) in outputs.iter().enumerate() {
        let source = join(root, name)?;
        let before = hash_file(&source)?;
        let backup = dir.join(format!("{i}.before"));
        fs::copy(&source, &backup).map_err(|e| e.to_string())?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&backup)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        if hash_file(&backup)? != before {
            return Err("备份校验失败".into());
        }
        let staged = dir.join(format!("{i}.after"));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|e| e.to_string())?;
        match change {
            Change::Bytes(bytes) => output.write_all(bytes).map_err(|e| e.to_string())?,
            Change::Region(indices) => region::write_compact(&source, indices, &mut output)?,
        };
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        files.push(json!({"relative":name,"before":before,"after":hash_file(&staged)?,"backup":format!("{i}.before")}));
    }
    let mut journal = json!({"schemaVersion":1,"title":title,"createdAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()as u64,"state":"prepared","files":files});
    atomic(
        &dir.join("journal.json"),
        &serde_json::to_vec(&journal).unwrap(),
    )?;
    for (i, (relative, _)) in outputs.iter().enumerate() {
        let target = join(root, relative)?;
        if hash_file(&target)? != journal["files"][i]["before"].as_str().unwrap() {
            return Err("编辑前源文件发生变化，已保留恢复记录".into());
        }
        fs::rename(dir.join(format!("{i}.after")), &target).map_err(|e| e.to_string())?;
    }
    journal["state"] = json!("committed");
    atomic(
        &dir.join("journal.json"),
        &serde_json::to_vec(&journal).unwrap(),
    )?;
    Ok(json!({"transaction":id,"files":outputs.len()}))
}
pub fn apply(root: &Path, v: &Value) -> Result<Value> {
    let _lock = lock(root)?;
    ensure_clean(root)?;
    let p = &v["plan"];
    if hash_file(&join(root, "level.dat")?)? != p["levelHash"].as_str().ok_or("计划无效")? {
        return Err("世界属性已变化，请重新预览".into());
    }
    let remove: HashSet<usize> = p["selected"]
        .as_array()
        .ok_or("计划无效")?
        .iter()
        .map(|n| {
            n.as_u64()
                .filter(|n| *n < 1024)
                .map(|n| n as usize)
                .ok_or_else(|| "计划无效".to_string())
        })
        .collect::<Result<_>>()?;
    if remove.is_empty() {
        return Err("没有符合条件的区块".into());
    }
    let mut outputs = Vec::new();
    for f in p["files"].as_array().ok_or("计划无效")? {
        let relative = f["relative"].as_str().ok_or("计划无效")?;
        let file = join(root, relative)?;
        if hash_file(&file)? != f["before"].as_str().ok_or("计划无效")? {
            return Err("区域文件已变化，请重新预览".into());
        }
        outputs.push((relative.to_string(), Change::Region(remove.clone())));
    }
    transaction(
        root,
        v["transaction"].as_str().ok_or("缺少事务 ID")?,
        &format!("清理 {} 个区块", remove.len()),
        outputs,
    )
}
pub fn edit(root: &Path, v: &Value) -> Result<Value> {
    let _lock = lock(root)?;
    ensure_clean(root)?;
    let mut root_nbt = world::level(root)?;
    let fastnbt::Value::Compound(r) = &mut root_nbt else {
        return Err("存档 NBT 结构无效".into());
    };
    let Some(fastnbt::Value::Compound(data)) = r.get_mut("Data") else {
        return Err("不支持的存档属性结构".into());
    };
    let patch = v["patch"].as_object().ok_or("缺少修改内容")?;
    for (key, value) in patch {
        let (field, next) = match key.as_str() {
            "name" => (
                "LevelName",
                fastnbt::Value::String(
                    value
                        .as_str()
                        .filter(|s| !s.trim().is_empty() && s.len() <= 320)
                        .ok_or("世界名无效")?
                        .into(),
                ),
            ),
            "gameType" => (
                "GameType",
                fastnbt::Value::Int(
                    value
                        .as_i64()
                        .filter(|v| (0..=3).contains(v))
                        .ok_or("游戏模式无效")? as i32,
                ),
            ),
            "difficulty" => (
                "Difficulty",
                fastnbt::Value::Byte(
                    value
                        .as_i64()
                        .filter(|v| (0..=3).contains(v))
                        .ok_or("难度无效")? as i8,
                ),
            ),
            "commands" => (
                "allowCommands",
                fastnbt::Value::Byte(value.as_bool().ok_or("作弊开关无效")? as i8),
            ),
            "hardcore" => (
                "hardcore",
                fastnbt::Value::Byte(value.as_bool().ok_or("硬核开关无效")? as i8),
            ),
            "spawnX" | "spawnY" | "spawnZ" => {
                let field = match key.as_str() {
                    "spawnX" => "SpawnX",
                    "spawnY" => "SpawnY",
                    _ => "SpawnZ",
                };
                (
                    field,
                    fastnbt::Value::Int(
                        value
                            .as_i64()
                            .filter(|v| (-30_000_000..=30_000_000).contains(v))
                            .ok_or("出生点越界")? as i32,
                    ),
                )
            }
            _ => return Err("不支持的属性修改".into()),
        };
        if !data.contains_key(field) {
            return Err(format!("当前存档缺少 {field}，未修改"));
        }
        data.insert(field.into(), next);
    }
    let bytes = fastnbt::to_bytes(&root_nbt).map_err(|e| e.to_string())?;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(&bytes).map_err(|e| e.to_string())?;
    let output = encoder.finish().map_err(|e| e.to_string())?;
    transaction(
        root,
        v["transaction"].as_str().ok_or("缺少事务 ID")?,
        "修改存档属性",
        vec![("level.dat".into(), Change::Bytes(output))],
    )
}
pub fn undo(root: &Path, v: &Value) -> Result<Value> {
    let _lock = lock(root)?;
    let id = v["transaction"].as_str().ok_or("缺少历史 ID")?;
    let dir = join(&history_root(root)?, id)?;
    let journal_file = join(&dir, "journal.json")?;
    let mut journal: Value =
        serde_json::from_slice(&fs::read(&journal_file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if journal["schemaVersion"] != 1
        || !["committed", "prepared"].contains(&journal["state"].as_str().unwrap_or(""))
    {
        return Err("该记录不能恢复".into());
    }
    let mut outputs = Vec::new();
    for f in journal["files"].as_array().ok_or("恢复记录损坏")? {
        let relative = f["relative"].as_str().ok_or("恢复记录损坏")?;
        let target = join(root, relative)?;
        let current = hash_file(&target)?;
        if Some(current.as_str()) != f["after"].as_str()
            && Some(current.as_str()) != f["before"].as_str()
        {
            return Err("文件在编辑后已改变，拒绝覆盖；请使用完整备份恢复".into());
        }
        let backup = join(&dir, f["backup"].as_str().ok_or("恢复记录损坏")?)?;
        if hash_file(&backup)? != f["before"].as_str().ok_or("恢复记录损坏")? {
            return Err("原文件备份校验失败".into());
        }
        outputs.push((target, backup));
    }
    // Mark recovery as pending as well: a crash midway can safely resume this same record.
    journal["state"] = json!("prepared");
    atomic(&journal_file, &serde_json::to_vec(&journal).unwrap())?;
    for (target, backup) in &outputs {
        let staged = dir.join(format!("restore-{}.tmp", std::process::id()));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|e| e.to_string())?;
        std::io::copy(
            &mut File::open(backup).map_err(|e| e.to_string())?,
            &mut output,
        )
        .map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        fs::rename(staged, target).map_err(|e| e.to_string())?;
    }
    journal["state"] = json!("undone");
    atomic(&journal_file, &serde_json::to_vec(&journal).unwrap())?;
    Ok(json!({"restored":outputs.len()}))
}
