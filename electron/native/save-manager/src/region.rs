use crate::{Result, nbt, safety};
use base64::{Engine, engine::general_purpose::STANDARD};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub x: i32,
    pub z: i32,
    pub timestamp: u32,
    pub bytes: u64,
    pub index: usize,
    #[serde(skip)]
    pub offset: u64,
    #[serde(skip)]
    pub sectors: u8,
}
pub fn coords(name: &str) -> Option<(i32, i32)> {
    let p: Vec<_> = name.split('.').collect();
    if p.len() != 4 || p[0] != "r" || p[3] != "mca" {
        return None;
    }
    let x = p[1].parse::<i32>().ok()?;
    let z = p[2].parse::<i32>().ok()?;
    if x.unsigned_abs() > 60_000 || z.unsigned_abs() > 60_000 {
        return None;
    }
    Some((x, z))
}
pub fn dimension(root: &Path, dim: &str) -> Result<PathBuf> {
    if ["overworld", "the_nether", "the_end"].contains(&dim) {
        let modern = safety::join(root, &format!("dimensions/minecraft/{dim}"))?;
        if modern.join("region").is_dir() {
            return Ok(modern);
        }
    }
    match dim {
        "overworld" => Ok(root.to_owned()),
        "the_nether" => safety::join(root, "DIM-1"),
        "the_end" => safety::join(root, "DIM1"),
        v if v.starts_with("dimensions/") => safety::join(root, v),
        _ => Err("无效维度".into()),
    }
}
pub fn header(file: &Path, rx: i32, rz: i32) -> Result<Vec<Chunk>> {
    safety::check_absolute(file)?;
    let mut f = File::open(file).map_err(|e| e.to_string())?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    if size < 8192 {
        return Err("区域文件头不足 8 KiB".into());
    }
    let mut b = [0u8; 8192];
    f.read_exact(&mut b).map_err(|e| e.to_string())?;
    let mut intervals = vec![(0u64, 8192u64)];
    let mut out = Vec::new();
    for i in 0..1024 {
        let loc = u32::from_be_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        if loc == 0 {
            continue;
        }
        let offset = (loc >> 8) as u64 * 4096;
        let sectors = (loc & 255) as u8;
        let end = offset + sectors as u64 * 4096;
        if sectors == 0 || offset < 8192 || end > size {
            return Err(format!("区块 {i} 的扇区范围越界"));
        }
        intervals.push((offset, end));
        out.push(Chunk {
            x: rx * 32 + (i % 32) as i32,
            z: rz * 32 + (i / 32) as i32,
            timestamp: u32::from_be_bytes(b[4096 + i * 4..4100 + i * 4].try_into().unwrap()),
            bytes: sectors as u64 * 4096,
            index: i,
            offset,
            sectors,
        });
    }
    intervals.sort_unstable();
    if intervals.windows(2).any(|v| v[0].1 > v[1].0) {
        return Err("区域文件存在重叠扇区，拒绝编辑".into());
    }
    Ok(out)
}
pub fn decode(file: &Path, c: &Chunk) -> Result<fastnbt::Value> {
    let mut f = File::open(file).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(c.offset))
        .map_err(|e| e.to_string())?;
    let mut h = [0u8; 5];
    f.read_exact(&mut h).map_err(|e| e.to_string())?;
    let length = u32::from_be_bytes(h[..4].try_into().unwrap()) as usize;
    if length == 0 || length + 4 > c.sectors as usize * 4096 {
        return Err("区块长度无效".into());
    }
    let external = h[4] & 128 != 0;
    let bytes = if external {
        let ext = safety::join(
            file.parent().ok_or("缺少区域目录")?,
            &format!("c.{}.{}.mcc", c.x, c.z),
        )?;
        if fs::metadata(&ext).map_err(|e| e.to_string())?.len() > nbt::LIMIT {
            return Err("外部区块超过读取限制".into());
        }
        fs::read(ext).map_err(|e| e.to_string())?
    } else {
        let mut b = vec![0; length - 1];
        f.read_exact(&mut b).map_err(|e| e.to_string())?;
        b
    };
    nbt::parse(&nbt::inflate(&bytes, h[4] & 127)?)
}
pub fn file_from_request(root: &Path, v: &Value, kind: &str) -> Result<PathBuf> {
    let dim = dimension(root, v["dimension"].as_str().ok_or("缺少维度")?)?;
    let rx = v["rx"]
        .as_i64()
        .filter(|n| n.abs() <= 60_000)
        .ok_or("区域坐标越界")?;
    let rz = v["rz"]
        .as_i64()
        .filter(|n| n.abs() <= 60_000)
        .ok_or("区域坐标越界")?;
    safety::join(&dim, &format!("{kind}/r.{rx}.{rz}.mca"))
}
// Sample a real generated chunk per map pixel at distant zooms. Empty cells stay transparent.
pub fn terrain_tiles(root: &Path, v: &Value) -> Result<Value> {
    let side = v["side"]
        .as_u64()
        .filter(|v| [1, 8, 32].contains(v))
        .ok_or("地图分辨率无效")? as usize;
    let regions = v["regions"]
        .as_array()
        .filter(|r| !r.is_empty() && r.len() <= 32)
        .ok_or("地图范围无效")?;
    let data: Vec<_> = regions
        .iter()
        .map(|r| {
            let query = json!({"dimension":v["dimension"],"rx":r["rx"],"rz":r["rz"]});
            let result = (|| -> Result<String> {
                let path = file_from_request(root, &query, "region")?;
                let chunks = header(
                    &path,
                    query["rx"].as_i64().unwrap() as i32,
                    query["rz"].as_i64().unwrap() as i32,
                )?;
                let mut samples = vec![None; side * side];
                let span = 32 / side;
                for (i, c) in chunks.iter().enumerate() {
                    let x = c.index % 32;
                    let z = c.index / 32;
                    let index = (z / span) * side + x / span;
                    let dx = (2 * (x % span) + 1).abs_diff(span);
                    let dz = (2 * (z % span) + 1).abs_diff(span);
                    let dist = dx * dx + dz * dz;
                    if samples[index].is_none_or(|(old, _)| dist < old) {
                        samples[index] = Some((dist, i));
                    }
                }
                let pixels: Vec<[u8; 4]> = samples
                    .par_iter()
                    .map(|slot| {
                        let (_, i) = (*slot)?;
                        let doc = decode(&path, &chunks[i]).ok()?;
                        let surface = nbt::surface(&doc).ok()?;
                        let mut sum = [0u32; 3];
                        let mut n = 0;
                        for pixel in surface.pixels.chunks_exact(4).filter(|p| p[3] != 0) {
                            for channel in 0..3 {
                                sum[channel] += pixel[channel] as u32;
                            }
                            n += 1;
                        }
                        (n > 0).then(|| {
                            [
                                (sum[0] / n) as u8,
                                (sum[1] / n) as u8,
                                (sum[2] / n) as u8,
                                255,
                            ]
                        })
                    })
                    .map(|pixel| pixel.unwrap_or([0; 4]))
                    .collect();
                Ok(STANDARD.encode(pixels.as_flattened()))
            })();
            match result {
                Ok(pixels) => json!({"rx":r["rx"],"rz":r["rz"],"pixels":pixels}),
                Err(error) => json!({"rx":r["rx"],"rz":r["rz"],"error":error}),
            }
        })
        .collect();
    Ok(json!(data))
}
pub fn inspect(root: &Path, v: &Value) -> Result<Value> {
    let file = file_from_request(root, v, "region")?;
    let rx = v["rx"].as_i64().unwrap() as i32;
    let rz = v["rz"].as_i64().unwrap() as i32;
    let chunks = header(&file, rx, rz)?;
    // Cache content is advisory only and never used to decide destructive operations.
    let stamp = fs::metadata(&file).map_err(|e| e.to_string())?;
    let fingerprint = format!(
        "v2:{}:{}:{}",
        file.display(),
        stamp.len(),
        stamp
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let cache = v["cache"].as_str().map(PathBuf::from);
    let key = safety::hash(fingerprint.as_bytes());
    let cache_file = if let Some(cache) = cache {
        safety::check_absolute(&cache)?;
        Some(cache.join(format!("{key}.json")))
    } else {
        None
    };
    let external = fs::read_dir(file.parent().unwrap())
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .any(|e| e.path().extension().is_some_and(|x| x == "mcc"));
    if !external {
        if let Some(p) = &cache_file {
            if let Ok(b) = fs::read(p) {
                if b.len() < 8 * 1024 * 1024 {
                    if let Ok(mut data) = serde_json::from_slice::<Value>(&b) {
                        data["cached"] = json!(true);
                        return Ok(data);
                    }
                }
            }
        }
    }
    let results: Vec<_> = chunks
        .par_iter()
        .map(|c| {
            let mut detail =
                json!({"x":c.x,"z":c.z,"index":c.index,"timestamp":c.timestamp,"bytes":c.bytes});
            match decode(&file, c).and_then(|root| {
                let chunk = nbt::data(&root);
                detail["dataVersion"] = json!(nbt::num(nbt::get(&root, "DataVersion")));
                detail["status"] = json!(nbt::string(nbt::get(chunk, "Status")));
                detail["inhabitedTicks"] = json!(nbt::num(nbt::get(chunk, "InhabitedTime")));
                let entities = nbt::list(
                    nbt::get(chunk, "block_entities").or_else(|| nbt::get(chunk, "TileEntities")),
                )
                .unwrap_or(&[]);
                detail["blockEntities"] = json!(
                    entities
                        .iter()
                        .filter_map(|e| nbt::string(nbt::get(e, "id")))
                        .take(128)
                        .collect::<Vec<_>>()
                );
                let tile = nbt::surface(&root)?;
                detail["palette"] = json!(tile.palette);
                Ok(tile)
            }) {
                Ok(pixels) => (detail, Some(pixels)),
                Err(e) => {
                    detail["error"] = json!(e);
                    (detail, None)
                }
            }
        })
        .collect();
    let mut pixels = vec![0u8; 512 * 512 * 4];
    let mut heights = vec![i16::MIN; 512 * 512];
    let mut details = Vec::with_capacity(chunks.len());
    for (i, (detail, tile)) in results.into_iter().enumerate() {
        if let Some(tile) = tile {
            let c = &chunks[i];
            let x = (c.index % 32) * 16;
            let z = (c.index / 32) * 16;
            for row in 0..16 {
                let at = ((z + row) * 512 + x) * 4;
                pixels[at..at + 64].copy_from_slice(&tile.pixels[row * 64..row * 64 + 64]);
                heights[at / 4..at / 4 + 16]
                    .copy_from_slice(&tile.heights[row * 16..row * 16 + 16]);
            }
        }
        details.push(detail);
    }
    // Northwest light makes slopes legible without altering the map's block coordinates.
    for (i, &height) in heights.iter().enumerate() {
        if height == i16::MIN {
            continue;
        }
        let slope = |other: Option<&i16>| {
            other
                .filter(|v| **v != i16::MIN)
                .map_or(0, |v| (height - *v).clamp(-6, 6))
        };
        let west = if i % 512 > 0 {
            Some(&heights[i - 1])
        } else {
            None
        };
        let north = i.checked_sub(512).and_then(|p| heights.get(p));
        let light = 100 + slope(north) * 3 + slope(west) * 2;
        for c in &mut pixels[i * 4..i * 4 + 3] {
            *c = ((*c as i32 * light as i32) / 100).min(255) as u8;
        }
    }
    let mut image = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut image, 512, 512);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&pixels)
            .map_err(|e| e.to_string())?;
    }
    let data = json!({"rx":rx,"rz":rz,"chunks":details,"image":format!("data:image/png;base64,{}",STANDARD.encode(image)),"cached":false});
    if !external {
        if let Some(p) = cache_file {
            if let Ok(bytes) = serde_json::to_vec(&data) {
                let _ = safety::atomic(&p, &bytes);
            }
        }
    }
    Ok(data)
}
// Copy untouched compressed records verbatim. Unknown compression is preserved, never decoded/re-encoded.
pub fn write_compact(
    file: &Path,
    remove: &std::collections::HashSet<usize>,
    out: &mut (impl Write + Seek),
) -> Result<()> {
    let (rx, rz) = coords(
        file.file_name()
            .and_then(|n| n.to_str())
            .ok_or("区域名无效")?,
    )
    .ok_or("区域名无效")?;
    let chunks = header(file, rx, rz)?;
    let mut input = File::open(file).map_err(|e| e.to_string())?;
    let mut table = [0u8; 8192];
    out.write_all(&table).map_err(|e| e.to_string())?;
    let mut sector = 2u32;
    for c in chunks {
        if remove.contains(&c.index) {
            continue;
        }
        let loc = (sector << 8) | c.sectors as u32;
        table[c.index * 4..c.index * 4 + 4].copy_from_slice(&loc.to_be_bytes());
        table[4096 + c.index * 4..4100 + c.index * 4].copy_from_slice(&c.timestamp.to_be_bytes());
        input
            .seek(SeekFrom::Start(c.offset))
            .map_err(|e| e.to_string())?;
        let copied =
            std::io::copy(&mut (&mut input).take(c.bytes), out).map_err(|e| e.to_string())?;
        if copied != c.bytes {
            return Err("区域在读取时被截断".into());
        }
        sector += c.sectors as u32;
    }
    out.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    out.write_all(&table).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
pub fn compact(file: &Path, remove: &std::collections::HashSet<usize>) -> Result<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::new());
    write_compact(file, remove, &mut out)?;
    Ok(out.into_inner())
}
