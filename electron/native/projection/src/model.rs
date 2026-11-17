use crate::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet, VecDeque};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Block {
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, String>,
}
impl Block {
    pub fn air() -> Self {
        Self {
            name: "minecraft:air".into(),
            properties: BTreeMap::new(),
        }
    }
    pub fn is_air(&self) -> bool {
        matches!(
            self.name.as_str(),
            "minecraft:air" | "minecraft:cave_air" | "minecraft:void_air"
        )
    }
    pub fn validate(&self) -> Result<()> {
        if self.name.len() > 256
            || !self.name.contains(':')
            || !self
                .name
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_:/.-".contains(&c))
            || self.properties.len() > 64
            || self.properties.iter().any(|(k, v)| {
                k.len() > 128
                    || v.len() > 256
                    || !k
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
                    || !v
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
            })
        {
            return Err("方块状态无效".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub name: String,
    pub format: String,
    pub data_version: i32,
    pub dimensions: [usize; 3],
    pub origin: [i32; 3],
    pub palette: Vec<Block>,
    pub blocks: Vec<u32>,
    pub original: String,
    pub dirty: bool,
    #[serde(default)]
    pub transformed: bool,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub attached: Vec<Attached>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Attached {
    pub kind: String,
    pub pos: [usize; 3],
    pub nbt: String,
}
pub fn volume(d: [usize; 3]) -> Result<usize> {
    if d.iter().any(|n| *n == 0 || *n > 2048) {
        return Err("投影尺寸需为1至2048".into());
    }
    let n = d[0]
        .checked_mul(d[1])
        .and_then(|n| n.checked_mul(d[2]))
        .ok_or("投影尺寸溢出")?;
    if n > 2_000_000 {
        return Err("投影体积超过200万格".into());
    }
    Ok(n)
}
pub fn index(p: [usize; 3], d: [usize; 3]) -> usize {
    p[0] + p[2] * d[0] + p[1] * d[0] * d[2]
}
pub fn pos(i: usize, d: [usize; 3]) -> [usize; 3] {
    [i % d[0], i / (d[0] * d[2]), (i / d[0]) % d[2]]
}
impl Project {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1
            || !matches!(self.format.as_str(), "litematic" | "schem" | "nbt")
            || self.name.is_empty()
            || self.name.chars().count() > 256
            || self.original.len() > 90_000_000
        {
            return Err("投影工程版本或名称无效".into());
        }
        if self.blocks.len() != volume(self.dimensions)?
            || self.palette.is_empty()
            || self.palette.len() > 65536
            || self
                .blocks
                .iter()
                .any(|i| *i as usize >= self.palette.len())
        {
            return Err("投影方块数据无效".into());
        }
        for b in &self.palette {
            b.validate()?
        }
        if self.attached.len() > 250_000
            || self.attached.iter().any(|e| {
                (0..3).any(|k| e.pos[k] >= self.dimensions[k]) || e.nbt.len() > LIMIT_ATTACHED
            })
        {
            return Err("附加方块数据无效".into());
        }
        if self
            .blocks
            .iter()
            .filter(|i| !self.palette[**i as usize].is_air())
            .count()
            > 250_000
        {
            return Err("投影超过25万非空气方块".into());
        }
        Ok(())
    }
    pub fn view(&self) -> Value {
        let mut counts = BTreeMap::<u32, usize>::new();
        for &i in &self.blocks {
            if !self.palette[i as usize].is_air() {
                *counts.entry(i).or_default() += 1
            }
        }
        let raw: Vec<u8> = self.blocks.iter().flat_map(|n| n.to_le_bytes()).collect();
        json!({"name":self.name,"format":self.format,"dataVersion":self.data_version,"dimensions":self.dimensions,"origin":self.origin,"palette":self.palette,"blocks":STANDARD.encode(raw),"nonAir":counts.values().sum::<usize>(),"materials":counts.into_iter().map(|(palette,count)|json!({"palette":palette,"count":count})).collect::<Vec<_>>(),"warnings":self.warnings})
    }
    pub fn select(&self, v: &Value) -> Result<Vec<usize>> {
        let i = v["index"].as_u64().map(|n| n as usize);
        let seed = || {
            i.filter(|n| *n < self.blocks.len())
                .ok_or("请选择方块".to_string())
        };
        let solid = |i: usize| !self.palette[self.blocks[i] as usize].is_air();
        let mut out = vec![];
        match v["mode"].as_str().ok_or("缺少选择方式")? {
            "material" => {
                let id = self.blocks[seed()?];
                out.extend((0..self.blocks.len()).filter(|i| self.blocks[*i] == id && solid(*i)));
            }
            "layer" => {
                let y = pos(seed()?, self.dimensions)[1];
                out.extend(
                    (0..self.blocks.len())
                        .filter(|i| pos(*i, self.dimensions)[1] == y && solid(*i)),
                );
            }
            "box" => {
                let a: [usize; 3] =
                    serde_json::from_value(v["min"].clone()).map_err(|_| "框选坐标无效")?;
                let b: [usize; 3] =
                    serde_json::from_value(v["max"].clone()).map_err(|_| "框选坐标无效")?;
                if (0..3).any(|k| a[k] > b[k] || b[k] >= self.dimensions[k]) {
                    return Err("框选超出投影".into());
                }
                for y in a[1]..=b[1] {
                    for z in a[2]..=b[2] {
                        for x in a[0]..=b[0] {
                            let i = index([x, y, z], self.dimensions);
                            if solid(i) {
                                out.push(i)
                            }
                        }
                    }
                }
            }
            "connected" => {
                let start = seed()?;
                if !solid(start) {
                    return Ok(out);
                }
                let mut seen = HashSet::new();
                let mut q = VecDeque::from([start]);
                seen.insert(start);
                while let Some(i) = q.pop_front() {
                    out.push(i);
                    let p = pos(i, self.dimensions);
                    for k in 0..3 {
                        for delta in [-1isize, 1] {
                            let n = p[k] as isize + delta;
                            if n < 0 || n >= self.dimensions[k] as isize {
                                continue;
                            }
                            let mut next = p;
                            next[k] = n as usize;
                            let j = index(next, self.dimensions);
                            if solid(j) && seen.insert(j) {
                                q.push_back(j)
                            }
                        }
                    }
                }
            }
            _ => return Err("选择方式无效".into()),
        }
        Ok(out)
    }
    pub fn edit(&mut self, op: &Value) -> Result<()> {
        match op["kind"].as_str().ok_or("缺少编辑方式")? {
            "rename" => self.name = op["name"].as_str().ok_or("缺少名称")?.trim().to_owned(),
            "replace" | "delete" => {
                let b = if op["kind"] == "delete" {
                    Block::air()
                } else {
                    serde_json::from_value(op["block"].clone()).map_err(|_| "替换方块无效")?
                };
                b.validate()?;
                let ids: Vec<usize> =
                    serde_json::from_value(op["indices"].clone()).map_err(|_| "选区无效")?;
                if ids.len() > 500_000 || ids.iter().any(|i| *i >= self.blocks.len()) {
                    return Err("选区超限".into());
                }
                let id = if let Some(i) = self.palette.iter().position(|x| x == &b) {
                    i
                } else {
                    self.palette.push(b);
                    self.palette.len() - 1
                };
                let changed: HashSet<_> = ids
                    .iter()
                    .copied()
                    .filter(|i| {
                        self.palette[self.blocks[*i] as usize].name != self.palette[id].name
                    })
                    .collect();
                self.attached
                    .retain(|e| !changed.contains(&index(e.pos, self.dimensions)));
                for i in ids {
                    self.blocks[i] = id as u32
                }
            }
            "rotate" | "mirror" => {
                crate::formats::allow_transform(self)?;
                let kind = op["kind"].as_str().unwrap();
                let mode = if kind == "rotate" {
                    match op["direction"].as_str() {
                        Some("cw") => 0,
                        Some("ccw") => 1,
                        _ => return Err("旋转方向无效".into()),
                    }
                } else {
                    match op["axis"].as_str() {
                        Some("x") => 2,
                        Some("z") => 3,
                        _ => return Err("镜像轴无效".into()),
                    }
                };
                let d = self.dimensions;
                let nd = if mode < 2 { [d[2], d[1], d[0]] } else { d };
                let mut blocks = vec![0; self.blocks.len()];
                for (i, &b) in self.blocks.iter().enumerate() {
                    let [x, y, z] = pos(i, d);
                    let p = match mode {
                        0 => [d[2] - 1 - z, y, x],
                        1 => [z, y, d[0] - 1 - x],
                        2 => [d[0] - 1 - x, y, z],
                        _ => [x, y, d[2] - 1 - z],
                    };
                    blocks[index(p, nd)] = b
                }
                for b in &mut self.palette {
                    transform_block(b, mode)
                }
                for e in &mut self.attached {
                    let [x, y, z] = e.pos;
                    e.pos = match mode {
                        0 => [d[2] - 1 - z, y, x],
                        1 => [z, y, d[0] - 1 - x],
                        2 => [d[0] - 1 - x, y, z],
                        _ => [x, y, d[2] - 1 - z],
                    };
                }
                self.blocks = blocks;
                self.dimensions = nd;
                self.transformed = true;
            }
            _ => return Err("编辑方式无效".into()),
        }
        self.dirty = true;
        self.validate()
    }
}
pub fn transform_block(b: &mut Block, mode: u8) {
    let dirs = ["north", "east", "south", "west"];
    let transform = |v: &str| -> String {
        if let Some(i) = dirs.iter().position(|x| *x == v) {
            dirs[match mode {
                0 => (i + 1) % 4,
                1 => (i + 3) % 4,
                2 => [0, 3, 2, 1][i],
                _ => [2, 1, 0, 3][i],
            }]
            .into()
        } else {
            v.into()
        }
    };
    let old = std::mem::take(&mut b.properties);
    for (k, v) in old.iter() {
        let key = transform(k);
        let mut value = v.clone();
        if k == "facing" || k == "orientation" {
            value = v.split('_').map(transform).collect::<Vec<_>>().join("_")
        }
        if k == "axis" && mode < 2 {
            value = match v.as_str() {
                "x" => "z",
                "z" => "x",
                _ => v,
            }
            .into()
        }
        if k == "rotation" {
            if let Ok(r) = v.parse::<i32>() {
                value = match mode {
                    0 => (r + 4) % 16,
                    1 => (r + 12) % 16,
                    2 => (16 - r) % 16,
                    _ => (8 - r).rem_euclid(16),
                }
                .to_string()
            }
        }
        if mode >= 2 && (k == "hinge" || k == "type") {
            value = match v.as_str() {
                "left" => "right",
                "right" => "left",
                _ => &value,
            }
            .into()
        }
        if k == "shape" {
            if v == "north_south" || v == "east_west" {
                if mode < 2 {
                    value = if v == "north_south" {
                        "east_west"
                    } else {
                        "north_south"
                    }
                    .into()
                }
            } else if let Some(dir) = v.strip_prefix("ascending_") {
                value = format!("ascending_{}", transform(dir))
            } else if ["north_east", "north_west", "south_east", "south_west"].contains(&v.as_str())
            {
                let parts: Vec<_> = v.split('_').map(transform).collect();
                let ns = parts
                    .iter()
                    .find(|v| matches!(v.as_str(), "north" | "south"))
                    .unwrap();
                let ew = parts
                    .iter()
                    .find(|v| matches!(v.as_str(), "east" | "west"))
                    .unwrap();
                value = format!("{ns}_{ew}")
            } else if mode >= 2 {
                value = v
                    .replace("left", "TEMP")
                    .replace("right", "left")
                    .replace("TEMP", "right")
            }
        }
        b.properties.insert(key, value);
    }
}
const LIMIT_ATTACHED: usize = 64 * 1024 * 1024;
