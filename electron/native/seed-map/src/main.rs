use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    ffi::{CStr, CString, c_char, c_int, c_void},
    io::{self, Read},
    time::Instant,
};
type Result<T> = std::result::Result<T, String>;
const REVISION: &str = "b99f6e472018cab903a096697117aab9d9170a19";
const VERSIONS: &[&str] = &[
    "1.0.0", "1.1.0", "1.2.5", "1.3.2", "1.4.7", "1.5.2", "1.6.4", "1.7.10", "1.8.9", "1.9.4",
    "1.10.2", "1.11.2", "1.12.2", "1.13.2", "1.14.4", "1.15.2", "1.16.1", "1.16.5", "1.17.1",
    "1.18.2", "1.19.2", "1.19.4", "1.20.6", "1.21.1", "1.21.3", "1.21.4", "1.21.5", "1.21.6",
    "1.21.9", "1.21.11", "26.1", "26.2", "26.3",
];
const BOUND: i32 = 30_000_000;
const MAX_CHECKS: usize = 262_144;
// These IDs follow Cubiomes' StructureType enum, not any launcher's implementation.
const STRUCTURES: &[(&str, i32, &str, &str)] = &[
    ("desert_pyramid", 1, "overworld", "1.3.2"),
    ("jungle_temple", 2, "overworld", "1.3.2"),
    ("swamp_hut", 3, "overworld", "1.4.7"),
    ("igloo", 4, "overworld", "1.9.4"),
    ("village", 5, "overworld", "1.0.0"),
    ("ocean_ruin", 6, "overworld", "1.13.2"),
    ("shipwreck", 7, "overworld", "1.13.2"),
    ("monument", 8, "overworld", "1.8.9"),
    ("mansion", 9, "overworld", "1.11.2"),
    ("outpost", 10, "overworld", "1.14.4"),
    ("ruined_portal", 11, "overworld", "1.16.1"),
    ("ruined_portal_nether", 12, "nether", "1.16.1"),
    ("ancient_city", 13, "overworld", "1.19.2"),
    ("buried_treasure", 14, "overworld", "1.13.2"),
    ("mineshaft", 15, "overworld", "1.0.0"),
    ("desert_well", 16, "overworld", "1.13.2"),
    ("geode", 17, "overworld", "1.17.1"),
    ("fortress", 18, "nether", "1.0.0"),
    ("bastion", 19, "nether", "1.16.1"),
    ("nether_fossil", 20, "nether", "1.16.1"),
    ("end_city", 21, "end", "1.9.4"),
    ("end_gateway", 22, "end", "1.13.2"),
    ("end_island", 23, "end", "1.13.2"),
    ("trail_ruins", 24, "overworld", "1.20.6"),
    ("trial_chambers", 25, "overworld", "1.21.1"),
    ("abandoned_camp", 26, "overworld", "26.3"),
    ("stronghold", -1, "overworld", "1.0.0"),
    ("spawn", -2, "overworld", "1.0.0"),
    ("slime_chunk", -3, "overworld", "1.0.0"),
];

unsafe extern "C" {
    fn km_create(version: *const c_char, dim: c_int, seed: u64, large: c_int) -> *mut c_void;
    fn km_free(ptr: *mut c_void);
    fn km_biome(ptr: *mut c_void, x: c_int, y: c_int, z: c_int) -> c_int;
    fn km_biome_name(ptr: *mut c_void, id: c_int) -> *const c_char;
    fn km_biome_exists(ptr: *mut c_void, id: c_int) -> c_int;
    fn km_color(ptr: *mut c_void, id: c_int) -> c_int;
    fn km_tile(
        ptr: *mut c_void,
        x: c_int,
        z: c_int,
        y: c_int,
        step: c_int,
        size: c_int,
        out: *mut c_int,
    ) -> c_int;
    fn km_structure_region(ptr: *mut c_void, kind: c_int) -> c_int;
    fn km_structure(
        ptr: *mut c_void,
        kind: c_int,
        rx: c_int,
        rz: c_int,
        x: *mut c_int,
        z: *mut c_int,
    ) -> c_int;
    fn km_strongholds(ptr: *mut c_void, out: *mut c_int) -> c_int;
    fn km_spawn(ptr: *mut c_void, x: *mut c_int, z: *mut c_int);
    fn km_slime(ptr: *mut c_void, cx: c_int, cz: c_int) -> c_int;
}
struct Map {
    ptr: *mut c_void,
    dimension: String,
    y: i32,
}
impl Drop for Map {
    fn drop(&mut self) {
        unsafe { km_free(self.ptr) }
    }
}
impl Map {
    fn new(v: &Value) -> Result<Self> {
        let version = text(v, "version")?;
        if !VERSIONS.contains(&version) {
            return Err("暂不支持此 Java 版本".into());
        }
        let seed = text(v, "seed")?
            .parse::<i64>()
            .map_err(|_| "种子超出有符号 64 位范围")?;
        let dimension = text(v, "dimension")?;
        let dim = match dimension {
            "overworld" => 0,
            "nether" => -1,
            "end" => 1,
            _ => return Err("维度无效".into()),
        };
        let y = int(v, "y", -64, 320)?;
        let large = match v.get("largeBiomes") {
            None => false,
            Some(n) => n.as_bool().ok_or("群系选项无效")?,
        };
        let version = CString::new(version).map_err(|_| "版本无效")?;
        let ptr = unsafe { km_create(version.as_ptr(), dim, seed as u64, large as i32) };
        if ptr.is_null() {
            return Err("种子核心初始化失败".into());
        }
        Ok(Self {
            ptr,
            dimension: dimension.into(),
            y,
        })
    }
    fn biome(&self, x: i32, z: i32) -> i32 {
        unsafe { km_biome(self.ptr, x, self.y, z) }
    }
    fn name(&self, id: i32) -> String {
        unsafe {
            let p = km_biome_name(self.ptr, id);
            if p.is_null() {
                format!("biome_{id}")
            } else {
                CStr::from_ptr(p).to_string_lossy().into()
            }
        }
    }
    fn color(&self, id: i32) -> u32 {
        unsafe { km_color(self.ptr, id) as u32 }
    }
    fn slime(&self, x: i32, z: i32) -> bool {
        self.dimension == "overworld"
            && unsafe { km_slime(self.ptr, x.div_euclid(16), z.div_euclid(16)) != 0 }
    }
    fn spawn(&self) -> (i32, i32) {
        let (mut x, mut z) = (0, 0);
        unsafe { km_spawn(self.ptr, &mut x, &mut z) };
        (x, z)
    }
    fn strongholds(&self) -> Vec<(i32, i32)> {
        let mut raw = [0; 256];
        let n = unsafe { km_strongholds(self.ptr, raw.as_mut_ptr()) };
        raw[..n as usize * 2]
            .chunks_exact(2)
            .map(|p| (p[0], p[1]))
            .collect()
    }
    fn available(&self, kind: i32) -> i32 {
        if kind < 0 {
            if self.dimension == "overworld" { 16 } else { 0 }
        } else {
            unsafe { km_structure_region(self.ptr, kind) }
        }
    }
    fn feature(&self, kind: i32, rx: i32, rz: i32) -> Option<(i32, i32)> {
        if kind == -3 {
            return self.slime(rx * 16, rz * 16).then_some((rx * 16, rz * 16));
        }
        let (mut x, mut z) = (0, 0);
        let found = unsafe { km_structure(self.ptr, kind, rx, rz, &mut x, &mut z) } != 0;
        (found && x.abs() <= BOUND && z.abs() <= BOUND).then_some((x, z))
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or_else(|| format!("缺少参数 {key}"))
}
fn int(v: &Value, key: &str, min: i32, max: i32) -> Result<i32> {
    let n = v[key]
        .as_i64()
        .ok_or_else(|| format!("参数 {key} 需为整数"))?;
    if n < min as i64 || n > max as i64 {
        Err(format!("参数 {key} 超出范围"))
    } else {
        Ok(n as i32)
    }
}
fn coord(v: &Value, key: &str) -> Result<i32> {
    int(v, key, -BOUND, BOUND)
}
fn structure(name: &str) -> Result<i32> {
    STRUCTURES
        .iter()
        .find(|s| s.0 == name)
        .map(|s| s.1)
        .ok_or("结构类型无效".into())
}
fn feature(name: &str, x: i32, z: i32) -> Value {
    json!({"id":format!("{name}:{x}:{z}"),"type":name,"x":x,"z":z,"approximate":name!="slime_chunk"})
}
fn biome_dimension(id: i32) -> &'static str {
    match id {
        8 | 170..=173 => "nether",
        9 | 40..=43 => "end",
        _ => "overworld",
    }
}
fn info() -> Result<Value> {
    let map = Map::new(&json!({"seed":"0","version":"26.3","dimension":"overworld","y":64}))?;
    let version_maps = VERSIONS
        .iter()
        .map(|version| {
            Map::new(&json!({"seed":"0","version":version,"dimension":"overworld","y":64}))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut biomes = vec![];
    // Include older valid biome identifiers as well as the modern palette.
    for id in 0..256 {
        let name = map.name(id);
        if !name.starts_with("biome_") && id != 127 {
            let versions: Vec<_> = VERSIONS
                .iter()
                .zip(&version_maps)
                .filter(|(_, version_map)| unsafe { km_biome_exists(version_map.ptr, id) } != 0)
                .map(|(version, _)| *version)
                .collect();
            biomes.push(json!({"id":id,"name":name,"color":format!("#{:06x}",map.color(id)),"dimension":biome_dimension(id),"versions":versions}));
        }
    }
    Ok(
        json!({"engine":"Rust + Cubiomes","revision":REVISION,"versions":VERSIONS.iter().rev().map(|id|json!({"id":id,"name":if *id=="1.0.0" {"Java 1.0.0 (experimental)".to_string()}else{format!("Java {id}")}})).collect::<Vec<_>>(),"biomes":biomes,"structures":STRUCTURES.iter().map(|(id,_,dim,min)|json!({"id":id,"name":id,"dimension":dim,"minVersion":min})).collect::<Vec<_>>()}),
    )
}
fn tile(map: &Map, v: &Value) -> Result<Value> {
    let x = coord(v, "x")?;
    let z = coord(v, "z")?;
    let step = int(v, "step", 1, 256)?;
    let size = int(v, "size", 64, 256)?;
    if ![1, 4, 16, 64, 256].contains(&step)
        || ![64, 128, 256].contains(&size)
        || x % step != 0
        || z % step != 0
    {
        return Err("瓦片尺寸或坐标对齐无效".into());
    }
    if x as i64 + (size - 1) as i64 * step as i64 > BOUND as i64
        || z as i64 + (size - 1) as i64 * step as i64 > BOUND as i64
    {
        return Err("瓦片超出世界边界".into());
    }
    let mut ids = vec![0; size as usize * size as usize];
    if unsafe { km_tile(map.ptr, x, z, map.y, step, size, ids.as_mut_ptr()) } != 0 {
        return Err("群系生成失败".into());
    }
    let mut biomes = Vec::with_capacity(ids.len() * 2);
    let mut rgba = Vec::with_capacity(ids.len() * 4);
    for id in ids {
        if !(0..256).contains(&id) {
            return Err("生成器返回无效群系".into());
        }
        let c = map.color(id);
        biomes.extend_from_slice(&(id as u16).to_le_bytes());
        rgba.extend_from_slice(&[(c >> 16) as u8, (c >> 8) as u8, c as u8, 255]);
    }
    Ok(
        json!({"x":x,"z":z,"step":step,"width":size,"height":size,"biomes":STANDARD.encode(biomes),"rgba":STANDARD.encode(rgba)}),
    )
}
fn features(map: &Map, v: &Value) -> Result<Value> {
    let (x0, z0, x1, z1) = (
        coord(v, "x0")?,
        coord(v, "z0")?,
        coord(v, "x1")?,
        coord(v, "z1")?,
    );
    if x1 < x0 || z1 < z0 || x1 - x0 > 131072 || z1 - z0 > 131072 {
        return Err("地图范围过大".into());
    }
    let limit = int(v, "limit", 1, 1024)? as usize;
    let types = v["types"].as_array().ok_or("缺少结构类型")?;
    if types.len() > 32 {
        return Err("结构类型过多".into());
    }
    let mut items = vec![];
    let mut checks = 0;
    let mut truncated = false;
    let mut spawn = None;
    'types: for t in types {
        let name = t.as_str().ok_or("结构类型无效")?;
        let kind = structure(name)?;
        let span = map.available(kind);
        if span == 0 {
            continue;
        }
        let in_rect = |(x, z): (i32, i32)| x >= x0 && x < x1 && z >= z0 && z < z1;
        if kind == -2 {
            let p = map.spawn();
            spawn = Some(json!({"x":p.0,"z":p.1}));
            if in_rect(p) {
                items.push(feature(name, p.0, p.1));
            }
        } else if kind == -1 {
            for p in map.strongholds() {
                if in_rect(p) {
                    items.push(feature(name, p.0, p.1));
                    if items.len() >= limit {
                        truncated = true;
                        break 'types;
                    }
                }
            }
        } else {
            for rz in z0.div_euclid(span)..=(z1 - 1).div_euclid(span) {
                for rx in x0.div_euclid(span)..=(x1 - 1).div_euclid(span) {
                    checks += 1;
                    if checks > MAX_CHECKS {
                        truncated = true;
                        break 'types;
                    }
                    if let Some(p) = map.feature(kind, rx, rz) {
                        if in_rect(p) {
                            items.push(feature(name, p.0, p.1));
                            if items.len() >= limit {
                                truncated = true;
                                break 'types;
                            }
                        }
                    }
                }
            }
        }
        if items.len() >= limit {
            truncated = true;
            break;
        }
    }
    let mut result = json!({"items":items,"truncated":truncated});
    if let Some(spawn) = spawn {
        result["spawn"] = spawn;
    }
    Ok(result)
}
fn locate(map: &Map, v: &Value) -> Result<Value> {
    let (x, z) = (coord(v, "x")?, coord(v, "z")?);
    let radius = int(v, "radius", 64, 16384)?;
    let limit = int(v, "limit", 1, 32)? as usize;
    let target = text(v, "target")?;
    let mut points: Vec<(i32, i32)> = vec![];
    let mut truncated = false;
    let mut sample = 1;
    let distance =
        |p: (i32, i32)| ((p.0 as f64 - x as f64).powi(2) + (p.1 as f64 - z as f64).powi(2)).sqrt();
    let kind = text(v, "kind")?;
    if kind == "structure" {
        let typ = structure(target)?;
        let span = map.available(typ);
        if span == 0 {
            return Err("该版本或维度不支持此结构".into());
        }
        if typ == -1 {
            points = map.strongholds();
        } else if typ == -2 {
            points.push(map.spawn());
        } else {
            let (cx, cz) = (x.div_euclid(span), z.div_euclid(span));
            let rings = radius / span + 2;
            let mut checks = 0;
            'rings: for ring in 0..=rings {
                for dz in -ring..=ring {
                    for dx in -ring..=ring {
                        if ring > 0 && dx.abs() != ring && dz.abs() != ring {
                            continue;
                        }
                        let (rx, rz) = (cx + dx, cz + dz);
                        if (rx as i64 * span as i64).abs() > BOUND as i64
                            || (rz as i64 * span as i64).abs() > BOUND as i64
                        {
                            continue;
                        }
                        checks += 1;
                        if checks > MAX_CHECKS {
                            truncated = true;
                            break 'rings;
                        }
                        if let Some(p) = map.feature(typ, rx, rz) {
                            if distance(p) <= radius as f64 {
                                points.push(p);
                            }
                        }
                    }
                }
                points.sort_by(|a, b| distance(*a).total_cmp(&distance(*b)));
                points.truncate(limit);
                // Unvisited regions are at least (ring-1)*span from the search point.
                if points.len() == limit
                    && (ring - 1) * span > distance(*points.last().unwrap()).ceil() as i32
                {
                    break;
                }
            }
        }
    } else if kind == "biome" {
        let id = target
            .parse::<i32>()
            .ok()
            .filter(|id| (0..256).contains(id))
            .or_else(|| (0..256).find(|id| map.name(*id) == target))
            .ok_or("群系不存在")?;
        if unsafe { km_biome_exists(map.ptr, id) } == 0 || biome_dimension(id) != map.dimension {
            return Err("该版本或维度不支持此群系".into());
        }
        sample = if radius <= 512 {
            4
        } else if radius <= 2048 {
            16
        } else if radius <= 8192 {
            64
        } else {
            128
        };
        let mut candidates = vec![];
        let max = radius / sample;
        for dz in -max..=max {
            for dx in -max..=max {
                let p = (x + dx * sample, z + dz * sample);
                if p.0.abs() <= BOUND && p.1.abs() <= BOUND && distance(p) <= radius as f64 {
                    candidates.push(p);
                }
            }
        }
        candidates.sort_by(|a, b| distance(*a).total_cmp(&distance(*b)));
        for p in candidates {
            if map.biome(p.0, p.1) == id
                && points
                    .iter()
                    .all(|q| ((p.0 - q.0).abs().max((p.1 - q.1).abs())) >= sample * 4)
            {
                points.push(p);
                if points.len() >= limit {
                    break;
                }
            }
        }
    } else {
        return Err("查找类型无效".into());
    }
    points.retain(|p| distance(*p) <= radius as f64);
    points.sort_by(|a, b| distance(*a).total_cmp(&distance(*b)));
    points.truncate(limit);
    let items: Vec<Value> = points
        .into_iter()
        .map(|p| {
            let mut f = feature(target, p.0, p.1);
            f["distance"] = json!(distance(p));
            if kind == "biome" {
                f["y"] = json!(map.y);
                f["approximate"] = json!(true);
            }
            f
        })
        .collect();
    Ok(
        json!({"items":items,"searchedRadius":radius,"truncated":truncated,"approximate":kind=="biome" || target!="slime_chunk","sampleStep":sample}),
    )
}
fn run(v: Value) -> Result<Value> {
    if v["protocol"] != 1 {
        return Err("种子地图协议版本无效".into());
    }
    let started = Instant::now();
    let command = text(&v, "command")?;
    let mut data = if command == "info" {
        info()?
    } else {
        let m = Map::new(&v)?;
        match command {
            "tile" => tile(&m, &v)?,
            "features" => features(&m, &v)?,
            "locate" => locate(&m, &v)?,
            "biome" => {
                let (x, z) = (coord(&v, "x")?, coord(&v, "z")?);
                let id = m.biome(x, z);
                json!({"id":id,"name":m.name(id),"color":format!("#{:06x}",m.color(id)),"slime":m.slime(x,z)})
            }
            _ => return Err("未知种子地图操作".into()),
        }
    };
    let elapsed = started.elapsed().as_secs_f64() * 1000.;
    data["elapsedMs"] = json!(elapsed);
    Ok(json!({"protocol":1,"data":data,"engine":"Rust + Cubiomes","elapsedMs":elapsed}))
}
fn main() {
    let mut input = Vec::new();
    let read = io::stdin().take(65537).read_to_end(&mut input);
    let result = if read.is_err() || input.len() > 65536 {
        Err("请求过大或读取失败".into())
    } else {
        serde_json::from_slice(&input)
            .map_err(|_| "请求 JSON 无效".to_string())
            .and_then(run)
    };
    match result {
        Ok(result) => println!("{}", json!({"ok":true,"result":result})),
        Err(error) => {
            println!("{}", json!({"ok":false,"error":error}));
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests;
