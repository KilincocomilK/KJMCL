use crate::Result;
use fastnbt::Value;
use flate2::read::{GzDecoder, ZlibDecoder};
use std::{collections::HashMap, io::Read};
pub const LIMIT: u64 = 32 * 1024 * 1024;
pub fn inflate(bytes: &[u8], codec: u8) -> Result<Vec<u8>> {
    if codec == 4 {
        return java_lz4(bytes);
    }
    let reader: Box<dyn Read + '_> = match codec {
        1 => Box::new(GzDecoder::new(bytes)),
        2 => Box::new(ZlibDecoder::new(bytes)),
        3 => Box::new(bytes),
        _ => return Err(format!("暂不支持压缩类型 {codec}，未修改文件")),
    };
    let mut out = Vec::new();
    reader
        .take(LIMIT + 1)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    if out.len() as u64 > LIMIT {
        return Err("NBT 解压超过 32 MiB 限制".into());
    }
    Ok(out)
}
fn java_lz4(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut at = 0;
    let mut out = Vec::new();
    loop {
        let h = bytes.get(at..at + 21).ok_or("LZ4 流截断")?;
        if &h[..8] != b"LZ4Block" {
            return Err("不是 Java LZ4 块流".into());
        }
        let method = h[8] & 0xf0;
        let max = 1usize << (10 + (h[8] & 15));
        let compressed = u32::from_le_bytes(h[9..13].try_into().unwrap()) as usize;
        let length = u32::from_le_bytes(h[13..17].try_into().unwrap()) as usize;
        let checksum = u32::from_le_bytes(h[17..21].try_into().unwrap());
        at += 21;
        if length == 0 && compressed == 0 && checksum == 0 {
            return Ok(out);
        }
        if length == 0 || length > max || compressed == 0 || out.len() + length > LIMIT as usize {
            return Err("LZ4 块超出限制".into());
        }
        let input = bytes.get(at..at + compressed).ok_or("LZ4 数据截断")?;
        at += compressed;
        let block = match method {
            0x10 if length == compressed => input.to_vec(),
            0x20 => {
                let mut dest = vec![0; length];
                let count = lz4_flex::block::decompress_into(input, &mut dest)
                    .map_err(|e| e.to_string())?;
                if count != length {
                    return Err("LZ4 长度不匹配".into());
                }
                dest
            }
            _ => return Err("无效 LZ4 块类型".into()),
        };
        if xxhash_rust::xxh32::xxh32(&block, 0x9747b28c) & 0x0fff_ffff != checksum {
            return Err("LZ4 校验失败".into());
        }
        out.extend(block);
    }
}
pub fn parse(bytes: &[u8]) -> Result<Value> {
    fastnbt::from_bytes(bytes).map_err(|e| format!("NBT 无效：{e}"))
}
pub fn map(v: &Value) -> Option<&HashMap<String, Value>> {
    if let Value::Compound(m) = v {
        Some(m)
    } else {
        None
    }
}
pub fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    map(v)?.get(k)
}
pub fn num(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Byte(n) => Some(*n as i64),
        Value::Short(n) => Some(*n as i64),
        Value::Int(n) => Some(*n as i64),
        Value::Long(n) => Some(*n),
        _ => None,
    }
}
pub fn string(v: Option<&Value>) -> Option<&str> {
    if let Some(Value::String(s)) = v {
        Some(s)
    } else {
        None
    }
}
pub fn list(v: Option<&Value>) -> Option<&[Value]> {
    if let Some(Value::List(l)) = v {
        Some(l)
    } else {
        None
    }
}
pub fn long_array(v: Option<&Value>) -> Option<&[i64]> {
    if let Some(Value::LongArray(a)) = v {
        Some(a)
    } else {
        None
    }
}
pub fn data(v: &Value) -> &Value {
    get(v, "Level").unwrap_or(v)
}
pub fn packed(words: &[i64], index: usize, bits: usize, padded: bool) -> Option<usize> {
    let (word, shift) = if padded {
        let per = 64 / bits;
        (index / per, (index % per) * bits)
    } else {
        (index * bits / 64, index * bits % 64)
    };
    let mut n = (*words.get(word)? as u64) >> shift;
    if !padded && shift + bits > 64 {
        n |= (*words.get(word + 1)? as u64) << (64 - shift);
    }
    Some((n & ((1u64 << bits) - 1)) as usize)
}
pub struct Surface {
    pub pixels: Vec<u8>,
    pub heights: [i16; 256],
    pub palette: Vec<String>,
}
const EMPTY: i16 = i16::MIN;
fn legacy_block(id: u16) -> String {
    let name = match id {
        1 => "stone",
        2 => "grass_block",
        3 => "dirt",
        4 => "cobblestone",
        5 => "oak_planks",
        7 => "bedrock",
        8 | 9 => "water",
        10 | 11 => "lava",
        12 => "sand",
        13 => "gravel",
        17 | 162 => "oak_log",
        18 | 161 => "oak_leaves",
        20 => "glass",
        24 => "sandstone",
        35 => "wool",
        45 => "bricks",
        49 => "obsidian",
        78 | 80 => "snow_block",
        79 | 174 => "ice",
        82 => "clay",
        87 => "netherrack",
        88 => "soul_sand",
        89 => "glowstone",
        110 => "mycelium",
        121 => "end_stone",
        _ => return format!("legacy:{id}"),
    };
    format!("minecraft:{name}")
}
pub fn surface(root: &Value) -> Result<Surface> {
    let chunk = data(root);
    let sections = list(get(chunk, "sections").or_else(|| get(chunk, "Sections")))
        .ok_or("区块没有支持的方块分节")?;
    let version = num(get(root, "DataVersion")).unwrap_or(3000);
    let mut sorted: Vec<_> = sections.iter().collect();
    sorted.sort_by_key(|s| -num(get(s, "Y")).unwrap_or(0));
    let mut pixels = vec![0u8; 16 * 16 * 4];
    let mut heights = [EMPTY; 256];
    let mut palette_names = Vec::new();
    for section in sorted {
        let base_y = num(get(section, "Y")).unwrap_or(0).clamp(-128, 127) as i16 * 16;
        // Pre-flattening Anvil stores numeric IDs with optional high nibbles in Add.
        if let Some(Value::ByteArray(bytes)) = get(section, "Blocks") {
            let extra = match get(section, "Add") {
                None => None,
                Some(Value::ByteArray(a)) if a.len() == 2048 => Some(a),
                _ => return Err("旧版方块数据截断".into()),
            };
            if bytes.len() != 4096 {
                return Err("旧版方块数据截断".into());
            }
            for col in 0..256 {
                if heights[col] != EMPTY {
                    continue;
                }
                for y in (0..16).rev() {
                    let at = y * 256 + col;
                    let high =
                        extra.map_or(0, |a| ((a[at / 2] as u8 >> ((at % 2) * 4)) & 15) as u16);
                    let id = (high << 8) | bytes[at] as u8 as u16;
                    if id == 0 {
                        continue;
                    }
                    let name = legacy_block(id);
                    let c = color(&name);
                    pixels[col * 4..col * 4 + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
                    heights[col] = base_y + y as i16;
                    if palette_names.len() < 256 && !palette_names.contains(&name) {
                        palette_names.push(name);
                    }
                    break;
                }
            }
            if palette_names.is_empty() {
                palette_names.push("minecraft:air".into());
            }
            if heights.iter().all(|y| *y != EMPTY) {
                break;
            }
            continue;
        }
        let states = get(section, "block_states").unwrap_or(section);
        let Some(palette) = list(get(states, "palette").or_else(|| get(states, "Palette"))) else {
            continue;
        };
        let names: Vec<_> = palette
            .iter()
            .map(|v| string(get(v, "Name")).unwrap_or("minecraft:air"))
            .collect();
        if names.is_empty() {
            return Err("区块调色板为空".into());
        }
        for name in &names {
            if palette_names.len() < 256 && !palette_names.iter().any(|n| n == name) {
                palette_names.push(name.to_string());
            }
        }
        let bits = (usize::BITS - (names.len().saturating_sub(1)).leading_zeros()).max(4) as usize;
        let words = long_array(get(states, "data").or_else(|| get(states, "BlockStates")));
        if names.len() > 1 && words.is_none() {
            return Err("区块缺少方块数据".into());
        }
        for y in (0..16).rev() {
            for z in 0..16 {
                for x in 0..16 {
                    let col = z * 16 + x;
                    if heights[col] != EMPTY {
                        continue;
                    }
                    let index = if names.len() == 1 {
                        0
                    } else {
                        packed(words.unwrap(), y * 256 + z * 16 + x, bits, version >= 2529)
                            .ok_or("方块数据截断")?
                    };
                    let name = *names.get(index).ok_or("方块调色板索引越界")?;
                    if ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].contains(&name)
                    {
                        continue;
                    }
                    let c = color(name);
                    pixels[col * 4..col * 4 + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
                    heights[col] = base_y + y as i16;
                }
            }
        }
        if heights.iter().all(|v| *v != EMPTY) {
            break;
        }
    }
    if palette_names.is_empty() && !sections.is_empty() {
        return Err("无法识别区块分节的方块数据".into());
    }
    Ok(Surface {
        pixels,
        heights,
        palette: palette_names,
    })
}
fn color(s: &str) -> [u8; 3] {
    if s.contains("water") {
        [54, 91, 175]
    } else if s.contains("ice") {
        [153, 193, 226]
    } else if s.contains("lava") {
        [244, 99, 24]
    } else if s.contains("snow") || s.contains("quartz") {
        [225, 233, 233]
    } else if s.contains("grass") || s.contains("moss") {
        [100, 143, 68]
    } else if s.contains("leaves") {
        [62, 112, 58]
    } else if s.contains("sand") && !s.contains("soul") {
        [207, 195, 139]
    } else if s.contains("end_stone") {
        [216, 222, 159]
    } else if s.contains("netherrack") {
        [111, 54, 54]
    } else if s.contains("log") || s.contains("wood") || s.contains("planks") {
        [133, 104, 65]
    } else if s.contains("dirt") || s.contains("mud") || s.contains("soul") {
        [123, 88, 61]
    } else if s.contains("deepslate") || s.contains("bedrock") {
        [74, 75, 79]
    } else if s.contains("stone") || s.contains("ore") {
        [125, 125, 127]
    } else {
        let h = s
            .bytes()
            .fold(0u32, |h, c| h.wrapping_mul(31).wrapping_add(c as u32));
        [
            90 + (h % 100) as u8,
            80 + ((h >> 8) % 100) as u8,
            70 + ((h >> 16) % 100) as u8,
        ]
    }
}
