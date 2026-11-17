use crate::{
    LIMIT, Result,
    model::{Block, Project, index, pos, volume},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use fastnbt::{ByteArray, IntArray, LongArray, Value as N};
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use std::{
    collections::{BTreeMap, HashMap},
    io::{Read, Write},
};
fn compound(v: &N) -> Result<&HashMap<String, N>> {
    if let N::Compound(m) = v {
        Ok(m)
    } else {
        Err("NBT复合标签无效".into())
    }
}
fn map(v: &mut N) -> Result<&mut HashMap<String, N>> {
    if let N::Compound(m) = v {
        Ok(m)
    } else {
        Err("NBT复合标签无效".into())
    }
}
fn get<'a>(v: &'a N, k: &str) -> Result<&'a N> {
    compound(v)?.get(k).ok_or(format!("缺少NBT标签{k}"))
}
fn number(v: &N) -> Result<i32> {
    match v {
        N::Int(x) => Ok(*x),
        N::Short(x) => Ok(*x as i32),
        N::Byte(x) => Ok(*x as i32),
        _ => Err("NBT整数无效".into()),
    }
}
fn num(v: &N, k: &str) -> Result<i32> {
    number(get(v, k)?)
}
fn string(v: &N) -> Result<&str> {
    if let N::String(s) = v {
        Ok(s)
    } else {
        Err("NBT字符串无效".into())
    }
}
fn list(v: &N) -> Result<&Vec<N>> {
    if let N::List(l) = v {
        Ok(l)
    } else {
        Err("NBT列表无效".into())
    }
}
fn bytearray(v: &N) -> Result<Vec<u8>> {
    if let N::ByteArray(a) = v {
        Ok(a.iter().map(|n| *n as u8).collect())
    } else {
        Err("NBT字节数组无效".into())
    }
}
fn xyz(v: &N) -> Result<[i32; 3]> {
    Ok([num(v, "x")?, num(v, "y")?, num(v, "z")?])
}
fn xyz_tag(p: [i32; 3]) -> N {
    N::Compound(
        [
            ("x".into(), N::Int(p[0])),
            ("y".into(), N::Int(p[1])),
            ("z".into(), N::Int(p[2])),
        ]
        .into(),
    )
}
fn intlist(v: &N) -> Result<[i32; 3]> {
    match v {
        N::List(l) if l.len() == 3 => Ok([number(&l[0])?, number(&l[1])?, number(&l[2])?]),
        N::IntArray(a) if a.len() == 3 => Ok([a[0], a[1], a[2]]),
        _ => Err("NBT坐标无效".into()),
    }
}
fn vec_tag(p: [usize; 3]) -> N {
    N::List(p.into_iter().map(|n| N::Int(n as i32)).collect())
}
fn dim(p: [i32; 3]) -> Result<[usize; 3]> {
    let d = p.map(|n| n.unsigned_abs() as usize);
    volume(d)?;
    Ok(d)
}
fn decode(bytes: &[u8]) -> Result<N> {
    let mut raw = vec![];
    if bytes.starts_with(&[31, 139]) {
        GzDecoder::new(bytes)
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut raw)
            .map_err(|e| e.to_string())?;
    } else {
        raw.extend_from_slice(bytes)
    }
    if raw.len() > LIMIT {
        return Err("NBT解压超过64MiB".into());
    }
    validate_nbt(&raw)?;
    fastnbt::from_bytes_with_opts(&raw, fastnbt::DeOpts::new().max_seq_len(LIMIT))
        .map_err(|e| format!("NBT格式无效：{e}"))
}
fn encode(v: &N) -> Result<Vec<u8>> {
    let raw = fastnbt::to_bytes(v).map_err(|e| e.to_string())?;
    if raw.len() > LIMIT {
        return Err("NBT输出过大".into());
    }
    validate_nbt(&raw)?;
    let mut gz = GzEncoder::new(vec![], Compression::fast());
    gz.write_all(&raw).map_err(|e| e.to_string())?;
    gz.finish().map_err(|e| e.to_string())
}
fn source(p: &Project) -> Result<N> {
    decode(&STANDARD.decode(&p.original).map_err(|_| "源数据无效")?)
}
fn root(v: &N) -> &N {
    compound(v)
        .ok()
        .and_then(|m| m.get("Schematic"))
        .unwrap_or(v)
}
fn root_mut(v: &mut N) -> Result<&mut N> {
    if compound(v)?.contains_key("Schematic") {
        Ok(map(v)?.get_mut("Schematic").unwrap())
    } else {
        Ok(v)
    }
}
fn block(v: &N) -> Result<Block> {
    let name = string(get(v, "Name")?)?.to_string();
    let mut properties = BTreeMap::new();
    if let Some(props) = compound(v)?.get("Properties") {
        for (k, v) in compound(props)? {
            properties.insert(k.clone(), string(v)?.into());
        }
    }
    let b = Block { name, properties };
    b.validate()?;
    Ok(b)
}
fn block_tag(b: &Block) -> N {
    let mut m = HashMap::from([("Name".into(), N::String(b.name.clone()))]);
    if !b.properties.is_empty() {
        m.insert(
            "Properties".into(),
            N::Compound(
                b.properties
                    .iter()
                    .map(|(k, v)| (k.clone(), N::String(v.clone())))
                    .collect(),
            ),
        );
    }
    N::Compound(m)
}
fn state(b: &Block) -> String {
    if b.properties.is_empty() {
        b.name.clone()
    } else {
        format!(
            "{}[{}]",
            b.name,
            b.properties
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}
fn parse_state(s: &str) -> Result<Block> {
    let (name, props) = if let Some((n, p)) = s.split_once('[') {
        (n, Some(p.strip_suffix(']').ok_or("方块属性无效")?))
    } else {
        (s, None)
    };
    let mut b = Block {
        name: name.into(),
        properties: BTreeMap::new(),
    };
    if let Some(p) = props {
        for pair in p.split(',') {
            let (k, v) = pair.split_once('=').ok_or("方块属性无效")?;
            if b.properties.insert(k.into(), v.into()).is_some() {
                return Err("重复方块属性".into());
            }
        }
    }
    b.validate()?;
    Ok(b)
}
fn palette(v: &N) -> Result<Vec<Block>> {
    let l = list(v)?;
    if l.is_empty() || l.len() > 65536 {
        return Err("方块调色板超限".into());
    }
    l.iter().map(block).collect()
}
fn intern(p: &mut Vec<Block>, b: Block) -> u32 {
    if let Some(i) = p.iter().position(|x| *x == b) {
        i as u32
    } else {
        p.push(b);
        (p.len() - 1) as u32
    }
}
pub fn bits(n: usize) -> usize {
    ((usize::BITS - (n.saturating_sub(1)).leading_zeros()) as usize).max(2)
}
pub fn unpack(data: &[i64], len: usize, count: usize) -> Result<Vec<u32>> {
    let b = bits(count);
    let needed = (len * b).div_ceil(64);
    if data.len() != needed {
        return Err("投影位数组长度不匹配".into());
    }
    let mask = (1u64 << b) - 1;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let at = i * b;
        let mut n = (data[at / 64] as u64) >> (at % 64);
        if at % 64 + b > 64 {
            n |= (data[at / 64 + 1] as u64) << (64 - at % 64)
        }
        let n = (n & mask) as u32;
        if n as usize >= count {
            return Err("投影调色板索引越界".into());
        }
        out.push(n)
    }
    Ok(out)
}
pub fn pack(data: &[u32], count: usize) -> Vec<i64> {
    let b = bits(count);
    let mut out = vec![0u64; (data.len() * b).div_ceil(64)];
    for (i, &n) in data.iter().enumerate() {
        let at = i * b;
        out[at / 64] |= (n as u64) << (at % 64);
        if at % 64 + b > 64 {
            out[at / 64 + 1] |= (n as u64) >> (64 - at % 64)
        }
    }
    out.into_iter().map(|n| n as i64).collect()
}
pub fn varints(data: &[u8], len: usize, count: usize) -> Result<Vec<u32>> {
    let mut out = vec![];
    let (mut n, mut shift) = (0u32, 0);
    for &byte in data {
        if shift == 28 && byte > 15 {
            return Err("VarInt溢出".into());
        }
        n |= ((byte & 127) as u32) << shift;
        if byte & 128 == 0 {
            if n as usize >= count || out.len() >= len {
                return Err("方块数据索引或长度无效".into());
            }
            out.push(n);
            n = 0;
            shift = 0;
        } else {
            shift += 7;
            if shift > 28 {
                return Err("VarInt过长".into());
            }
        }
    }
    if shift != 0 || out.len() != len {
        return Err("方块数据截断".into());
    }
    Ok(out)
}
fn to_varints(data: &[u32]) -> N {
    let mut raw = vec![];
    for &id in data {
        let mut n = id;
        loop {
            let b = (n & 127) as u8;
            n >>= 7;
            raw.push((b | if n != 0 { 128 } else { 0 }) as i8);
            if n == 0 {
                break;
            }
        }
    }
    N::ByteArray(ByteArray::new(raw))
}
fn basic(name: &str, format: &str, d: [usize; 3], origin: [i32; 3], dv: i32) -> Project {
    Project {
        schema_version: 1,
        name: name.chars().take(80).collect(),
        format: format.into(),
        data_version: dv,
        dimensions: d,
        origin,
        palette: vec![Block::air()],
        blocks: vec![0; volume(d).unwrap()],
        original: String::new(),
        dirty: false,
        transformed: false,
        warnings: vec![],
        attached: vec![],
    }
}
pub fn import(bytes: &[u8], name: &str) -> Result<Project> {
    let source = decode(bytes)?;
    let r = root(&source);
    let keys = compound(r)?;
    if keys.contains_key("Regions") {
        let version = num(r, "Version")?;
        if ![6, 7].contains(&version) {
            return Err("仅支持Litematic v6/v7".into());
        }
        let regions = compound(get(r, "Regions")?)?;
        if regions.is_empty() || regions.len() > 256 {
            return Err("投影分区数量无效".into());
        }
        let mut lo = [i32::MAX; 3];
        let mut hi = [i32::MIN; 3];
        let mut total = 0usize;
        for region in regions.values() {
            let p = xyz(get(region, "Position")?)?;
            let s = xyz(get(region, "Size")?)?;
            let d = dim(s)?;
            total = total.checked_add(volume(d)?).ok_or("分区过大")?;
            if total > 4_000_000 {
                return Err("分区总量超限".into());
            }
            for k in 0..3 {
                let end = p[k]
                    .checked_add(if s[k] < 0 { s[k] + 1 } else { s[k] - 1 })
                    .ok_or("分区坐标溢出")?;
                lo[k] = lo[k].min(p[k].min(end));
                hi[k] = hi[k].max(p[k].max(end));
            }
        }
        let mut d = [0; 3];
        for k in 0..3 {
            d[k] = (hi[k] as i64 - lo[k] as i64 + 1)
                .try_into()
                .map_err(|_| "分区坐标无效")?;
        }
        volume(d)?;
        let mut p = basic(
            name,
            "litematic",
            d,
            lo,
            num(r, "MinecraftDataVersion").unwrap_or(0),
        );
        let mut names = regions.keys().collect::<Vec<_>>();
        let mut palette_ids = HashMap::from([(Block::air(), 0u32)]);
        names.sort();
        let mut used = HashSetIndex::new();
        for name in names {
            let region = &regions[name];
            let rp = xyz(get(region, "Position")?)?;
            let sz = xyz(get(region, "Size")?)?;
            let rd = dim(sz)?;
            let min =
                std::array::from_fn::<_, 3, _>(|k| rp[k] + if sz[k] < 0 { sz[k] + 1 } else { 0 });
            let local = palette(get(region, "BlockStatePalette")?)?;
            let mapped: Vec<_> = local
                .into_iter()
                .map(|b| {
                    if let Some(&id) = palette_ids.get(&b) {
                        id
                    } else {
                        let id = p.palette.len() as u32;
                        palette_ids.insert(b.clone(), id);
                        p.palette.push(b);
                        id
                    }
                })
                .collect();
            let raw = if let N::LongArray(a) = get(region, "BlockStates")? {
                unpack(a, volume(rd)?, mapped.len())?
            } else {
                return Err("BlockStates无效".into());
            };
            for (i, b) in raw.into_iter().enumerate() {
                let q = pos(i, rd);
                let dest =
                    std::array::from_fn(|k| (min[k] as i64 - lo[k] as i64 + q[k] as i64) as usize);
                let at = index(dest, d);
                if !used.insert(at) && p.blocks[at] != mapped[b as usize] {
                    return Err("分区重叠且方块冲突，请先在游戏中合并".into());
                }
                p.blocks[at] = mapped[b as usize];
            }
        }
        if regions.len() > 1 {
            p.warnings.push("多分区投影".into())
        }
        capture_attached(&mut p, r)?;
        p.validate()?;
        return Ok(p);
    }
    if keys.contains_key("Palette") || keys.contains_key("Blocks") && keys.contains_key("Width") {
        let version = num(r, "Version")?;
        if ![2, 3].contains(&version) {
            return Err("仅支持Sponge v2/v3".into());
        }
        let sizes = [num(r, "Width")?, num(r, "Height")?, num(r, "Length")?];
        if sizes.iter().any(|n| *n <= 0) {
            return Err("投影尺寸必须为正数".into());
        }
        let d = dim(sizes)?;
        let origin = keys
            .get("Offset")
            .map(intlist)
            .transpose()?
            .unwrap_or([0; 3]);
        let mut p = basic(name, "schem", d, origin, num(r, "DataVersion").unwrap_or(0));
        let br = if version == 3 { get(r, "Blocks")? } else { r };
        let pal = compound(get(br, "Palette")?)?;
        if pal.is_empty() || pal.len() > 65536 {
            return Err("调色板无效".into());
        }
        let mut slots = vec![None; pal.len()];
        for (s, n) in pal {
            let id = number(n)?;
            if id < 0 || id as usize >= slots.len() || slots[id as usize].is_some() {
                return Err("调色板索引无效".into());
            }
            slots[id as usize] = Some(parse_state(s)?);
        }
        p.palette = slots
            .into_iter()
            .map(|b| b.ok_or("调色板缺项".into()))
            .collect::<Result<_>>()?;
        p.blocks = varints(
            &bytearray(get(br, if version == 3 { "Data" } else { "BlockData" })?)?,
            volume(d)?,
            p.palette.len(),
        )?;
        capture_attached(&mut p, r)?;
        p.validate()?;
        return Ok(p);
    }
    if keys.contains_key("size") && keys.contains_key("blocks") {
        let sizes = intlist(get(r, "size")?)?;
        if sizes.iter().any(|n| *n <= 0) {
            return Err("结构尺寸必须为正数".into());
        }
        let d = dim(sizes)?;
        let mut p = basic(name, "nbt", d, [0; 3], num(r, "DataVersion").unwrap_or(0));
        p.palette = palette(get(r, "palette")?)?;
        let air = intern(&mut p.palette, Block::air());
        p.blocks.fill(air);
        let entries = list(get(r, "blocks")?)?;
        if entries.len() > volume(d)? {
            return Err("结构方块数量无效".into());
        }
        let mut used = HashSetIndex::new();
        for b in entries {
            let point = intlist(get(b, "pos")?)?;
            if (0..3).any(|k| point[k] < 0 || point[k] as usize >= d[k]) {
                return Err("结构坐标越界".into());
            }
            let i = index(point.map(|n| n as usize), d);
            let state = num(b, "state")?;
            if state < 0 || state as usize >= p.palette.len() || !used.insert(i) {
                return Err("结构索引无效".into());
            }
            p.blocks[i] = state as u32;
        }
        capture_attached(&mut p, r)?;
        p.validate()?;
        return Ok(p);
    }
    Err("暂不支持此投影格式；请选择litematic、Sponge schem或结构NBT".into())
}
type HashSetIndex = std::collections::HashSet<usize>;
fn nonempty(v: Option<&N>) -> bool {
    match v {
        Some(N::List(l)) => !l.is_empty(),
        Some(N::Compound(m)) => !m.is_empty(),
        Some(_) => true,
        None => false,
    }
}
fn extras(r: &N, format: &str) -> Result<bool> {
    let m = compound(r)?;
    Ok(match format {
        "litematic" => compound(get(r, "Regions")?)?.values().any(|v| {
            compound(v).is_ok_and(|r| {
                [
                    "TileEntities",
                    "Entities",
                    "PendingBlockTicks",
                    "PendingFluidTicks",
                ]
                .iter()
                .any(|k| nonempty(r.get(*k)))
            })
        }),
        "schem" => {
            let br = if num(r, "Version")? == 3 {
                get(r, "Blocks")?
            } else {
                r
            };
            nonempty(compound(br)?.get("BlockEntities"))
                || nonempty(m.get("Entities"))
                || m.contains_key("Biomes")
                || m.contains_key("BiomeData")
        }
        "nbt" => {
            nonempty(m.get("entities"))
                || list(get(r, "blocks")?)?
                    .iter()
                    .any(|b| compound(b).is_ok_and(|m| m.contains_key("nbt")))
        }
        _ => false,
    })
}
pub fn allow_transform(p: &Project) -> Result<()> {
    let s = source(p)?;
    let r = root(&s);
    let m = compound(r)?;
    let complex = match p.format.as_str() {
        "litematic" => compound(get(r, "Regions")?)?
            .values()
            .any(|v| compound(v).is_ok_and(|m| nonempty(m.get("Entities")))),
        "schem" => {
            nonempty(m.get("Entities")) || m.contains_key("Biomes") || m.contains_key("BiomeData")
        }
        "nbt" => nonempty(m.get("entities")),
        _ => true,
    };
    if complex {
        return Err("含游离实体或群系数据的投影暂不支持旋转镜像；原件保留".into());
    }
    for e in &p.attached {
        let raw = attached_nbt(e)?;
        let m = compound(&raw)?;
        let data = m.get("Data").unwrap_or(&raw);
        let data = compound(data)?;
        if [
            "ExitPortal",
            "final_state",
            "facing",
            "Facing",
            "Rot",
            "posX",
            "posY",
            "posZ",
            "blockState",
            "orientation",
        ]
        .iter()
        .any(|k| data.contains_key(*k))
        {
            return Err("此投影含特殊朝向或坐标NBT，暂不能变换".into());
        }
    }
    Ok(())
}
fn old_at(p: &Project, q: [i32; 3]) -> Option<usize> {
    if (0..3).any(|k| q[k] < 0 || q[k] as usize >= p.dimensions[k]) {
        None
    } else {
        Some(index(q.map(|n| n as usize), p.dimensions))
    }
}
fn preserve_entry(p: &Project, old: &Project, q: [i32; 3]) -> bool {
    old_at(p, q).is_some_and(|i| {
        p.palette[p.blocks[i] as usize].name == old.palette[old.blocks[i] as usize].name
    })
}
pub fn export(p: &Project, format: &str) -> Result<Vec<u8>> {
    let attached: std::collections::HashSet<_> = p
        .attached
        .iter()
        .map(|e| (e.kind.as_str(), e.pos.map(|n| n as i32)))
        .collect();
    if !matches!(format, "litematic" | "schem" | "nbt") {
        return Err("导出格式无效".into());
    }
    let mut original = source(p)?;
    let r = root(&original);
    let has_extra = extras(r, &p.format)?;
    if format != p.format && has_extra {
        return Err("此投影包含实体或额外数据，请导出为原格式".into());
    }
    if p.transformed {
        allow_transform(p)?;
    }
    if format == p.format && !p.transformed {
        let mut old = import(
            &STANDARD.decode(&p.original).map_err(|_| "源数据无效")?,
            &p.name,
        )?;
        old.original = p.original.clone();
        let r = root_mut(&mut original)?;
        match format {
            "litematic" => {
                for region in map(get_mut(r, "Regions")?)?.values_mut() {
                    let rp = xyz(get(region, "Position")?)?;
                    let sz = xyz(get(region, "Size")?)?;
                    let rd = dim(sz)?;
                    let min = std::array::from_fn::<_, 3, _>(|k| {
                        rp[k] + if sz[k] < 0 { sz[k] + 1 } else { 0 }
                    });
                    let mut blocks = Vec::with_capacity(volume(rd)?);
                    for i in 0..volume(rd)? {
                        let q = pos(i, rd);
                        let at = index(
                            std::array::from_fn(|k| (min[k] - p.origin[k]) as usize + q[k]),
                            p.dimensions,
                        );
                        blocks.push(p.blocks[at]);
                    }
                    let m = map(region)?;
                    m.insert(
                        "BlockStatePalette".into(),
                        N::List(p.palette.iter().map(block_tag).collect()),
                    );
                    m.insert(
                        "BlockStates".into(),
                        N::LongArray(LongArray::new(pack(&blocks, p.palette.len()))),
                    );
                    for key in ["TileEntities", "PendingBlockTicks", "PendingFluidTicks"] {
                        if let Some(N::List(entries)) = m.get_mut(key) {
                            entries.retain(|e| {
                                xyz(e)
                                    .ok()
                                    .map(|q| std::array::from_fn(|k| min[k] - p.origin[k] + q[k]))
                                    .is_some_and(|q| attached.contains(&(key, q)))
                            });
                        }
                    }
                }
                update_meta(r, p)?;
            }
            "schem" => {
                let version = num(r, "Version")?;
                let br = if version == 3 {
                    get_mut(r, "Blocks")?
                } else {
                    r
                };
                let m = map(br)?;
                m.insert(
                    "Palette".into(),
                    N::Compound(
                        p.palette
                            .iter()
                            .enumerate()
                            .map(|(i, b)| (state(b), N::Int(i as i32)))
                            .collect(),
                    ),
                );
                m.insert(
                    if version == 3 { "Data" } else { "BlockData" }.into(),
                    to_varints(&p.blocks),
                );
                if version == 2 {
                    m.insert("PaletteMax".into(), N::Int(p.palette.len() as i32));
                }
                if let Some(N::List(entries)) = m.get_mut("BlockEntities") {
                    entries.retain(|e| {
                        get(e, "Pos")
                            .ok()
                            .and_then(|q| intlist(q).ok())
                            .is_some_and(|q| attached.contains(&("BlockEntities", q)))
                    });
                }
            }
            "nbt" => {
                let previous = list(get(r, "blocks")?)?;
                let mut saved = HashMap::new();
                for e in previous {
                    if let Ok(q) = intlist(get(e, "pos")?) {
                        if preserve_entry(p, &old, q) {
                            saved.insert(q, e.clone());
                        }
                    }
                }
                let blocks = p
                    .blocks
                    .iter()
                    .enumerate()
                    .map(|(i, &state)| {
                        let q = pos(i, p.dimensions);
                        let mut b = saved
                            .remove(&q.map(|n| n as i32))
                            .unwrap_or(N::Compound(HashMap::new()));
                        let m = map(&mut b).unwrap();
                        if !attached.contains(&("nbt", q.map(|n| n as i32))) {
                            m.remove("nbt");
                        }
                        m.insert("pos".into(), vec_tag(q));
                        m.insert("state".into(), N::Int(state as i32));
                        b
                    })
                    .collect();
                map(r)?.insert(
                    "palette".into(),
                    N::List(p.palette.iter().map(block_tag).collect()),
                );
                map(r)?.insert("blocks".into(), N::List(blocks));
            }
            _ => {}
        }
        return encode(&original);
    }
    // A transformed / cross-format projection is a single positive-size region.
    // The complete source NBT stays attached for reversible metadata provenance.
    let mut m = if format == p.format {
        compound(root(&original))?.clone()
    } else {
        HashMap::new()
    };
    m.insert(
        "KJMCLSource".into(),
        N::ByteArray(ByteArray::new(
            STANDARD
                .decode(&p.original)
                .map_err(|_| "源数据无效")?
                .into_iter()
                .map(|b| b as i8)
                .collect(),
        )),
    );
    match format {
        "litematic" => {
            m.insert("Version".into(), N::Int(6));
            m.insert("SubVersion".into(), N::Int(1));
            m.insert("MinecraftDataVersion".into(), N::Int(p.data_version));
            let region = N::Compound(HashMap::from([
                ("Position".into(), xyz_tag(p.origin)),
                ("Size".into(), xyz_tag(p.dimensions.map(|n| n as i32))),
                (
                    "BlockStatePalette".into(),
                    N::List(p.palette.iter().map(block_tag).collect()),
                ),
                (
                    "BlockStates".into(),
                    N::LongArray(LongArray::new(pack(&p.blocks, p.palette.len()))),
                ),
                (
                    "TileEntities".into(),
                    attached_list(p, "TileEntities", false)?,
                ),
                ("Entities".into(), N::List(vec![])),
                (
                    "PendingBlockTicks".into(),
                    attached_list(p, "PendingBlockTicks", false)?,
                ),
                (
                    "PendingFluidTicks".into(),
                    attached_list(p, "PendingFluidTicks", false)?,
                ),
            ]));
            m.insert(
                "Regions".into(),
                N::Compound(HashMap::from([("KJMCL".into(), region)])),
            );
            let mut r = N::Compound(m);
            update_meta(&mut r, p)?;
            encode(&r)
        }
        "schem" => {
            m.insert("Version".into(), N::Int(3));
            m.insert("DataVersion".into(), N::Int(p.data_version));
            for (k, n) in ["Width", "Height", "Length"].iter().zip(p.dimensions) {
                m.insert((*k).into(), N::Short(n as i16));
            }
            m.insert(
                "Offset".into(),
                N::IntArray(IntArray::new(p.origin.to_vec())),
            );
            m.insert(
                "Blocks".into(),
                N::Compound(HashMap::from([
                    (
                        "Palette".into(),
                        N::Compound(
                            p.palette
                                .iter()
                                .enumerate()
                                .map(|(i, b)| (state(b), N::Int(i as i32)))
                                .collect(),
                        ),
                    ),
                    ("Data".into(), to_varints(&p.blocks)),
                    (
                        "BlockEntities".into(),
                        attached_list(p, "BlockEntities", true)?,
                    ),
                ])),
            );
            for key in ["Palette", "PaletteMax", "BlockData", "BlockEntities"] {
                m.remove(key);
            }
            m.insert("Entities".into(), N::List(vec![]));
            encode(&N::Compound(HashMap::from([(
                "Schematic".into(),
                N::Compound(m),
            )])))
        }
        "nbt" => {
            m.insert("DataVersion".into(), N::Int(p.data_version));
            m.insert("size".into(), vec_tag(p.dimensions));
            m.insert(
                "palette".into(),
                N::List(p.palette.iter().map(block_tag).collect()),
            );
            let payloads = p
                .attached
                .iter()
                .filter(|e| e.kind == "nbt")
                .map(|e| Ok((index(e.pos, p.dimensions), attached_nbt(e)?)))
                .collect::<Result<HashMap<_, _>>>()?;
            m.insert(
                "blocks".into(),
                N::List(
                    p.blocks
                        .iter()
                        .enumerate()
                        .map(|(i, &s)| {
                            let mut b = HashMap::from([
                                ("pos".into(), vec_tag(pos(i, p.dimensions))),
                                ("state".into(), N::Int(s as i32)),
                            ]);
                            if let Some(n) = payloads.get(&i) {
                                b.insert("nbt".into(), n.clone());
                            }
                            N::Compound(b)
                        })
                        .collect(),
                ),
            );
            m.insert("entities".into(), N::List(vec![]));
            encode(&N::Compound(m))
        }
        _ => unreachable!(),
    }
}
fn get_mut<'a>(v: &'a mut N, k: &str) -> Result<&'a mut N> {
    map(v)?.get_mut(k).ok_or(format!("缺少标签{k}"))
}
fn update_meta(r: &mut N, p: &Project) -> Result<()> {
    let m = map(r)?;
    let md = m
        .entry("Metadata".into())
        .or_insert(N::Compound(HashMap::new()));
    let md = map(md)?;
    md.insert("Name".into(), N::String(p.name.clone()));
    md.insert("TotalVolume".into(), N::Long(p.blocks.len() as i64));
    md.insert(
        "TotalBlocks".into(),
        N::Long(
            p.blocks
                .iter()
                .filter(|&&b| !p.palette[b as usize].is_air())
                .count() as i64,
        ),
    );
    md.insert(
        "EnclosingSize".into(),
        xyz_tag(p.dimensions.map(|n| n as i32)),
    );
    Ok(())
}

fn capture_attached(p: &mut Project, r: &N) -> Result<()> {
    let mut add = |kind: &str, q: [i32; 3], v: &N| -> Result<()> {
        if (0..3).any(|k| q[k] < 0 || q[k] as usize >= p.dimensions[k]) {
            return Err("附加方块坐标越界".into());
        }
        p.attached.push(crate::model::Attached {
            kind: kind.into(),
            pos: q.map(|n| n as usize),
            nbt: STANDARD.encode(fastnbt::to_bytes(v).map_err(|e| e.to_string())?),
        });
        Ok(())
    };
    match p.format.as_str() {
        "litematic" => {
            for region in compound(get(r, "Regions")?)?.values() {
                let rp = xyz(get(region, "Position")?)?;
                let s = xyz(get(region, "Size")?)?;
                let offset = std::array::from_fn::<_, 3, _>(|k| {
                    rp[k] + if s[k] < 0 { s[k] + 1 } else { 0 } - p.origin[k]
                });
                for kind in ["TileEntities", "PendingBlockTicks", "PendingFluidTicks"] {
                    if let Some(v) = compound(region)?.get(kind) {
                        for e in list(v)? {
                            let q = xyz(e)?;
                            add(kind, std::array::from_fn(|k| q[k] + offset[k]), e)?;
                        }
                    }
                }
            }
        }
        "schem" => {
            let v3 = num(r, "Version")? == 3;
            let br = if v3 { get(r, "Blocks")? } else { r };
            if let Some(v) = compound(br)?.get("BlockEntities") {
                for e in list(v)? {
                    add("BlockEntities", intlist(get(e, "Pos")?)?, e)?;
                }
            }
        }
        "nbt" => {
            for e in list(get(r, "blocks")?)? {
                if let Some(nbt) = compound(e)?.get("nbt") {
                    add("nbt", intlist(get(e, "pos")?)?, nbt)?
                }
            }
        }
        _ => {}
    }
    Ok(())
}
fn attached_nbt(e: &crate::model::Attached) -> Result<N> {
    let bytes = STANDARD.decode(&e.nbt).map_err(|_| "附加NBT损坏")?;
    validate_nbt(&bytes)?;
    let mut value: N = fastnbt::from_bytes(&bytes).map_err(|e| e.to_string())?;
    let m = map(&mut value)?;
    for (k, n) in ["x", "y", "z"].iter().zip(e.pos) {
        if m.contains_key(*k) {
            m.insert((*k).into(), N::Int(n as i32));
        }
    }
    if let Some(N::Compound(data)) = m.get_mut("Data") {
        for (k, n) in ["x", "y", "z"].iter().zip(e.pos) {
            if data.contains_key(*k) {
                data.insert((*k).into(), N::Int(n as i32));
            }
        }
    }
    Ok(value)
}
fn attached_list(p: &Project, kind: &str, sponge_v3: bool) -> Result<N> {
    let mut list = vec![];
    for e in p.attached.iter().filter(|e| e.kind == kind) {
        let mut raw = attached_nbt(e)?;
        let m = map(&mut raw)?;
        if sponge_v3 {
            let pos = N::IntArray(IntArray::new(e.pos.map(|n| n as i32).to_vec()));
            if !m.contains_key("Data") {
                let id = m.remove("Id").ok_or("方块实体Id缺失")?;
                m.remove("Pos");
                raw = N::Compound(HashMap::from([
                    ("Id".into(), id),
                    ("Pos".into(), pos),
                    ("Data".into(), raw),
                ]));
            } else {
                m.insert("Pos".into(), pos);
            }
        } else {
            for (k, n) in ["x", "y", "z"].iter().zip(e.pos) {
                m.insert((*k).into(), N::Int(n as i32));
            }
        }
        list.push(raw)
    }
    Ok(N::List(list))
}

// Validate the binary shape before serde allocates recursive Values or arrays.
fn validate_nbt(bytes: &[u8]) -> Result<()> {
    struct Cursor<'a> {
        bytes: &'a [u8],
        at: usize,
        nodes: usize,
    }
    impl Cursor<'_> {
        fn take(&mut self, n: usize) -> Result<&[u8]> {
            let end = self.at.checked_add(n).ok_or("NBT长度溢出")?;
            let out = self.bytes.get(self.at..end).ok_or("NBT截断")?;
            self.at = end;
            Ok(out)
        }
        fn byte(&mut self) -> Result<u8> {
            Ok(self.take(1)?[0])
        }
        fn string(&mut self) -> Result<()> {
            let b = self.take(2)?;
            let n = u16::from_be_bytes([b[0], b[1]]) as usize;
            self.take(n)?;
            Ok(())
        }
        fn len(&mut self) -> Result<usize> {
            let b = self.take(4)?;
            let n = i32::from_be_bytes(b.try_into().unwrap());
            if n < 0 {
                return Err("NBT数组长度为负".into());
            }
            Ok(n as usize)
        }
        fn tag(&mut self, t: u8, depth: usize) -> Result<()> {
            if depth > 64 || self.nodes > 4_000_000 {
                return Err("NBT嵌套或标签数量过多".into());
            }
            self.nodes += 1;
            match t {
                1 => {
                    self.take(1)?;
                }
                2 => {
                    self.take(2)?;
                }
                3 | 5 => {
                    self.take(4)?;
                }
                4 | 6 => {
                    self.take(8)?;
                }
                7 | 11 | 12 => {
                    let n = self.len()?;
                    let unit = if t == 7 {
                        1
                    } else if t == 11 {
                        4
                    } else {
                        8
                    };
                    self.take(n.checked_mul(unit).ok_or("NBT数组过大")?)?;
                }
                8 => self.string()?,
                9 => {
                    let subtype = self.byte()?;
                    let n = self.len()?;
                    if n > 2_000_000 || subtype == 0 && n != 0 {
                        return Err("NBT列表过大或类型无效".into());
                    }
                    for _ in 0..n {
                        self.tag(subtype, depth + 1)?
                    }
                }
                10 => loop {
                    let kind = self.byte()?;
                    if kind == 0 {
                        break;
                    }
                    self.string()?;
                    self.tag(kind, depth + 1)?
                },
                _ => return Err("NBT标签类型无效".into()),
            }
            Ok(())
        }
    }
    let mut c = Cursor {
        bytes,
        at: 0,
        nodes: 0,
    };
    if c.byte()? != 10 {
        return Err("NBT根标签必须为复合".into());
    }
    c.string()?;
    c.tag(10, 0)?;
    if c.at != bytes.len() {
        return Err("NBT尾部多余数据".into());
    }
    Ok(())
}
